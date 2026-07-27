import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, utimesSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import {
  readHead, readTail, collectProcTree, mapFlow,
  readVerdict, readChangedFiles, clipLines
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

// `headers` and `payload` support exist so the authenticated POST surface can be tested at all
// — before this, every POST route (/api/clean, /api/config) was unreachable from the suite.
// `headers` is also what makes response assertions like content-type possible.
function httpRequest({ port, method, path: reqPath, headers, payload }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(body) } catch {}
        resolve({ status: res.statusCode, body: json, raw: body, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (payload != null) req.write(typeof payload === 'string' ? payload : JSON.stringify(payload))
    req.end()
  })
}

// PROJECTS_DIR / CC_SESSIONS_DIR are derived from os.homedir() (dashboard-server.mjs:43-44) with
// NO env override, so a test that touches /api/workers would otherwise scan the developer's real
// ~/.claude/projects — hundreds of transcripts and hundreds of MB of capped readTail per test.
// os.homedir() honours $HOME on POSIX, so overriding HOME isolates both in one line.
// CLI_DISPATCH_SESSIONS_DIR still overrides WORKERS_ROOT independently.
function startServerIsolated({ sessionsDir, homeDir, port, env }) {
  return startServer({
    ...process.env,
    HOME: homeDir,
    CLI_DISPATCH_SESSIONS_DIR: sessionsDir,
    ...env,
  }, port)
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
    // 4.5.0 added partialSessions + the deterministic-run subset to this shape; deepEqual keeps
    // that shape pinned, so a future field cannot appear here unnoticed.
    assert.deepEqual(res.body.codex, {
      inputTokens: 100, outputTokens: 20, sessions: 2, noDataSessions: 1,
      partialSessions: 0, runSessions: 0, runInputTokens: 0, runOutputTokens: 0,
    })
    assert.deepEqual(res.body.opencode, {
      inputTokens: 300, outputTokens: 45, sessions: 1, noDataSessions: 0,
      partialSessions: 0, runSessions: 0, runInputTokens: 0, runOutputTokens: 0,
    })
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

// ---- GET / (the SPA itself) ----
// The dashboard's whole reason to exist was never asserted to return 200. public-page.test.mjs
// checks that the client script PARSES; this checks that the server actually SERVES it.
test('GET / serves the dashboard HTML', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-root-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/' })
    assert.equal(res.status, 200)
    assert.match(String(res.headers['content-type']), /^text\/html/)
    // Structural anchors the client script depends on existing.
    assert.ok(res.raw.includes('<div class="layout">'), 'layout grid must be present')
    assert.ok(res.raw.includes('id="view"'), 'main view container must be present')
    assert.ok(res.raw.includes('id="tabW"'), 'workers tab must be present')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- babysitter accounting removal (4.3.0) ----
// Two halves of the same assertion, deliberately in one test: the babysitter fields must be
// GONE, and the worker -> parent-Claude-Code-session linkage they were bolted onto must SURVIVE.
// Testing only the removal would let someone "simplify" buildWorkerParentIndex away entirely
// and still pass.
test('GET /api/workers drops babysitter accounting but keeps the parent-session linkage', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-nobaby-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const workerId = 'ds-run-1784855285-379'
  const ccSessionId = '6f7826b9-f5ad-434f-8fde-acf0c7b4717c'
  const project = '-Users-someone-Repos-demo'
  const port = 18800 + Math.floor(Math.random() * 1000)

  const wDir = path.join(sessionsDir, workerId)
  mkdirSync(wDir, { recursive: true })
  writeFileSync(path.join(wDir, 'status.json'), JSON.stringify({
    sessionId: workerId, backend: 'deepseek', state: 'done',
    usage: { input_tokens: 10, output_tokens: 5 },
  }))
  writeFileSync(path.join(wDir, 'meta.json'), JSON.stringify({
    backend: 'deepseek', model: 'deepseek-v4-pro', cwd: '/tmp/ds-wt-oUSONx',
  }))

  // A Claude Code transcript that mentions the worker id is what makes the linkage resolve.
  const projDir = path.join(homeDir, '.claude', 'projects', project)
  mkdirSync(projDir, { recursive: true })
  writeFileSync(path.join(projDir, ccSessionId + '.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'launched ' + workerId } }) + '\n')

  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers' })
    assert.equal(res.status, 200)
    const row = res.body.find(w => w.id === workerId)
    assert.ok(row, 'the seeded worker must be listed')

    // The list route no longer resolves it at all (4.3.0): the row stopped rendering
    // "from <project>", and resolving it cost a 2MB readTail per Claude Code transcript on the
    // SSE-refreshed path.
    assert.ok(!('parentSession' in row), 'the list row must not resolve parentSession')
    assert.ok(!('babysitterUsage' in row), 'row must not carry babysitterUsage')
    assert.ok(!/babysitter/i.test(res.raw), 'no babysitter wording may remain in the list payload')

    // Kept, on the detail route: the linkage itself, minus the accounting bolted onto it.
    const flow = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/' + workerId + '/flow' })
    assert.ok(flow.body.parentSession, 'parentSession linkage must survive the babysitter removal')
    assert.equal(flow.body.parentSession.id, ccSessionId)
    assert.equal(flow.body.parentSession.project, project)
    assert.ok(!('babysitterUsage' in flow.body.parentSession), 'parentSession must not carry babysitterUsage')
    assert.ok(!('subagentId' in flow.body.parentSession), 'parentSession must not carry the unread subagentId')
    assert.ok(!/babysitter/i.test(flow.raw), 'no babysitter wording may remain in the flow payload')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- verdict.json / changed-files.json readers (4.3.0) ----

function seedDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

// Modelled on a real on-disk verdict (session 6f7826b9): verify failed with exit 4, one changed
// file, stranded, worktree already gone.
const REAL_VERDICT = {
  schemaVersion: 1,
  sessionId: '6f7826b9-f5ad-434f-8fde-acf0c7b4717c',
  backend: 'ds',
  model: 'deepseek-v4-pro',
  state: 'done',
  completedVia: 'autonomous',
  exitCode: 1,
  worktree: '/tmp/ds-wt-oUSONx',
  branch: 'ds-run-1784855285-379',
  baseRef: 'origin/main',
  diffstat: ' 1 file changed, 67 insertions(+)',
  changedFiles: ['app/services/x.py', 'tests/test_x.py'],
  diffPatchPath: '/somewhere/verdict-diff.patch',
  verify: {
    commands: ['python -m pytest tests/test_x.py -q'],
    exitCode: 4,
    failedAt: 0,
    tail: 'no tests ran in 0.00s\nERROR: file or directory not found\n',
  },
  stranded: true,
  worktreeRemoved: false,
  startedAt: '2026-07-24T01:08:05.441Z',
  endedAt: '2026-07-24T01:09:38.817Z',
}

test('readVerdict: returns null when verdict.json is absent', () => {
  const dir = seedDir('vr-none-')
  try { assert.equal(readVerdict(dir), null) } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: returns null for unparseable JSON instead of throwing', () => {
  const dir = seedDir('vr-bad-')
  try {
    writeFileSync(path.join(dir, 'verdict.json'), '{not json')
    assert.equal(readVerdict(dir), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: reads a real verdict shape', () => {
  const dir = seedDir('vr-real-')
  try {
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(REAL_VERDICT))
    const v = readVerdict(dir)
    assert.equal(v.malformed, false)
    assert.equal(v.exitCode, 1)
    assert.equal(v.outcome, 'verify-failed')
    assert.equal(v.verify.state, 'fail')
    assert.equal(v.verify.exitCode, 4)
    assert.equal(v.verify.failedAt, 0)
    assert.equal(v.verify.source, 'verdict')
    assert.equal(v.verify.commands.length, 1)
    assert.equal(v.stranded, true)
    assert.equal(v.branch, 'ds-run-1784855285-379')
    assert.equal(v.backend, 'ds')
    assert.equal(v.recordedAt, '2026-07-24T01:09:38.817Z')
    assert.deepEqual(v.changedFiles, ['app/services/x.py', 'tests/test_x.py'])
    // Structurally always false, so it must not be forwarded at all.
    assert.ok(!('worktreeRemoved' in v), 'the dead worktreeRemoved field must not be exposed')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// THE fail-closed test. cli-dispatch-run writes this shape when build-verdict throws; its
// `exitCode` is a node exit status, NOT the 0-5 contract value, so reading it as one would
// report a crashed run as a pass whenever that status happened to be 0.
test('readVerdict: the build-failure shape is malformed, never a pass', () => {
  const dir = seedDir('vr-err-')
  try {
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
      schemaVersion: 1,
      error: 'build-verdict failed (exit 5) — see stderr',
      sessionId: 'x',
      exitCode: 5,
    }))
    const v = readVerdict(dir)
    assert.equal(v.malformed, true)
    assert.equal(v.outcome, 'unknown')
    assert.notEqual(v.outcome, 'pass')
    assert.equal(v.exitCode, null, 'a node exit status must not masquerade as the contract code')
    assert.match(v.error, /build-verdict failed/)
    assert.equal(v.verify, null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: an exitCode of 0 in the build-failure shape still is not a pass', () => {
  const dir = seedDir('vr-err0-')
  try {
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
      schemaVersion: 1, error: 'boom', sessionId: 'x', exitCode: 0,
    }))
    const v = readVerdict(dir)
    assert.equal(v.malformed, true)
    assert.notEqual(v.outcome, 'pass')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: an unknown future schemaVersion is treated as unknown, not assumed-passing', () => {
  const dir = seedDir('vr-sv-')
  try {
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, schemaVersion: 2, exitCode: 0 }))
    const v = readVerdict(dir)
    assert.equal(v.malformed, true)
    assert.notEqual(v.outcome, 'pass')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: maps the whole cli-dispatch-run exit-code contract', () => {
  const dir = seedDir('vr-map-')
  try {
    const cases = [[0, 'pass'], [1, 'verify-failed'], [2, 'error'], [3, 'timeout'],
      [4, 'human-controlled'], [5, 'setup-error'], [42, 'unknown']]
    for (const [code, outcome] of cases) {
      writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, exitCode: code }))
      assert.equal(readVerdict(dir).outcome, outcome, 'exitCode ' + code)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// 124/126/127 mean the CHECK never ran. Calling that a FAIL blames the worker for the
// operator's typo; calling it a pass is worse.
test('readVerdict: a broken verify harness is neither pass nor fail', () => {
  const dir = seedDir('vr-harness-')
  try {
    for (const code of [124, 126, 127]) {
      writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
        ...REAL_VERDICT, verify: { ...REAL_VERDICT.verify, exitCode: code },
      }))
      assert.equal(readVerdict(dir).verify.state, 'harness', 'verify exit ' + code)
    }
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
      ...REAL_VERDICT, verify: { ...REAL_VERDICT.verify, exitCode: 0 },
    }))
    assert.equal(readVerdict(dir).verify.state, 'pass')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: verify:null stays null — an unchecked run is not a passing run', () => {
  const dir = seedDir('vr-noverify-')
  try {
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, verify: null, exitCode: 0 }))
    const v = readVerdict(dir)
    assert.equal(v.verify, null)
    assert.equal(v.outcome, 'pass', 'the RUN passed...')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: normalizes backend to the short form, null when unrecognised', () => {
  const dir = seedDir('vr-backend-')
  try {
    const cases = [['cx', 'cx'], ['codex', 'cx'], ['deepseek', 'ds'], ['nonsense', null]]
    for (const [input, want] of cases) {
      writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, backend: input }))
      assert.equal(readVerdict(dir).backend, want, 'backend ' + input)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: falls back to the legacy status.verify shape only when the verdict has none', () => {
  const dir = seedDir('vr-legacy-')
  try {
    const statusVerify = { cmd: 'make test', exit: 2, tail: 'legacy tail' }
    // verdict.verify present -> it wins.
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(REAL_VERDICT))
    let v = readVerdict(dir, { statusVerify })
    assert.equal(v.verify.source, 'verdict')
    assert.equal(v.verify.exitCode, 4)
    // verdict.verify absent -> the older {cmd, exit, tail} shape is normalized in.
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, verify: null }))
    v = readVerdict(dir, { statusVerify })
    assert.equal(v.verify.source, 'status')
    assert.deepEqual(v.verify.commands, ['make test'])
    assert.equal(v.verify.exitCode, 2)
    assert.equal(v.verify.failedAt, 0, 'a single failing command implies index 0')
    assert.equal(v.verify.state, 'fail')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: stranded is true only when literally true', () => {
  const dir = seedDir('vr-stranded-')
  try {
    for (const raw of [false, undefined, 'true', 1, null]) {
      writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, stranded: raw }))
      assert.equal(readVerdict(dir).stranded, false, 'stranded ' + JSON.stringify(raw))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readVerdict: a huge verify tail is capped but keeps its line structure', () => {
  const dir = seedDir('vr-tail-')
  try {
    // One pathological 5MB line — verdict-writer caps LINES, not bytes, so this reaches us.
    const huge = 'x'.repeat(5 * 1024 * 1024)
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
      ...REAL_VERDICT, verify: { ...REAL_VERDICT.verify, tail: huge },
    }))
    const tail = readVerdict(dir).verify.tail
    assert.ok(tail.length <= 8192 + 2, 'tail must be byte-capped, got ' + tail.length)

    // And the regression this exists for: clip() would collapse newlines, making a failing
    // test report one unreadable line.
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
      ...REAL_VERDICT, verify: { ...REAL_VERDICT.verify, tail: 'line one\nline two\nline three' },
    }))
    const multi = readVerdict(dir).verify.tail
    assert.ok(multi.includes('\n'), 'embedded newlines must survive')
    assert.equal(multi, 'line one\nline two\nline three')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('clipLines: keeps the LAST lines and byte-caps them', () => {
  const many = Array.from({ length: 100 }, (_, i) => 'line' + i).join('\n')
  const out = clipLines(many, 5)
  assert.ok(out.includes('line99'), 'the newest line must survive')
  assert.ok(!out.includes('line50'), 'older lines must be dropped')
  assert.ok(out.startsWith('…'), 'truncation must be visible')
  assert.equal(clipLines(''), '')
  assert.equal(clipLines(null), '')
  assert.equal(clipLines('short'), 'short', 'untruncated input gains no marker')
})

