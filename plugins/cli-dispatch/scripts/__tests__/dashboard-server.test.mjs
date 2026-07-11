import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, utimesSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import {
  readHead, readTail, collectProcTree, mapFlow
} from '../dashboard-utils.mjs'
import { markTakeoverActive, touchTakeoverHeartbeat, clearTakeoverState } from '../parse-utils.mjs'

// ---- dashboard-server.mjs spawn helpers (mirror takeover-integration.test.mjs pattern) ----
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = path.join(SELF_DIR, '..', 'dashboard-server.mjs')

function startServer(env, port) {
  return spawn(process.execPath, [SERVER_PATH, '--port', String(port), '--no-open'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

function waitForServerReady(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('server did not start in time; stderr: ' + buf)), timeoutMs)
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (m) { clearTimeout(timer); resolve(parseInt(m[1], 10)) }
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('server exited ' + code)) })
  })
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {}; resolve() }, 4000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { child.kill('SIGTERM') } catch { clearTimeout(timer); resolve() }
  })
}

function httpRequest({ port, method, path: reqPath }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: reqPath }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(body) } catch {}
        resolve({ status: res.statusCode, body: json, raw: body })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

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

// ---- /api/clean integration tests (real dashboard-server.mjs spawn) ----

test('GET /api/clean detects stale running session, ignores fresh session', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-clean-'))
  const now = Date.now()
  const staleId = 'stale-session-1'
  const freshId = 'fresh-session-1'
  const port = 18800 + Math.floor(Math.random() * 1000)

  // Seed a stale session (state: running, status.json mtime well past 600s)
  const staleDir = path.join(sessionsDir, staleId)
  mkdirSync(staleDir, { recursive: true })
  writeFileSync(path.join(staleDir, 'status.json'), JSON.stringify({ state: 'running', backend: 'deepseek' }))
  writeFileSync(path.join(staleDir, 'meta.json'), JSON.stringify({ backend: 'deepseek' }))
  const staleStatusPath = path.join(staleDir, 'status.json')
  const oldTime = new Date(now - 2000 * 1000)
  utimesSync(staleStatusPath, oldTime, oldTime)

  // Seed a fresh session (state: running, mtime left at "now")
  const freshDir = path.join(sessionsDir, freshId)
  mkdirSync(freshDir, { recursive: true })
  writeFileSync(path.join(freshDir, 'status.json'), JSON.stringify({ state: 'running', backend: 'deepseek' }))
  writeFileSync(path.join(freshDir, 'meta.json'), JSON.stringify({ backend: 'deepseek' }))

  const child = startServer({ ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessionsDir }, port)
  let actualPort
  try {
    actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/clean?staleSecs=600' })
    assert.equal(res.status, 200)
    assert.equal(res.body.root, sessionsDir)
    assert.equal(res.body.staleSecs, 600)
    assert.ok(res.body.count >= 1, 'expected at least 1 stale session')
    const staleIds = res.body.items.map(item => item.id)
    assert.ok(staleIds.includes(staleId), 'stale session should be in items')
    assert.ok(!staleIds.includes(freshId), 'fresh session should NOT be in items')
    const staleItem = res.body.items.find(item => item.id === staleId)
    assert.ok(staleItem)
    assert.equal(staleItem.state, 'running')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
  }
})

test('GET /api/clean detects human-controlled stale session', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-clean-hc-'))
  const now = Date.now()
  const hcId = 'hc-stale-1'
  const port = 18900 + Math.floor(Math.random() * 1000)

  const hcDir = path.join(sessionsDir, hcId)
  mkdirSync(hcDir, { recursive: true })
  writeFileSync(path.join(hcDir, 'status.json'), JSON.stringify({ state: 'human-controlled', backend: 'codex' }))
  writeFileSync(path.join(hcDir, 'meta.json'), JSON.stringify({ backend: 'codex' }))
  const hcStatusPath = path.join(hcDir, 'status.json')
  const oldTime = new Date(now - 2000 * 1000)
  utimesSync(hcStatusPath, oldTime, oldTime)

  const child = startServer({ ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessionsDir }, port)
  let actualPort
  try {
    actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/clean?staleSecs=600' })
    assert.equal(res.status, 200)
    assert.equal(res.body.count, 1)
    assert.equal(res.body.items[0].id, hcId)
    assert.equal(res.body.items[0].state, 'human-controlled')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
  }
})

