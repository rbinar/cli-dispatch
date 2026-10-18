import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// The parsers' progress.log format, pinned byte for byte. The parsers run for real; the session
// dirs live in a private temp root so the passive prune never looks at anything else.

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const script = (n) => path.join(SELF_DIR, '..', n)
const root = mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-test-pidx-'))
let counter = 0
const newDir = () => path.join(root, `s${++counter}`)

function run(parser, env, events) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [script(parser)], { env: { ...process.env, ...env } })
    proc.on('error', reject)
    proc.on('close', (code) => resolve(code))
    for (const ev of events) proc.stdin.write(JSON.stringify(ev) + '\n')
    proc.stdin.end()
  })
}

test('progress.log is byte-for-byte the golden content', async () => {
  const dir = newDir()
  const events = [
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls -la' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls -la', aggregated_output: 'ok', exit_code: 0 } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'ok done' } },
  ]
  await run('cx-stream-parse.mjs', { CX_SESSION_DIR: dir, CX_THREAD_ID: 't' }, events)
  assert.equal(readFileSync(path.join(dir, 'progress.log'), 'utf8'), '$ ls -la\n$ ls -la (exit 0)\n· ok done\n')

  const dsDir = newDir()
  const ds = [
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a/b' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'abc' }] } },
  ]
  await run('ds-stream-parse.mjs', { CLAUDE_DS_SESSION_DIR: dsDir }, ds)
  assert.equal(readFileSync(path.join(dsDir, 'progress.log'), 'utf8'), '· hello\n▸ Read /a/b\n  ✓ (3b)\n')
})

test.after(() => rmSync(root, { recursive: true, force: true }))