test('readChangedFiles: keeps per-file status and preexistingDirty', () => {
  const dir = seedDir('cf-')
  try {
    writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({
      files: [{ path: 'a.py', status: 'M' }, { path: 'new.py', status: '??' }],
      diffstat: ' 2 files changed, 19 insertions(+), 3 deletions(-)',
      preexistingDirty: ['CLAUDE.md'],
    }))
    const cf = readChangedFiles(dir)
    assert.equal(cf.files.length, 2)
    assert.deepEqual(cf.files[0], { path: 'a.py', status: 'M' })
    assert.equal(cf.files[1].status, '??')
    assert.deepEqual(cf.preexistingDirty, ['CLAUDE.md'])
    assert.equal(cf.truncated, false)
    assert.match(cf.diffstat, /2 files changed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readChangedFiles: null when absent, and an empty file list with preexistingDirty is valid', () => {
  const dir = seedDir('cf-edge-')
  try {
    assert.equal(readChangedFiles(dir), null)
    // A real on-disk shape (session 019f5351): the worker changed nothing, but something was
    // already dirty. That is not an error and must render.
    writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({
      files: [], diffstat: '', preexistingDirty: ['CLAUDE.md'],
    }))
    const cf = readChangedFiles(dir)
    assert.deepEqual(cf.files, [])
    assert.deepEqual(cf.preexistingDirty, ['CLAUDE.md'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readChangedFiles: caps a pathological file list and says so', () => {
  const dir = seedDir('cf-cap-')
  try {
    const files = Array.from({ length: 900 }, (_, i) => ({ path: 'f' + i + '.js', status: 'M' }))
    writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({ files, diffstat: '', preexistingDirty: [] }))
    const cf = readChangedFiles(dir)
    assert.equal(cf.files.length, 500)
    assert.equal(cf.truncated, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---- /api/workers verdict surfacing (4.3.0) ----

// One fixture, three session shapes, so a single server spawn covers the whole matrix:
// a deterministic run, a plain worker, and a worker whose verdict.json is corrupt.
function seedWorkerFixture() {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-verdict-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))

  const det = path.join(sessionsDir, 'det-1')
  mkdirSync(det, { recursive: true })
  writeFileSync(path.join(det, 'status.json'), JSON.stringify({ backend: 'deepseek', state: 'done' }))
  writeFileSync(path.join(det, 'meta.json'), JSON.stringify({ backend: 'deepseek', startedAt: '2026-07-24T01:00:00.000Z' }))
  writeFileSync(path.join(det, 'verdict.json'), JSON.stringify(REAL_VERDICT))
  writeFileSync(path.join(det, 'changed-files.json'), JSON.stringify({
    files: [{ path: 'a.py', status: 'M' }, { path: 'b.py', status: 'M' }, { path: 'c.py', status: '??' }],
    diffstat: ' 3 files changed, 42 insertions(+), 7 deletions(-)',
    preexistingDirty: ['CHANGELOG.md'],
  }))
  writeFileSync(path.join(det, 'verdict-diff.patch'), 'diff --git a/a.py b/a.py\n+x\n')

  const plain = path.join(sessionsDir, 'plain-1')
  mkdirSync(plain, { recursive: true })
  writeFileSync(path.join(plain, 'status.json'), JSON.stringify({ backend: 'codex', state: 'done' }))
  writeFileSync(path.join(plain, 'meta.json'), JSON.stringify({ backend: 'codex', startedAt: '2026-07-24T00:00:00.000Z' }))

  const bad = path.join(sessionsDir, 'bad-1')
  mkdirSync(bad, { recursive: true })
  writeFileSync(path.join(bad, 'status.json'), JSON.stringify({ backend: 'opencode', state: 'done' }))
  writeFileSync(path.join(bad, 'meta.json'), JSON.stringify({ backend: 'opencode', startedAt: '2026-07-23T00:00:00.000Z' }))
  writeFileSync(path.join(bad, 'verdict.json'), '{not json')

  return { sessionsDir, homeDir }
}

test('GET /api/workers surfaces the verdict when one exists', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers' })
    assert.equal(res.status, 200)
    const row = res.body.find(w => w.id === 'det-1')
    assert.ok(row)
    assert.equal(row.hasVerdict, true)
    assert.equal(row.verdict.outcome, 'verify-failed')
    assert.equal(row.verdict.verify, 'fail')
    assert.equal(row.verdict.verifyExit, 4)
    assert.equal(row.verdict.exitCode, 1)
    assert.equal(row.verdict.stranded, true)
    assert.equal(row.verdict.malformed, false)
    assert.equal(row.verdict.branch, 'ds-run-1784855285-379')
    // changed-files.json wins over the verdict's flatter list (3 files vs the verdict's 2).
    assert.equal(row.changedFileCount, 3)
    assert.match(row.diffstat, /3 files changed/)
    assert.equal(row.hasDiff, true)
    // The tail is detail-view payload and must never ride along on the list route.
    assert.ok(!('tail' in row.verdict), 'the list row must not carry the verify tail')
    assert.ok(!/no tests ran/.test(res.raw), 'no verify output may appear in the list payload')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// The common case on a real machine is a row with NO verdict (107 of 120 here). It must look
// complete, not broken, and must not imply the session failed a check it never ran.
test('GET /api/workers omits verdict fields cleanly for a plain worker', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers' })
    const row = res.body.find(w => w.id === 'plain-1')
    assert.ok(row)
    assert.equal(row.hasVerdict, false)
    assert.equal(row.verdict, null, 'strictly null so the client can branch on one key')
    assert.equal(row.changedFileCount, 0)
    assert.equal(row.diffstat, '')
    assert.equal(row.hasDiff, false)
    assert.equal(row.verdictPending, false)
    // Every pre-existing field must still be there — the enrichment is additive.
    for (const k of ['id', 'backend', 'state', 'stale', 'started', 'cwd', 'model', 'prompt', 'usage']) {
      assert.ok(k in row, 'pre-existing field missing: ' + k)
    }
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// One corrupt file must not poison the route or its neighbours.
test('GET /api/workers survives a corrupt verdict.json without affecting other rows', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers' })
    assert.equal(res.status, 200, 'the route must not 500')
    const bad = res.body.find(w => w.id === 'bad-1')
    assert.ok(bad, 'the session with the corrupt verdict must still be listed')
    assert.equal(bad.hasVerdict, false)
    assert.equal(bad.verdict, null)
    // ...and its neighbour is unaffected.
    assert.equal(res.body.find(w => w.id === 'det-1').verdict.outcome, 'verify-failed')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- GET /api/worker/:id/diff ----

test('GET /api/worker/:id/diff serves the patch as plain text', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/det-1/diff' })
    assert.equal(res.status, 200)
    assert.match(String(res.headers['content-type']), /^text\/plain/)
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['x-cli-dispatch-diff-source'], 'verdict-diff.patch')
    assert.equal(res.headers['x-cli-dispatch-diff-truncated'], '0')
    assert.match(res.raw, /^diff --git/)
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/worker/:id/diff 404s with no patch, 400s on a bad id, and rejects POST', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const none = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/plain-1/diff' })
    assert.equal(none.status, 404)
    assert.equal(none.body.error, 'no diff')
    const traversal = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/..%2F..%2Fetc/diff' })
    assert.ok(traversal.status === 400 || traversal.status === 404, 'traversal must not be served')
    // 405 since 4.7.0, not 404: the router now knows the path exists and only the verb is
    // wrong, and says which verb is allowed. Before the route table, a method mismatch simply
    // failed to match and fell through to the catch-all 404.
    const posted = await httpRequest({ port: actualPort, method: 'POST', path: '/api/worker/det-1/diff' })
    assert.equal(posted.status, 405, 'the method guard must reject POST')
    assert.equal(posted.headers.allow, 'GET')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// THE containment test. verdict.json is written by five external worker CLIs, so its
// diffPatchPath is attacker-influencable absolute-path input. Serving it would be an
// arbitrary-file-read primitive. This test exists so nobody "simplifies" the route back to
// reading that field.
test('GET /api/worker/:id/diff never follows verdict.diffPatchPath', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-diffpath-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  const dir = path.join(sessionsDir, 'evil-1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ backend: 'deepseek', state: 'done' }))
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'deepseek' }))
  // A verdict pointing at a file outside the session dir, and NO patch inside it.
  writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ ...REAL_VERDICT, diffPatchPath: '/etc/passwd' }))

  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/evil-1/diff' })
    assert.equal(res.status, 404, 'must not serve a file it was pointed at')
    assert.ok(!/root:/.test(res.raw), '/etc/passwd content must never reach the response')
    // And the flow route must not leak it either.
    const flow = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/evil-1/flow' })
    assert.equal(flow.body.diff.available, false)
    assert.equal(flow.body.diff.url, null)
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/worker/:id/diff caps a huge patch and reports the true size', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-bigdiff-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  const dir = path.join(sessionsDir, 'big-1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ backend: 'deepseek', state: 'done' }))
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'deepseek' }))
  const size = 600 * 1024
  writeFileSync(path.join(dir, 'diff.patch'), 'd'.repeat(size))

  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/big-1/diff' })
    assert.equal(res.status, 200)
    assert.equal(res.headers['x-cli-dispatch-diff-source'], 'diff.patch')
    assert.equal(res.headers['x-cli-dispatch-diff-bytes'], String(size))
    assert.equal(res.headers['x-cli-dispatch-diff-truncated'], '1')
    assert.ok(res.raw.length <= 512 * 1024, 'body must be capped, got ' + res.raw.length)
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/worker/:id/flow carries the full verdict, changed files and diff pointer', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const det = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/det-1/flow' })
    assert.equal(det.status, 200)
    assert.equal(det.body.verdict.verify.commands.length, 1)
    assert.ok(det.body.verdict.verify.tail.length > 0, 'the tail belongs on the detail route')
    assert.equal(det.body.verdict.verify.failedAt, 0)
    assert.equal(det.body.verdict.worktreeExists, false, 'the fixture worktree does not exist')
    assert.equal(det.body.changedFiles.source, 'changed-files.json')
    assert.equal(det.body.changedFiles.files[0].status, 'M')
    assert.deepEqual(det.body.changedFiles.preexistingDirty, ['CHANGELOG.md'])
    assert.equal(det.body.diff.available, true)
    assert.equal(det.body.diff.source, 'verdict-diff.patch')
    assert.equal(det.body.diff.url, '/api/worker/det-1/diff')

    // A plain worker keeps every pre-existing key and simply carries nulls for the new ones.
    const plain = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/plain-1/flow' })
    assert.equal(plain.body.verdict, null)
    assert.equal(plain.body.changedFiles, null)
    assert.equal(plain.body.diff.available, false)
    for (const k of ['steps', 'state', 'prompt', 'model', 'cwd', 'startedAt', 'finalResultPreview', 'usage']) {
      assert.ok(k in plain.body, 'pre-existing flow field missing: ' + k)
    }
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- POST /api/clean authentication (4.3.0) ----

