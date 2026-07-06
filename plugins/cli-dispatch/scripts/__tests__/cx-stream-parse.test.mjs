import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const parserScript = path.resolve('plugins/cli-dispatch/scripts/cx-stream-parse.mjs')
const testDir = path.resolve('plugins/cli-dispatch/scripts/__tests__/tmp-test-cx-session')

function runParser(events, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    const proc = spawn('node', [parserScript], {
      env: {
        ...process.env,
        CX_SESSION_DIR: testDir,
        CX_THREAD_ID: 'sess-123',
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

test('cx-stream-parse: item.completed agent_message sets finalText/status/stdout, state=done', async () => {
  const events = [
    {
      type: 'item.completed',
      item: { id: '1', type: 'agent_message', text: 'Hello world.' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Hello world.')

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  assert.equal(status.finalResultPreview, 'Hello world.')

  rmSync(testDir, { recursive: true, force: true })
})

test('cx-stream-parse: multiple agent_message items — the LAST one wins', async () => {
  const events = [
    {
      type: 'item.completed',
      item: { id: '1', type: 'agent_message', text: 'First answer.' }
    },
    {
      type: 'item.completed',
      item: { id: '2', type: 'agent_message', text: 'Second answer.' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)
  // finalText is overwritten by each subsequent agent_message item — no accumulation.
  assert.equal(result.stdout.trim(), 'Second answer.')

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  assert.equal(status.finalResultPreview, 'Second answer.')

  rmSync(testDir, { recursive: true, force: true })
})

test('cx-stream-parse: CX_MODEL and thread.started are written to meta.json', async () => {
  const events = [
    { type: 'thread.started', thread_id: 'thread-abc' },
    {
      type: 'item.completed',
      item: { id: '1', type: 'agent_message', text: 'Done.' }
    }
  ]

  const result = await runParser(events, { CX_MODEL: 'gpt-5-codex' })
  assert.equal(result.code, 0)

  const metaPath = path.join(testDir, 'meta.json')
  assert.ok(existsSync(metaPath))
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  assert.equal(meta.model, 'gpt-5-codex')
  // thread.started overwrites the initially-configured CX_THREAD_ID.
  assert.equal(meta.threadId, 'thread-abc')
  assert.equal(meta.backend, 'codex')

  rmSync(testDir, { recursive: true, force: true })
})

test('cx-stream-parse: turn.failed sets status.state=error and status.error', async () => {
  const events = [
    {
      type: 'item.completed',
      item: { id: '1', type: 'agent_message', text: 'Partial progress.' }
    },
    {
      type: 'turn.failed',
      error: { message: 'The turn failed unexpectedly.' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  // errorText is authoritative — a turn-level failure wins even though a partial
  // agent_message was emitted before it.
  assert.equal(status.state, 'error')
  assert.equal(status.error, 'The turn failed unexpectedly.')

  const metaPath = path.join(testDir, 'meta.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  assert.equal(meta.state, 'error')
  assert.equal(meta.error, 'The turn failed unexpectedly.')

  rmSync(testDir, { recursive: true, force: true })
})

test('cx-stream-parse: item.type "error" sets status.state=error and status.error', async () => {
  const events = [
    {
      type: 'item.completed',
      item: { id: '1', type: 'error', message: 'Something broke.' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'error')
  assert.equal(status.error, 'Something broke.')

  rmSync(testDir, { recursive: true, force: true })
})
