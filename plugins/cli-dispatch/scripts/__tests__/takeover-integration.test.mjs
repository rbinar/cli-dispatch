#!/usr/bin/env node
// takeover-integration.test.mjs — LIVE, end-to-end integration tests for the human-takeover
// HTTP/WS flow (dashboard-server.mjs), for the two Phase-2 backends chosen for real exercise:
// DeepSeek (mandatory — account/billing-sensitive env vars) and OpenCode (chosen as the
// second backend — also gets its own session-store-precondition negative test).
//
// This is a PLAIN SCRIPT (not `node --test`) so scenario ordering, process spawning, and
// per-scenario cleanup are all explicit and easy to follow top-to-bottom. Run with:
//
//   node plugins/cli-dispatch/scripts/__tests__/takeover-integration.test.mjs
//
// It spawns REAL dashboard-server.mjs processes (one per scenario, isolated by a fresh
// CLI_DISPATCH_SESSIONS_DIR temp dir + a fresh high port), drives them over real HTTP and a
// hand-rolled RFC6455 WebSocket client (there is no `ws` npm package in this repo, by
// design — see dashboard-server.mjs's own hand-rolled server-side framing, which this
// client's frame encode/decode mirrors), and asserts on real process liveness / on-disk
// status.json state / real PTY keystroke echoes from stub CLI executables placed on PATH.
//
// Nothing here is mocked at the JS level: the "old worker" is a real lingering child
// process, the "backend CLI" is a real (stub) executable spawned under a real PTY
// (node-pty is not installed in this environment, so pty-host.mjs's `script`-based
// zero-native fallback is what actually gets exercised here), and the WebSocket bridge is
// driven with real bytes over a real socket.

import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { clearTakeoverState, touchTakeoverHeartbeat } from '../parse-utils.mjs'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = path.join(SELF_DIR, '..', 'dashboard-server.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }
const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

// ---- stub backend CLI executables ----
// A trivial interactive echo-loop: reads lines from stdin (under a real PTY, this reads
// keystrokes-until-newline) and echoes a recognizable prefixed line back, so the test can
// send a known string over the WS and assert the prefixed echo comes back — proving a REAL
// keystroke round-tripped WS -> PTY -> stub-CLI -> PTY -> WS.
function writeStubBins(dir, names) {
  fs.mkdirSync(dir, { recursive: true })
  const body = '#!/usr/bin/env bash\nwhile IFS= read -r line; do\n  echo "echo:$line"\ndone\n'
  for (const name of names) {
    const p = path.join(dir, name)
    fs.writeFileSync(p, body)
    fs.chmodSync(p, 0o755)
  }
}

// ---- fake "running" worker session on disk ----
function spawnLingeringChild() {
  // A real, currently-running lingering child process — this is what proves the takeover
  // endpoint actually kills the old headless worker (process.kill(pid, 0) should throw
  // ESRCH after takeover).
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  return child.pid
}

function seedSession(root, id, meta) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ state: 'running' }))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta))
  fs.writeFileSync(path.join(dir, 'progress.log'), '')
  const pid = spawnLingeringChild()
  fs.writeFileSync(path.join(dir, 'worker.pid'), String(pid))
  return { dir, pid }
}

// ---- dashboard-server.mjs process lifecycle ----
function startServer(env, port) {
  return spawn(process.execPath, [SERVER_PATH, '--port', String(port), '--no-open'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

function waitForServerReady(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('server did not start in time; stderr so far: ' + buf)), timeoutMs)
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (m) { clearTimeout(timer); resolve(parseInt(m[1], 10)) }
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (code ${code}); stderr: ${buf}`)) })
  })
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ }; resolve() }, 4000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { child.kill('SIGTERM') } catch { clearTimeout(timer); resolve() }
  })
}

// ---- plain HTTP helper ----
function httpRequest({ port, method, path: p, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(body) } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: json, raw: body })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function authHeaders(port, extra = {}) {
  return {
    Origin: `http://127.0.0.1:${port}`,
    Host: `127.0.0.1:${port}`,
    'X-CLI-Dispatch-Takeover': '1',
    ...extra,
  }
}