test('GET /api/workers/aggregate sums worker usage by backend', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-usage-'))
  const port = 19000 + Math.floor(Math.random() * 1000)

  const seed = (id, meta, status) => {
    const dir = path.join(sessionsDir, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta))
    writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status))
  }

  seed('cx-1', { backend: 'codex', startedAt: '2026-01-01T00:00:00.000Z' }, {
    backend: 'codex',
    state: 'done',
    usage: { input_tokens: 100, output_tokens: 20 }
  })
  seed('cx-2', { backend: 'codex', startedAt: '2026-01-02T00:00:00.000Z' }, {
    backend: 'codex',
    state: 'done',
    usage: null
  })
  seed('oc-1', { backend: 'opencode', startedAt: '2026-01-03T00:00:00.000Z' }, {
    backend: 'opencode',
    state: 'done',
    usage: { tokens: { input: 300, output: 45 } }
  })

  const child = startServer({ ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessionsDir }, port)
  let actualPort
  try {
    actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers/aggregate' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.codex, { inputTokens: 100, outputTokens: 20, sessions: 2, noDataSessions: 1 })
    assert.deepEqual(res.body.opencode, { inputTokens: 300, outputTokens: 45, sessions: 1, noDataSessions: 0 })
    assert.equal(res.body.antigravity, undefined)
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
  }
})

// ---- touchTakeoverHeartbeat reap-revival guard (drives bridgePty's self-stopping heartbeat) ----
//
// bridgePty()'s 30s heartbeat timer can't be unit-isolated here (it needs a live PTY + WS
// socket), but the condition that makes it self-stop IS unit-testable: touchTakeoverHeartbeat
// returns the on-disk status and, when a reaper has already flipped state to a terminal value
// and dropped the takeover sub-object, must NOT write and must return that status unchanged.
// The timer's self-stop test — "returned status is no longer human-controlled+active" — reduces
// exactly to this guard firing.

test('touchTakeoverHeartbeat: no-op guard when takeover already reaped to a terminal state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-heartbeat-'))
  const statusFile = path.join(dir, 'status.json')
  try {
    // Simulate an out-of-process reaper having cleared the takeover: terminal state, no takeover.
    writeFileSync(statusFile, JSON.stringify({ state: 'killed' }))
    const before = readFileSync(statusFile, 'utf8')
    const mtimeBefore = statSync(statusFile).mtimeMs

    const st = touchTakeoverHeartbeat(statusFile)

    // Returned status is unchanged and, crucially for bridgePty, NOT an active human-controlled
    // takeover — this is the exact predicate that makes the heartbeat timer clearInterval itself.
    assert.equal(st.state, 'killed')
    assert.equal(st.takeover, undefined)
    assert.equal(!(st.state === 'human-controlled' && st.takeover && st.takeover.active === true), true)
    // And the file was not rewritten (no reap-revival).
    assert.equal(readFileSync(statusFile, 'utf8'), before)
    assert.equal(statSync(statusFile).mtimeMs, mtimeBefore)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('touchTakeoverHeartbeat: refreshes lastHeartbeat while takeover is still active', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-heartbeat-'))
  const statusFile = path.join(dir, 'status.json')
  try {
    markTakeoverActive(statusFile, { host: '127.0.0.1:0', ptyPid: 123, ptyPgid: 123, now: '2026-01-01T00:00:00.000Z' })
    const st = touchTakeoverHeartbeat(statusFile, { now: '2026-01-01T00:00:30.000Z' })
    // Guard passes: the timer would keep running, and the heartbeat advanced.
    assert.equal(st.state, 'human-controlled')
    assert.equal(st.takeover.active, true)
    assert.equal(st.takeover.lastHeartbeat, '2026-01-01T00:00:30.000Z')

    // After a handback/reap to a terminal state, the guard closes again.
    clearTakeoverState(statusFile, { finalState: 'done', completedVia: 'human-takeover' })
    const st2 = touchTakeoverHeartbeat(statusFile)
    assert.equal(st2.state, 'done')
    assert.equal(st2.takeover, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