function seedStaleSession() {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-cleanauth-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const dir = path.join(sessionsDir, 'stale-1')
  mkdirSync(dir, { recursive: true })
  const statusPath = path.join(dir, 'status.json')
  writeFileSync(statusPath, JSON.stringify({ state: 'running', backend: 'deepseek' }))
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'deepseek' }))
  const old = new Date(Date.now() - 2000 * 1000)
  utimesSync(statusPath, old, old)
  return { sessionsDir, homeDir, dir }
}

// This route does fs.rmSync(recursive) on session dirs. Unauthenticated, any page the user had
// open could delete a running worker's transcript, prompt and recovery diff cross-origin —
// readBody ignores Content-Type, so text/plain (CORS-simple, no preflight) got through.
test('POST /api/clean is rejected without the custom header, and deletes nothing', async () => {
  const { sessionsDir, homeDir, dir } = seedStaleSession()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({
      port: actualPort, method: 'POST', path: '/api/clean',
      // Exactly the attacker's request: a CORS-simple content type, no custom header.
      headers: { 'Content-Type': 'text/plain' },
      payload: JSON.stringify({ staleSecs: 1 }),
    })
    assert.ok(res.status === 403 || res.status === 400, 'expected a rejection, got ' + res.status)
    // The assertion that matters is on the filesystem, not the status code.
    assert.ok(statSync(dir).isDirectory(), 'the session dir must still exist')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('POST /api/clean still works for the dashboard itself', async () => {
  const { sessionsDir, homeDir, dir } = seedStaleSession()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({
      port: actualPort, method: 'POST', path: '/api/clean',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://127.0.0.1:' + actualPort,
        'Host': '127.0.0.1:' + actualPort,
        'X-CLI-Dispatch-Takeover': '1',
      },
      payload: JSON.stringify({ staleSecs: 1 }),
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.removed, 1)
    assert.throws(() => statSync(dir), 'the stale dir should be gone')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- GET /api/clean?worktrees=1 (4.3.0) ----
//
// This surface exists because cli-dispatch-clean's sweep NEVER removes a dirty worktree
// (commands/clean.md), and a dirty worktree is exactly what a successful run leaves behind — so
// nothing automated will ever clean these and, until now, nothing reported them either.
test('GET /api/clean?worktrees=1 lists leftover worktrees and flags the dirty ones', async () => {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'dash-wtscan-'))
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-wtsess-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)

  // A real git repo plus two real linked worktrees: one clean, one with an uncommitted change.
  const repo = path.join(tmpRoot, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 't@example.com'], repo)
  git(['config', 'user.name', 'T'], repo)
  writeFileSync(path.join(repo, 'a.txt'), 'base\n')
  git(['add', 'a.txt'], repo)
  git(['commit', '-qm', 'base'], repo)

  const cleanWt = path.join(tmpRoot, 'ds-wt-clean1')
  const dirtyWt = path.join(tmpRoot, 'cx-wt-dirty1')
  git(['worktree', 'add', '-q', '-b', 'wt-clean', cleanWt], repo)
  git(['worktree', 'add', '-q', '-b', 'wt-dirty', dirtyWt], repo)
  writeFileSync(path.join(dirtyWt, 'a.txt'), 'changed by the worker\n')

  // TMPDIR is one of the scanned roots, so pointing it at the fixture isolates the scan.
  const child = startServerIsolated({ sessionsDir, homeDir, port, env: { TMPDIR: tmpRoot } })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/clean?worktrees=1' })
    assert.equal(res.status, 200)
    const byPath = Object.fromEntries(res.body.items.map(i => [i.path, i]))
    const clean = byPath[cleanWt]
    const dirty = byPath[dirtyWt]
    assert.ok(clean, 'the clean worktree must be listed')
    assert.ok(dirty, 'the dirty worktree must be listed')
    assert.equal(clean.dirty, false)
    assert.equal(dirty.dirty, true, 'an uncommitted change must be reported')
    assert.ok(dirty.files >= 1)
    assert.equal(res.body.dirty, 1)
    // The backend prefix is parsed from the directory name, and the parent repo is resolved from
    // the worktree's own .git pointer — it is recorded nowhere else.
    assert.equal(clean.backend, 'ds')
    assert.equal(dirty.backend, 'cx')
    // realpath both sides: on macOS the fixture lives under /var, which is a symlink to
    // /private/var, and git records the resolved path. Either spelling works in the command.
    assert.equal(realpathSync(dirty.sourceRepo), realpathSync(repo),
      'source repo must be resolvable for the cleanup command')
    // The repo itself is not a *-wt-* directory and must not appear.
    assert.ok(!byPath[repo], 'only *-wt-* directories may be listed')
  } finally {
    await stopServer(child)
    try { execFileSync('git', ['-C', repo, 'worktree', 'remove', cleanWt, '--force'], { stdio: 'ignore' }) } catch {}
    try { execFileSync('git', ['-C', repo, 'worktree', 'remove', dirtyWt, '--force'], { stdio: 'ignore' }) } catch {}
    rmSync(tmpRoot, { recursive: true, force: true })
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/clean?worktrees=1 reports "unknown" rather than "clean" for a non-worktree dir', async () => {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'dash-wtbogus-'))
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-wtsess-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  // Named like a worktree but is not one: git status will fail. Calling that "clean" would invite
  // a delete; it has to read as "could not tell".
  mkdirSync(path.join(tmpRoot, 'ds-wt-bogus'), { recursive: true })

  const child = startServerIsolated({ sessionsDir, homeDir, port, env: { TMPDIR: tmpRoot } })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/clean?worktrees=1' })
    const item = res.body.items.find(i => i.path.endsWith('ds-wt-bogus'))
    assert.ok(item)
    assert.equal(item.dirty, null, 'an indeterminate state must be null, not false')
    assert.equal(item.sourceRepo, '')
  } finally {
    await stopServer(child)
    rmSync(tmpRoot, { recursive: true, force: true })
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/clean (no worktrees param) still returns the stale-session listing', async () => {
  const { sessionsDir, homeDir, dir } = seedStaleSession()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/clean?staleSecs=600' })
    assert.equal(res.status, 200)
    assert.equal(res.body.root, sessionsDir, 'the worktree branch must not shadow the session listing')
    assert.ok(res.body.items.some(i => i.id === 'stale-1'))
    assert.ok(statSync(dir).isDirectory())
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- GET /api/backend-auth (4.4.0) ----
//
// The ⚙ view used to answer "is this backend authenticated?" with "is there a key in one file?",
// which is the wrong question for the three backends that normally sign in through their CLI.
// These tests pin the two properties that make the answer trustworthy: nothing secret leaves the
// server, and a probe that cannot run says so instead of claiming "not logged in".

// A fake CLI directory placed FIRST on PATH, so the probes hit our stubs instead of the real
// binaries. That is what makes these tests deterministic on any machine.
function stubCliDir(scripts) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-stubcli-'))
  for (const [name, body] of Object.entries(scripts)) {
    const f = path.join(dir, name)
    writeFileSync(f, body, { mode: 0o755 })
  }
  return dir
}

async function withAuthServer(stubs, fn, env) {
  const binDir = stubCliDir(stubs)
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-authsess-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({
    sessionsDir, homeDir, port,
    // binDir FIRST so the stubs shadow the real CLIs, plus /usr/bin:/bin so the stubs themselves
    // can still use coreutils (a stub that needs `sleep` would otherwise exit 127 instantly and
    // silently test the wrong branch). The real codex/opencode/gh live in ~/.local/bin, nvm and
    // Homebrew, none of which are on this PATH — so the isolation still holds.
    // Alternate credential vars are cleared so altCreds is deterministic.
    // A generous probe deadline: `node --test` runs files in parallel, and under that load a
    // trivial stub can miss the 3s production default and be reported 'unknown' — correct
    // behaviour, but it made this test flaky. The timeout-specific test below sets its own.
    env: {
      PATH: binDir + ':/usr/bin:/bin',
      GH_TOKEN: '', GITHUB_TOKEN: '', OPENAI_API_KEY: '', ANTIGRAVITY_API_KEY: '',
      CLI_DISPATCH_AUTH_PROBE_TIMEOUT_MS: '15000',
      ...(env || {}),
    },
  })
  try {
    const actualPort = await waitForServerReady(child)
    await fn(actualPort, { sessionsDir })
  } finally {
    await stopServer(child)
    rmSync(binDir, { recursive: true, force: true })
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const SH = '#!/bin/sh\n'

test('GET /api/backend-auth reports logged-in state and the method, per backend', async () => {
  await withAuthServer({
    codex: SH + 'echo "Logged in using ChatGPT"\n',
    gh: SH + 'echo "gho_exampletokenvalue123456"\n',
    opencode: SH + 'echo "2 credentials"\n',
  }, async (port) => {
    const res = await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    assert.equal(res.status, 200)
    const b = res.body.backends
    assert.equal(b.cx.state, 'logged-in')
    assert.equal(b.cx.method, 'ChatGPT', 'the method matters — ChatGPT and an API key bill differently')
    assert.equal(b.cp.state, 'logged-in')
    assert.equal(b.cp.method, 'gh')
    assert.equal(b.oc.state, 'logged-in')
    // The two backends with no probe must say so rather than guess.
    assert.equal(b.ds.state, 'key-only')
    assert.equal(b.ag.state, 'no-probe')
  })
})

// THE test. `gh auth token` prints the token itself — it is the cheapest probe available (no
// network, unlike `gh auth status`) but its output must never escape the server.
test('GET /api/backend-auth never leaks token material or account identity', async () => {
  await withAuthServer({
    codex: SH + 'echo "Logged in using ChatGPT (account: someone@example.com)"\n',
    gh: SH + 'echo "gho_SUPERSECRETTOKENVALUE00000"\n',
    opencode: SH + 'echo "1 credentials for sk-or-v1-secretkeymaterial"\n',
  }, async (port) => {
    const res = await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    assert.equal(res.status, 200)
    assert.ok(!/gho_/.test(res.raw), 'a GitHub token must never appear in the payload')
    assert.ok(!/SUPERSECRET/.test(res.raw), 'token material must never appear in the payload')
    assert.ok(!/sk-or-v1/.test(res.raw), 'an OpenRouter key must never appear in the payload')
    assert.ok(!/example\.com/.test(res.raw), 'an account identity must never appear in the payload')
    // ...while still reporting the useful part.
    assert.equal(res.body.backends.cp.state, 'logged-in')
    assert.equal(res.body.backends.cx.method, 'ChatGPT')
  })
})

test('GET /api/backend-auth reports logged-out only when the probe actually said so', async () => {
  await withAuthServer({
    codex: SH + 'echo "Not logged in"\nexit 1\n',
    gh: SH + 'exit 1\n',
    opencode: SH + 'echo "0 credentials"\n',
  }, async (port) => {
    const res = await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    const b = res.body.backends
    assert.equal(b.cx.state, 'logged-out')
    assert.equal(b.cp.state, 'logged-out')
    // opencode exits 0 even with nothing stored, so this can only come from reading the count.
    assert.equal(b.oc.state, 'logged-out')
  })
})

// "Could not check" and "not logged in" are different claims, and only one of them is safe to
// assert. A hanging or missing CLI must never be rendered as a red cross.
test('GET /api/backend-auth reports unknown, not logged-out, when a probe cannot run', async () => {
  await withAuthServer({
    // Sleeps well past the (deliberately short) probe timeout set below.
    codex: SH + 'sleep 30\n',
    // gh absent from the stub dir entirely.
    opencode: SH + 'echo "something we do not recognise"\n',
  }, async (port) => {
    const res = await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    const b = res.body.backends
    assert.equal(b.cx.state, 'unknown', 'a timed-out probe must not claim logged-out')
    assert.match(b.cx.note, /timed out/)
    assert.equal(b.cp.state, 'cli-missing', 'a missing CLI is not a logged-out user')
    assert.equal(b.oc.state, 'unknown', 'unparseable output must not be guessed either way')
  }, { CLI_DISPATCH_AUTH_PROBE_TIMEOUT_MS: '1200' })
})

test('GET /api/backend-auth carries session evidence for the probe-less backends', async () => {
  const stubs = { codex: SH + 'echo "Logged in using ChatGPT"\n', gh: SH + 'echo tok\n', opencode: SH + 'echo "0 credentials"\n' }
  const binDir = stubCliDir(stubs)
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-authev-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  // Antigravity has no auth probe at all, so a recent successful run is the only cheap evidence
  // that its sign-in is live — and it is already on disk.
  const good = path.join(sessionsDir, 'ag-ok')
  mkdirSync(good, { recursive: true })
  writeFileSync(path.join(good, 'status.json'), JSON.stringify({
    backend: 'antigravity', state: 'done', lastActivityAt: '2026-07-24T19:26:18.671Z',
  }))
  const failed = path.join(sessionsDir, 'ag-authfail')
  mkdirSync(failed, { recursive: true })
  writeFileSync(path.join(failed, 'status.json'), JSON.stringify({
    backend: 'antigravity', state: 'error', errorKind: 'auth', lastActivityAt: '2026-07-23T10:00:00.000Z',
  }))

  const child = startServerIsolated({ sessionsDir, homeDir, port, env: { PATH: binDir } })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/backend-auth' })
    const ev = res.body.evidence.ag
    assert.ok(ev, 'evidence must be reported under the SHORT backend name')
    assert.equal(ev.lastSuccessAt, '2026-07-24T19:26:18.671Z')
    assert.equal(ev.authErrors, 1)
  } finally {
    await stopServer(child)
    rmSync(binDir, { recursive: true, force: true })
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/backend-auth caches, so opening the view repeatedly does not respawn probes', async () => {
  // A probe that appends on every call: if the cache works, it runs exactly once.
  const marker = path.join(mkdtempSync(path.join(tmpdir(), 'dash-authcnt-')), 'calls')
  await withAuthServer({
    codex: SH + 'echo x >> ' + marker + '\necho "Logged in using ChatGPT"\n',
    gh: SH + 'echo tok\n',
    opencode: SH + 'echo "0 credentials"\n',
  }, async (port) => {
    await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    await httpRequest({ port, method: 'GET', path: '/api/backend-auth' })
    const calls = readFileSync(marker, 'utf8').trim().split('\n').length
    assert.equal(calls, 1, 'the codex probe should have run once, ran ' + calls + ' times')
  })
})

// ---- token offload accounting (4.5.0) ----
//
// The dashboard and `gain` must never disagree about the same status.json. They did: the dashboard
// counted Codex's cache-INCLUSIVE input_tokens whole, so its headline "offloaded" figure was ~2x
// gain's (6.8M vs 3.5M on a real machine). Issue #99 established the rule; these tests pin it on
// this side too.
test('GET /api/workers/aggregate subtracts cached input (#99) and never goes negative', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-offload-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)

  const seed = (id, backend, usage, extra = {}) => {
    const d = path.join(sessionsDir, id)
    mkdirSync(d, { recursive: true })
    writeFileSync(path.join(d, 'status.json'), JSON.stringify({ backend, state: 'done', usage, ...extra }))
    writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ backend }))
    return d
  }

  // Codex's real shape: cached_input_tokens is a SUBSET of input_tokens (88% on real data).
  seed('cx-1', 'codex', { input_tokens: 1000, cached_input_tokens: 880, output_tokens: 50 })
  // OpenCode's real shape: cached_input_tokens is a SEPARATE counter that can EXCEED input_tokens.
  // Subtracting there would report a negative token count, so the guard must skip it.
  seed('oc-1', 'opencode', { input_tokens: 196, cached_input_tokens: 300, output_tokens: 7 })
  // DeepSeek reports no cached_input_tokens at all — untouched.
  seed('ds-1', 'deepseek', { input_tokens: 500, output_tokens: 200 })
  // A killed worker leaves a mid-run snapshot: counted, but it must be flagged rather than
  // silently summed as if it were a final total.
  seed('ds-2', 'deepseek', { input_tokens: 100, output_tokens: 0 }, { usagePartial: true })
  // A backend that exposes no usage at all (agy) makes the total a floor, not a total.
  seed('ag-1', 'antigravity', null)

  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers/aggregate' })
    assert.equal(res.status, 200)
    const cx = res.body.codex
    const oc = res.body.opencode
    const ds = res.body.deepseek
    const ag = res.body.antigravity

    assert.equal(cx.inputTokens, 120, 'cached input must be subtracted: 1000 - 880')
    assert.equal(oc.inputTokens, 196, 'cached > input must be left alone, never negative')
    assert.ok(oc.inputTokens > 0, 'a negative token count would be nonsense')
    assert.equal(ds.inputTokens, 600, 'no cached field means no adjustment (500 + 100)')

    // The two honesty caveats must be reportable, not implicit.
    assert.equal(ds.partialSessions, 1, 'a mid-run snapshot must be counted as partial')
    assert.equal(ag.noDataSessions, 1, 'a usage-less backend must be reportable as such')
    assert.equal(ag.inputTokens, 0)
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('GET /api/workers/aggregate isolates the deterministic-run subset', async () => {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'dash-offrun-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dash-home-'))
  const port = 18800 + Math.floor(Math.random() * 1000)
  const seed = (id, withVerdict) => {
    const d = path.join(sessionsDir, id)
    mkdirSync(d, { recursive: true })
    writeFileSync(path.join(d, 'status.json'), JSON.stringify({
      backend: 'deepseek', state: 'done', usage: { input_tokens: 100, output_tokens: 10 },
    }))
    writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ backend: 'deepseek' }))
    if (withVerdict) writeFileSync(path.join(d, 'verdict.json'), JSON.stringify(REAL_VERDICT))
  }
  seed('run-1', true)
  seed('plain-1', false)

  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'GET', path: '/api/workers/aggregate' })
    const ds = res.body.deepseek
    assert.equal(ds.sessions, 2)
    // Deterministic runs carry zero Anthropic babysitter cost by construction, so isolating them
    // is the cleanest evidence of offload the plugin has.
    assert.equal(ds.runSessions, 1, 'only the session with a verdict is a deterministic run')
    assert.equal(ds.runInputTokens, 100)
    assert.equal(ds.runOutputTokens, 10)
    assert.equal(ds.inputTokens, 200, 'the overall total still counts both')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