// ---- hand-rolled RFC6455 WebSocket client ----
// Node has no built-in WebSocket client that supports setting custom Origin/Host headers
// (needed here — dashboard-server.mjs's auth middleware fail-closed checks both), so this
// implements just enough of the client side of RFC6455 by hand: an http.request() with
// Upgrade headers to get the raw socket, then manual frame encode (client->server frames
// MUST be masked) and decode (server->client frames are unmasked, single-frame text only —
// mirrors dashboard-server.mjs's own `sendWsFrame`/`attachWsFrameParser` wire format,
// which was read carefully to match this).
function wsConnect(port, wsPath, token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      path: wsPath + '?token=' + encodeURIComponent(token),
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    })
    req.on('upgrade', (_res, socket) => resolve(socket))
    req.on('response', (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => reject(new Error(`expected 101 upgrade, got ${res.statusCode}: ${body}`)))
    })
    req.on('error', reject)
    req.end()
  })
}

function wsSendJson(socket, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8')
  const len = payload.length
  const maskKey = crypto.randomBytes(4)
  let header
  if (len < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = 0x80 | len }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2) }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
  const masked = Buffer.alloc(len)
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i % 4]
  socket.write(Buffer.concat([header, maskKey, masked]))
}

// Waits for a text-frame JSON message satisfying `predicate`. Buffers/parses incoming
// frames incrementally (same shape as dashboard-server.mjs's attachWsFrameParser).
function wsReadUntil(socket, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const seen = []
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout waiting for WS message matching predicate; messages seen: ' + JSON.stringify(seen)))
    }, timeoutMs)
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        if (buf.length < 2) return
        const b1 = buf[1]
        const masked = !!(b1 & 0x80)
        let len = b1 & 0x7f
        let offset = 2
        if (len === 126) {
          if (buf.length < offset + 2) return
          len = buf.readUInt16BE(offset); offset += 2
        } else if (len === 127) {
          if (buf.length < offset + 8) return
          len = Number(buf.readBigUInt64BE(offset)); offset += 8
        }
        let maskKey = null
        if (masked) {
          if (buf.length < offset + 4) return
          maskKey = buf.subarray(offset, offset + 4); offset += 4
        }
        if (buf.length < offset + len) return
        let payload = buf.subarray(offset, offset + len)
        if (masked) {
          const un = Buffer.alloc(len)
          for (let i = 0; i < len; i++) un[i] = payload[i] ^ maskKey[i % 4]
          payload = un
        }
        const opcode = buf[0] & 0x0f
        buf = buf.subarray(offset + len)
        if (opcode === 0x1) {
          const str = payload.toString('utf8')
          seen.push(str)
          let msg = null
          try { msg = JSON.parse(str) } catch { /* ignore non-JSON */ }
          if (msg && predicate(msg)) { cleanup(); resolve(msg); return }
        }
        // close/ping/pong/binary frames: not needed for these tests, ignored.
      }
    }
    function cleanup() { clearTimeout(timer); socket.removeListener('data', onData) }
    socket.on('data', onData)
  })
}

