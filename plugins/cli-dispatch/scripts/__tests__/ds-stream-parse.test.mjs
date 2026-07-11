import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, readFileSync, existsSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// Absolute, cwd-independent: works whether the test runner is invoked from the
// repo root or from plugins/cli-dispatch/scripts/ (see check-version-sync.test.mjs
// / dashboard-server.test.mjs for the same idiom).
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const parserScript = path.join(SELF_DIR, '..', 'ds-stream-parse.mjs')
// Use the OS temp dir (not a repo-relative path) so a stray run never leaves
// a junk directory behind in the working tree.
const testDir = mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-test-ds-session-'))

function runParser(events, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    const proc = spawn('node', [parserScript], {
      env: {
        ...process.env,
        CLAUDE_DS_SESSION_DIR: testDir,
        ...envOverrides
      }
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', data => { stdout += data })
    proc.stderr.on('data', data => { stderr += data })

    proc.on('error', reject)
    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })

    for (const ev of events) {
      proc.stdin.write(JSON.stringify(ev) + '\n')
    }
    proc.stdin.end()
  })
}

test('ds-stream-parse: dedup + accumulation, no result event (kill before final event)', async () => {
  const events = [
    {
      type: 'assistant',
      message: { id: 'msg-1', content: [], usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 10 } }
    },
    {
      type: 'assistant',
      message: { id: 'msg-2', content: [], usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.usage.input_tokens, 150)
  assert.equal(status.usage.output_tokens, 50)
  assert.equal(status.usage.cache_creation_input_tokens, 5)
  assert.equal(status.usage.cache_read_input_tokens, 10)
  assert.equal(status.usagePartial, true)

  rmSync(testDir, { recursive: true, force: true })
})

test('ds-stream-parse: same message.id repeated (streamed re-emission) must NOT double-count', async () => {
  const events = [
    {
      type: 'assistant',
      message: { id: 'msg-same', content: [], usage: { input_tokens: 40, output_tokens: 15, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } }
    },
    {
      type: 'assistant',
      message: { id: 'msg-same', content: [], usage: { input_tokens: 40, output_tokens: 15, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.usage.input_tokens, 40)
  assert.equal(status.usage.output_tokens, 15)
  assert.equal(status.usagePartial, true)

  rmSync(testDir, { recursive: true, force: true })
})

test('ds-stream-parse: result event overwrites accumulated usage and clears usagePartial', async () => {
  const events = [
    {
      type: 'assistant',
      message: { id: 'a', content: [], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
    },
    {
      type: 'result',
      result: 'Done.',
      usage: { input_tokens: 999, output_tokens: 111 }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.usage.input_tokens, 999)
  assert.equal(status.usage.output_tokens, 111)
  assert.equal(status.usagePartial, false)

  rmSync(testDir, { recursive: true, force: true })
})