// ---- the route table (4.7.0) ---------------------------------------------------------------
//
// The router was a 288-line if-chain inside createServer. These tests pin what the table is
// supposed to buy: a method mismatch is a 405 that names the allowed verb, an unknown path is
// still the old 404 shape, and read routes that never had a method guard now have one.

test('router: a wrong verb on an existing path is 405 with an Allow header, not 404', async () => {
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)

    // Read routes that accepted ANY verb before the table: a POST used to run the GET handler
    // and return 200. This is the behaviour change the refactor ships.
    for (const p of ['/api/sessions', '/api/workers', '/api/workers/aggregate', '/api/config']) {
      const res = await httpRequest({ port: actualPort, method: 'DELETE', path: p })
      assert.equal(res.status, 405, `${p} must reject DELETE`)
      assert.equal(res.headers.allow, p === '/api/config' ? 'GET, POST' : 'GET', `${p} Allow header`)
      assert.equal(res.body.error, 'method not allowed')
    }

    // A path with both verbs advertises both, whichever one you got wrong.
    const cleanPut = await httpRequest({ port: actualPort, method: 'PUT', path: '/api/clean' })
    assert.equal(cleanPut.status, 405)
    assert.equal(cleanPut.headers.allow, 'GET, POST')

    // POST-only routes advertise POST.
    const takeoverGet = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/det-1/takeover' })
    assert.equal(takeoverGet.status, 405)
    assert.equal(takeoverGet.headers.allow, 'POST')

    // An unknown path keeps the pre-existing 404 shape — no route to name, nothing to allow.
    const missing = await httpRequest({ port: actualPort, method: 'GET', path: '/api/nope' })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'no route')
    assert.equal(missing.headers.allow, undefined)
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('router: every documented route still answers its own verb', async () => {
  // The regression net for the extraction itself: each row of the table reached, once.
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const cases = [
      ['/', 200],
      ['/index.html', 200],
      ['/favicon.ico', 204],
      ['/api/sessions', 200],
      ['/api/workers', 200],
      ['/api/workers/aggregate', 200],
      ['/api/clean', 200],
      ['/api/config', 200],
      ['/api/worker/det-1/flow', 200],
    ]
    for (const [p, expected] of cases) {
      const res = await httpRequest({ port: actualPort, method: 'GET', path: p })
      assert.equal(res.status, expected, `GET ${p}`)
    }
    // Bad ids still fail closed on the param routes.
    const badId = await httpRequest({ port: actualPort, method: 'GET', path: '/api/worker/..%2F..%2Fetc/flow' })
    assert.ok(badId.status === 400 || badId.status === 404, 'a bad id must not be served')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('router: HEAD is served by the GET route and returns headers with no body', async () => {
  // Node suppresses the body for HEAD itself; the point here is that HEAD must not become a
  // 405 casualty of adding method guards — `curl -I` worked before and has to keep working.
  const { sessionsDir, homeDir } = seedWorkerFixture()
  const port = 18800 + Math.floor(Math.random() * 1000)
  const child = startServerIsolated({ sessionsDir, homeDir, port })
  try {
    const actualPort = await waitForServerReady(child)
    const res = await httpRequest({ port: actualPort, method: 'HEAD', path: '/' })
    assert.equal(res.status, 200)
    assert.match(String(res.headers['content-type']), /^text\/html/)
    assert.equal(res.raw, '', 'HEAD must carry no body')
  } finally {
    await stopServer(child)
    rmSync(sessionsDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})