// ---- generic full round-trip (Scenarios A & B share this shape) ----
async function runFullRoundTrip({ label, backend, stubNames, metaFieldsFn, extraEnv }) {
  const log = (msg) => console.log(`  [${label}] ${msg}`)
  const sessionsRoot = mkdtemp('cli-dispatch-sessions-')
  const stubBin = mkdtemp('cli-dispatch-stubbin-')
  const cwdDir = mkdtemp('cli-dispatch-cwd-')
  writeStubBins(stubBin, stubNames)
  const id = 'test-' + backend + '-' + crypto.randomBytes(4).toString('hex')
  const meta = { backend, cwd: cwdDir, ...metaFieldsFn(id) }
  const { pid: oldPid } = seedSession(sessionsRoot, id, meta)
  log(`seeded session ${id} (backend=${backend}), old worker pid=${oldPid}`)

  let serverChild = null
  let ws = null
  try {
    const env = {
      ...process.env,
      CLI_DISPATCH_SESSIONS_DIR: sessionsRoot,
      PATH: stubBin + path.delimiter + process.env.PATH,
      ...extraEnv,
    }
    const port = 18000 + Math.floor(Math.random() * 900)
    serverChild = startServer(env, port)
    const actualPort = await waitForServerReady(serverChild)
    log(`dashboard-server up on port ${actualPort}`)

    // Step 3: POST takeover
    const tkRes = await httpRequest({ port: actualPort, method: 'POST', path: `/api/worker/${id}/takeover`, headers: authHeaders(actualPort) })
    assert.equal(tkRes.status, 200, 'takeover POST should 200: ' + tkRes.raw)
    assert.equal(tkRes.body.ws, `/pty/${id}`, 'ws path should match /pty/<id>')
    assert.ok(tkRes.body.token, 'response should include a token')
    log(`takeover POST -> 200 { ws: "${tkRes.body.ws}", token: "${tkRes.body.token.slice(0, 8)}...", cols: ${tkRes.body.cols}, rows: ${tkRes.body.rows} }`)

    // Step 4: old worker pid is dead (kill_worker_tree TERM->poll(~1.5s)->KILL)
    await sleep(600)
    assert.equal(isAlive(oldPid), false, `old worker pid ${oldPid} should be dead after takeover`)
    log(`old worker pid ${oldPid} confirmed dead (process.kill(pid,0) threw ESRCH)`)

    // Step 5: status.json now human-controlled with a takeover sub-object
    const statusFile = path.join(sessionsRoot, id, 'status.json')
    const status1 = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(status1.state, 'human-controlled', 'status.json state should be human-controlled')
    assert.ok(status1.takeover && status1.takeover.active === true, 'status.json should have an active takeover object')
    log(`status.json confirmed: state="human-controlled", takeover.active=true, takeover.ptyPid=${status1.takeover.ptyPid}`)

    // Step 6: real WS round trip — connect, send a keystroke line, expect the stub's echo
    ws = await wsConnect(actualPort, tkRes.body.ws, tkRes.body.token)
    log('WS upgraded (101 Switching Protocols)')
    // Give the script-fallback PTY (sh -c 'exec cat | script -q /dev/null "$@"' <stub>) a
    // moment to actually exec the stub before we write to its stdin.
    await sleep(500)
    wsSendJson(ws, { t: 'i', d: 'hello-takeover\n' })
    const echoMsg = await wsReadUntil(ws, (m) => m.t === 'o' && typeof m.d === 'string' && m.d.includes('echo:hello-takeover'))
    log(`WS echo received: ${JSON.stringify(echoMsg.d)}`)

    // Step 7: handback
    const hbRes = await httpRequest({ port: actualPort, method: 'POST', path: `/api/worker/${id}/handback`, headers: authHeaders(actualPort) })
    assert.equal(hbRes.status, 200, 'handback POST should 200: ' + hbRes.raw)
    assert.equal(hbRes.body.state, 'done', 'handback response should be {state:"done"}')
    log('handback POST -> 200 { state: "done" }')

    // Step 8: status.json finalized
    await sleep(300)
    const status2 = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(status2.state, 'done', 'status.json state should be done after handback')
    assert.equal(status2.completedVia, 'human-takeover', 'status.json completedVia should be human-takeover')
    assert.ok(!status2.takeover, 'status.json takeover sub-object should be removed after handback')
    log('status.json confirmed final: state="done", completedVia="human-takeover", takeover object removed')

    return { ok: true }
  } finally {
    try { if (ws) ws.destroy() } catch { /* ignore */ }
    // Step 9: teardown
    if (serverChild) {
      await stopServer(serverChild)
      console.log(`  [${label}] dashboard-server exited cleanly on SIGTERM`)
    }
    try { if (isAlive(oldPid)) process.kill(oldPid, 'SIGKILL') } catch { /* ignore */ }
    rmrf(sessionsRoot); rmrf(stubBin); rmrf(cwdDir)
  }
}

// ---- Scenario A: DeepSeek full round-trip (mandatory) ----
async function scenarioA() {
  console.log('\n=== Scenario A: DeepSeek full round-trip ===')
  await runFullRoundTrip({
    label: 'A-deepseek',
    backend: 'deepseek',
    stubNames: ['claude'],
    metaFieldsFn: (id) => ({ sessionId: id }), // DeepSeek meta field is sessionId, not threadId
    extraEnv: { DEEPSEEK_API_KEY: 'test-fake-key' },
  })
  console.log('Scenario A: PASS')
}

// ---- Scenario B: OpenCode full round-trip ----
async function scenarioB() {
  console.log('\n=== Scenario B: OpenCode full round-trip ===')
  const xdgDataHome = mkdtemp('cli-dispatch-xdg-')
  fs.mkdirSync(path.join(xdgDataHome, 'opencode'), { recursive: true })
  fs.writeFileSync(path.join(xdgDataHome, 'opencode', 'opencode.db'), '') // existence-only check
  try {
    await runFullRoundTrip({
      label: 'B-opencode',
      backend: 'opencode',
      stubNames: ['opencode'],
      metaFieldsFn: (id) => ({ threadId: id }),
      extraEnv: { OPENROUTER_API_KEY: 'test-fake-key', XDG_DATA_HOME: xdgDataHome },
    })
  } finally {
    rmrf(xdgDataHome)
  }
  console.log('Scenario B: PASS')
}

