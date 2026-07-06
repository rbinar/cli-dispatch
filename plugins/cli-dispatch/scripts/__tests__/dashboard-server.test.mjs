import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  readHead, readTail, collectProcTree, mapFlow
} from '../dashboard-utils.mjs'

// ---- readHead / readTail ----

test('dashboard-utils: readHead returns full content when file is under maxBytes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'small.txt')
  const content = 'hello world\nsecond line\n'
  writeFileSync(file, content)

  const head = readHead(file, 16384)
  assert.equal(head, content)

  rmSync(dir, { recursive: true, force: true })
})

test('dashboard-utils: readHead truncates to maxBytes on a large file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'big.txt')
  // 'a' * 100000 — well over an 8KB maxBytes cap.
  const content = 'a'.repeat(100000)
  writeFileSync(file, content)

  const maxBytes = 8192
  const head = readHead(file, maxBytes)
  assert.equal(head.length, maxBytes)
  assert.equal(head, content.slice(0, maxBytes))

  rmSync(dir, { recursive: true, force: true })
})

test('dashboard-utils: readTail returns full content when file is under maxBytes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'small.txt')
  const content = 'hello world\nsecond line\n'
  writeFileSync(file, content)

  const tail = readTail(file, 65536)
  assert.equal(tail, content)

  rmSync(dir, { recursive: true, force: true })
})

test('dashboard-utils: readTail truncates to the LAST maxBytes on a large file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'big.txt')
  // Distinct prefix vs suffix so we can prove we got the TAIL, not the head.
  const head = 'HEAD'.repeat(20000)   // 80000 bytes
  const tailMarker = 'TAILMARKER-END'
  const content = head + tailMarker
  writeFileSync(file, content)

  const maxBytes = 1024
  const tail = readTail(file, maxBytes)
  assert.equal(tail.length, maxBytes)
  assert.equal(tail, content.slice(content.length - maxBytes))
  assert.ok(tail.endsWith(tailMarker))

  rmSync(dir, { recursive: true, force: true })
})

test('dashboard-utils: readHead/readTail do not leak fds across many iterations', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'loop.txt')
  writeFileSync(file, 'x'.repeat(5000))

  // Historical bug: readHead/readTail left fds open on every call. 200 iterations of
  // both is enough to blow past typical ulimit -n defaults (256/1024) if fds leak;
  // if this throws EMFILE/EBADF, the fd-leak regression is back.
  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i++) {
      readHead(file, 1000)
      readTail(file, 1000)
    }
  })

  rmSync(dir, { recursive: true, force: true })
})

test('dashboard-utils: readHead/readTail return empty string for a missing file (no throw)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const missing = path.join(dir, 'does-not-exist.txt')

  assert.equal(readHead(missing), '')
  assert.equal(readTail(missing), '')

  rmSync(dir, { recursive: true, force: true })
})

// ---- collectProcTree ----

test('dashboard-utils: collectProcTree finds a real descendant process', async () => {
  // Spawn a short-lived child (sleep) whose parent is THIS test process, so
  // collectProcTree(process.pid) should discover it as a descendant.
  const child = spawn('sleep', ['5'])
  // Give the OS a moment to register the process in the process table.
  await new Promise(resolve => setTimeout(resolve, 300))

  try {
    const tree = collectProcTree(process.pid)
    assert.ok(Array.isArray(tree))
    assert.ok(tree.includes(process.pid), 'tree should include the root pid')
    assert.ok(tree.includes(child.pid), 'tree should include the spawned child pid')
  } finally {
    child.kill('SIGKILL')
  }
})

test('dashboard-utils: collectProcTree does not throw for a leaf pid with no children', () => {
  // A pid with no children: pgrep -P <pid> exits 1 (no matches) — per the source's own
  // comment this is the NORMAL "no children" case, not an error, and must not throw or
  // log a "pgrep unavailable" error. Use our own (leaf, for the purposes of this test)
  // process pid — a freshly-spawned short-lived child with no children of its own.
  const result = spawnSyncSleep()
  const tree = collectProcTree(result.pid)
  assert.ok(Array.isArray(tree))
  assert.deepEqual(tree, [result.pid])
  result.cleanup()
})

// Helper: spawn+immediately-return a leaf child pid (no children of its own) for the
// "no children" collectProcTree case, with a cleanup callback.
function spawnSyncSleep() {
  const child = spawn('sleep', ['5'])
  return { pid: child.pid, cleanup: () => child.kill('SIGKILL') }
}

// ---- mapFlow ----

test('dashboard-utils: mapFlow extracts model + steps from a fake Claude Code transcript', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'transcript.jsonl')

  const events = [
    {
      type: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { content: 'Please summarize this file.' }
    },
    {
      type: 'assistant',
      timestamp: '2024-01-01T00:00:01.000Z',
      message: {
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'Here is the summary.' }]
      }
    }
  ]
  writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n')

  const flow = mapFlow(file)
  assert.equal(flow.model, 'claude-sonnet-5')
  assert.equal(flow.total, 2)
  assert.equal(flow.truncated, false)

  assert.equal(flow.steps.length, 2)
  assert.equal(flow.steps[0].kind, 'prompt')
  assert.equal(flow.steps[0].text, 'Please summarize this file.')
  assert.equal(flow.steps[1].kind, 'message')
  assert.equal(flow.steps[1].text, 'Here is the summary.')

  rmSync(dir, { recursive: true, force: true })
})

test('dashboard-utils: mapFlow returns empty/default shape for a missing file', () => {
  const flow = mapFlow('/tmp/definitely-does-not-exist-dashboard-utils-test.jsonl')
  assert.deepEqual(flow, { steps: [], total: 0, truncated: false, model: '' })
})

test('dashboard-utils: mapFlow records tool_use steps with a spawnsAgent link for Task/Agent tools', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-utils-'))
  const file = path.join(dir, 'transcript.jsonl')

  const events = [
    {
      type: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        model: 'claude-sonnet-5',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Task', input: { description: 'do the thing' } }]
      }
    },
    {
      type: 'user',
      timestamp: '2024-01-01T00:00:01.000Z',
      toolUseResult: { agentId: 'agent-abc' },
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] }
    }
  ]
  writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n')

  const flow = mapFlow(file)
  const toolStep = flow.steps.find(s => s.kind === 'tool')
  assert.ok(toolStep, 'expected a tool step')
  assert.equal(toolStep.name, 'Task')
  assert.equal(toolStep.spawnsAgent, 'agent-abc')
  assert.equal(toolStep.ok, true)
})