// ---- Scenario C: OpenCode session-store-missing negative test ----
async function scenarioC() {
  console.log('\n=== Scenario C: OpenCode session-store-missing negative test ===')
  const sessionsRoot = mkdtemp('cli-dispatch-sessions-')
  const stubBin = mkdtemp('cli-dispatch-stubbin-')
  const cwdDir = mkdtemp('cli-dispatch-cwd-')
  const xdgDataHome = mkdtemp('cli-dispatch-xdg-empty-') // deliberately: no opencode/opencode.db inside
  writeStubBins(stubBin, ['opencode'])
  const id = 'test-opencode-neg-' + crypto.randomBytes(4).toString('hex')
  const meta = { backend: 'opencode', cwd: cwdDir, threadId: id }
  const { pid: oldPid } = seedSession(sessionsRoot, id, meta)
  console.log(`  [C] seeded session ${id}, old worker pid=${oldPid}, XDG_DATA_HOME has no opencode.db/opencode-stable.db`)

  let serverChild = null
  try {
    const env = {
      ...process.env,
      CLI_DISPATCH_SESSIONS_DIR: sessionsRoot,
      PATH: stubBin + path.delimiter + process.env.PATH,
      OPENROUTER_API_KEY: 'test-fake-key',
      XDG_DATA_HOME: xdgDataHome,
    }
    const port = 18000 + Math.floor(Math.random() * 900)
    serverChild = startServer(env, port)
    const actualPort = await waitForServerReady(serverChild)
    console.log(`  [C] dashboard-server up on port ${actualPort}`)

    const tkRes = await httpRequest({ port: actualPort, method: 'POST', path: `/api/worker/${id}/takeover`, headers: authHeaders(actualPort) })
    assert.equal(tkRes.status, 409, 'expected 409 for missing session store, got ' + tkRes.status + ': ' + tkRes.raw)
    assert.equal(tkRes.body.error, 'session store missing', 'expected {error:"session store missing"}')
    console.log('  [C] 409 { error: "session store missing" } confirmed')

    // Registry never advanced: status.json untouched.
    const statusFile = path.join(sessionsRoot, id, 'status.json')
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(status.state, 'running', 'status.json should remain state=running (never rewritten to human-controlled)')
    console.log('  [C] status.json still state="running" (never rewritten to human-controlled)')

    // The precondition check happens BEFORE the worker-kill step in handleTakeover, so the
    // old "worker" process must still be alive — nothing was killed for a rejected request.
    assert.equal(isAlive(oldPid), true, 'old worker pid should NOT have been killed (request was rejected before the kill step)')
    console.log(`  [C] old worker pid ${oldPid} confirmed still alive (never killed)`)

    // No orphan opencode stub process left running (no PTY was ever spawned).
    await sleep(300)
    let psOut = ''
    try { psOut = execSync(`pgrep -f "${stubBin}/opencode" || true`, { encoding: 'utf8' }).trim() } catch { psOut = '' }
    assert.equal(psOut, '', 'expected no opencode stub process running, found pids: ' + psOut)
    console.log('  [C] no orphan opencode stub process found via pgrep -f')

    console.log('Scenario C: PASS')
  } finally {
    if (serverChild) {
      await stopServer(serverChild)
      console.log('  [C] dashboard-server exited cleanly on SIGTERM')
    }
    try { if (isAlive(oldPid)) process.kill(oldPid, 'SIGKILL') } catch { /* ignore */ }
    rmrf(sessionsRoot); rmrf(stubBin); rmrf(cwdDir); rmrf(xdgDataHome)
  }
}

// ---- Scenario D (bonus): re-entrancy 409 guard sanity check ----
async function scenarioD() {
  console.log('\n=== Scenario D (bonus): re-entrancy 409 guard ===')
  const sessionsRoot = mkdtemp('cli-dispatch-sessions-')
  const stubBin = mkdtemp('cli-dispatch-stubbin-')
  const cwdDir = mkdtemp('cli-dispatch-cwd-')
  writeStubBins(stubBin, ['claude'])
  const id = 'test-deepseek-reentrancy-' + crypto.randomBytes(4).toString('hex')
  const meta = { backend: 'deepseek', cwd: cwdDir, sessionId: id }
  const { pid: oldPid } = seedSession(sessionsRoot, id, meta)

  let serverChild = null
  try {
    const env = {
      ...process.env,
      CLI_DISPATCH_SESSIONS_DIR: sessionsRoot,
      PATH: stubBin + path.delimiter + process.env.PATH,
      DEEPSEEK_API_KEY: 'test-fake-key',
    }
    const port = 18000 + Math.floor(Math.random() * 900)
    serverChild = startServer(env, port)
    const actualPort = await waitForServerReady(serverChild)
    console.log(`  [D] dashboard-server up on port ${actualPort}`)

    const tk1 = await httpRequest({ port: actualPort, method: 'POST', path: `/api/worker/${id}/takeover`, headers: authHeaders(actualPort) })
    assert.equal(tk1.status, 200, 'first takeover POST should succeed: ' + tk1.raw)
    console.log('  [D] first takeover POST -> 200 (active)')

    const tk2 = await httpRequest({ port: actualPort, method: 'POST', path: `/api/worker/${id}/takeover`, headers: authHeaders(actualPort) })
    assert.equal(tk2.status, 409, 'second takeover POST should 409: ' + tk2.raw)
    assert.match(tk2.body.error, /already active/, 'expected "already active" in the 409 error')
    console.log('  [D] second takeover POST -> 409 { error: "' + tk2.body.error + '" } confirmed')

    await httpRequest({ port: actualPort, method: 'POST', path: `/api/worker/${id}/handback`, headers: authHeaders(actualPort) })
    console.log('Scenario D: PASS')
  } finally {
    if (serverChild) {
      await stopServer(serverChild)
      console.log('  [D] dashboard-server exited cleanly on SIGTERM')
    }
    try { if (isAlive(oldPid)) process.kill(oldPid, 'SIGKILL') } catch { /* ignore */ }
    rmrf(sessionsRoot); rmrf(stubBin); rmrf(cwdDir)
  }
}

// ---- Scenario E: reap-after-heartbeat no-op (Fix 1 unit-level guard) ----
// Pure on-disk unit test (no server): proves touchTakeoverHeartbeat does NOT resurrect a
// session that an out-of-process reaper already cleared. Simulates the TOCTOU race outcome
// by clearing the takeover to a terminal 'error' state, then calling the heartbeat and
// asserting it left state/takeover untouched (no revival to 'human-controlled').
async function scenarioE() {
  console.log('\n=== Scenario E: reap-after-heartbeat no-op (Fix 1 guard) ===')
  const sessionsRoot = mkdtemp('cli-dispatch-heartbeat-')
  try {
    const dir = path.join(sessionsRoot, 'test-heartbeat-noop')
    fs.mkdirSync(dir, { recursive: true })
    const statusFile = path.join(dir, 'status.json')

    // Seed an in-progress takeover.
    fs.writeFileSync(statusFile, JSON.stringify({
      state: 'human-controlled',
      takeover: { active: true, startedAt: new Date().toISOString(), host: 'test', lastHeartbeat: new Date().toISOString(), ptyPid: 4242, ptyPgid: 4242 },
    }, null, 2) + '\n')

    // Reaper clears the stale takeover -> terminal 'error', takeover sub-object removed.
    clearTakeoverState(statusFile, { finalState: 'error', error: 'stale takeover reaped' })
    const afterReap = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(afterReap.state, 'error', 'after reap, state should be error')
    assert.equal(afterReap.takeover, undefined, 'after reap, takeover should be removed')
    console.log('  [E] reap applied: state="error", takeover removed')

    // A racing heartbeat lands AFTER the reap — it must be a no-op (no revival).
    touchTakeoverHeartbeat(statusFile)
    const afterBeat = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(afterBeat.state, 'error', 'heartbeat must NOT revive state to human-controlled')
    assert.equal(afterBeat.takeover, undefined, 'heartbeat must NOT re-create the takeover sub-object')
    console.log('  [E] post-heartbeat: state still "error", takeover still absent (no revival)')

    console.log('Scenario E: PASS')
  } finally {
    rmrf(sessionsRoot)
  }
}

async function main() {
  const scenarios = [
    ['A (DeepSeek round-trip, mandatory)', scenarioA],
    ['B (OpenCode round-trip)', scenarioB],
    ['C (OpenCode store-missing negative)', scenarioC],
    ['D (bonus: re-entrancy 409)', scenarioD],
    ['E (Fix 1: reap-after-heartbeat no-op)', scenarioE],
  ]
  const summary = []
  for (const [name, fn] of scenarios) {
    try {
      await fn()
      summary.push([name, 'PASS'])
    } catch (e) {
      summary.push([name, 'FAIL: ' + ((e && e.stack) || e)])
      console.error(`\n!!! Scenario ${name} FAILED !!!`)
      console.error(e)
    }
  }
  console.log('\n=== SUMMARY ===')
  for (const [name, res] of summary) console.log(`${res.startsWith('PASS') ? 'PASS' : 'FAIL'} — ${name}`)
  const anyFail = summary.some(([, r]) => r.startsWith('FAIL'))
  process.exit(anyFail ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL (uncaught in main):', e)
  process.exit(1)
})
