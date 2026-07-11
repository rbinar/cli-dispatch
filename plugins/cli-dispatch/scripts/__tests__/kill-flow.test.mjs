// kill-flow.test.mjs — integration tests for the worker.pid tree-kill logic embedded in
// commands/kill.md's fenced ```bash block.
//
// STRATEGY (a) chosen over (b): kill.md's bash block is a self-contained shell fragment
// with no external dependency on the surrounding markdown template beyond two env-driven
// inputs ($ARGUMENTS for the session id, CLI_DISPATCH_SESSIONS_DIR for the session root) —
// both of which the real /cli-dispatch:kill invocation also supplies via env/substitution.
// That means the fence can be extracted verbatim and executed standalone under `bash`
// against a fake (tmp) session dir + fake (self-spawned, harmless) process trees, and the
// real observable effects (process death, status.json mutation) asserted directly — a far
// stronger test than a syntax-only check, and the fence has no unresolvable dependency that
// would force falling back to strategy (b).
//
// Every process this file kills is spawned by this file itself (bash/sleep children under a
// fresh detached process group) — it never touches a PID it didn't create.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/kill-flow.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const KILL_MD = path.resolve(SELF_DIR, '..', '..', 'commands', 'kill.md')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }
const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

// ---- extract the ```bash fence from kill.md verbatim ----
function extractBashBlock(mdPath) {
  const content = fs.readFileSync(mdPath, 'utf8')
  const match = content.match(/```bash\n([\s\S]*?)\n```/)
  assert.ok(match, `no \`\`\`bash fence found in ${mdPath}`)
  return match[1]
}

const killScriptDir = mkdtemp('cli-dispatch-killmd-')
const killScriptPath = path.join(killScriptDir, 'kill-block.sh')
fs.writeFileSync(killScriptPath, extractBashBlock(KILL_MD))

after(() => { rmrf(killScriptDir) })

// ---- run the extracted script exactly the way the real slash command invokes it: SID via
// $ARGUMENTS, session root via CLI_DISPATCH_SESSIONS_DIR ----
function runKillScript({ sid, sessionsRoot, extraEnv = {} }) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [killScriptPath], {
      env: { ...process.env, ARGUMENTS: sid, CLI_DISPATCH_SESSIONS_DIR: sessionsRoot, ...extraEnv },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function seedSession(root, id, status) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status))
  return dir
}

function getChildPids(pid) {
  try {
    return execSync(`pgrep -P ${pid}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

// ============================================================================
// Test 0: sanity — the extracted fence is syntactically valid bash on its own
// ============================================================================
test('kill.md bash fence: extracted script passes `bash -n` syntax check', () => {
  assert.doesNotThrow(() => execSync(`bash -n "${killScriptPath}"`, { stdio: 'pipe' }))
})

// ============================================================================
// Test 1: terminal-state guard — a non-"running" session is left untouched, nothing killed
// ============================================================================
test('terminal-state guard: session already state=done is skipped, status.json untouched, exit 0', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-guard-')
  const id = 'test-guard-done-' + crypto.randomBytes(4).toString('hex')
  try {
    const dir = seedSession(sessionsRoot, id, { state: 'done', completedVia: 'normal' })
    const res = await runKillScript({ sid: id, sessionsRoot })

    assert.equal(res.code, 0, `expected exit 0, got ${res.code}; stderr: ${res.stderr}`)
    assert.match(res.stdout, /not running \(state: done\)/, 'expected "not running" message naming the existing state')

    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
    assert.equal(status.state, 'done', 'status.json state must remain untouched (still done)')
    assert.equal(status.killedAt, undefined, 'no killedAt should have been added — kill was never attempted')
  } finally {
    rmrf(sessionsRoot)
  }
})

// Same guard, but for the other non-terminal-but-not-"running" state the script explicitly
// treats as skip-worthy too (only state === "running" triggers a kill attempt).
test('terminal-state guard: session state=human-controlled is also skipped (only "running" triggers a kill)', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-guard-hc-')
  const id = 'test-guard-hc-' + crypto.randomBytes(4).toString('hex')
  try {
    const dir = seedSession(sessionsRoot, id, { state: 'human-controlled', takeover: { active: true } })
    const res = await runKillScript({ sid: id, sessionsRoot })

    assert.equal(res.code, 0)
    assert.match(res.stdout, /not running \(state: human-controlled\)/)

    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
    assert.equal(status.state, 'human-controlled', 'status.json state must remain untouched')
  } finally {
    rmrf(sessionsRoot)
  }
})

// ============================================================================
// Test 2: real tree-kill via worker.pid — root + child processes are actually killed, and
// status.json is finalized to state=killed (no parser existed to write its own record)
// ============================================================================
test('worker.pid tree-kill: running session with a live process tree is fully killed, status.json -> killed', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-tree-')
  const id = 'test-tree-' + crypto.randomBytes(4).toString('hex')
  // Simulate the *-stream wrapper: a root process (worker.pid) that itself has spawned
  // child processes (the worker CLI + parser pipeline), exactly the shape proc_tree/kill_tree
  // in kill.md is designed to walk via `pgrep -P`.
  const root = spawn('bash', ['-c', 'sleep 300 & sleep 300 & wait'], { detached: true, stdio: 'ignore' })
  root.unref()
  try {
    const dir = seedSession(sessionsRoot, id, { state: 'running' })
    await sleep(300) // let the two `sleep 300` children actually fork before we snapshot them
    const childPids = getChildPids(root.pid)
    assert.equal(childPids.length, 2, `expected 2 child sleep processes under root ${root.pid}, found ${childPids.length}`)
    fs.writeFileSync(path.join(dir, 'worker.pid'), String(root.pid))

    const res = await runKillScript({ sid: id, sessionsRoot })

    assert.equal(res.code, 0, `expected exit 0, got ${res.code}; stderr: ${res.stderr}`)
    assert.match(res.stdout, new RegExp(`killed worker process tree \\(root PID ${root.pid} from worker\\.pid\\)`))

    assert.equal(isAlive(root.pid), false, `root pid ${root.pid} should be dead after kill_tree`)
    for (const cpid of childPids) {
      assert.equal(isAlive(cpid), false, `child pid ${cpid} should be dead after kill_tree (tree-kill, not just root)`)
    }

    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
    assert.equal(status.state, 'killed', 'status.json state should be finalized to killed (no parser wrote its own terminal record)')
    assert.ok(status.killedAt, 'status.json should carry a killedAt timestamp')
  } finally {
    try { if (isAlive(root.pid)) process.kill(root.pid, 'SIGKILL') } catch { /* ignore */ }
    rmrf(sessionsRoot)
  }
})

// ============================================================================
// Test 3: never clobber a terminal record the worker/parser wrote itself. Simulates a
// worker process that traps SIGTERM (as a real *-stream parser would on EOF) and writes its
// OWN terminal state before exiting — kill.md's final guard must leave that record alone
// rather than force-overwriting it to "killed".
// ============================================================================
test('finalize guard: does not clobber a terminal status the killed worker wrote for itself on TERM', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-selfwrite-')
  const id = 'test-selfwrite-' + crypto.randomBytes(4).toString('hex')
  const dir = seedSession(sessionsRoot, id, { state: 'running' })
  const statusFile = path.join(dir, 'status.json')

  const wrapperDir = mkdtemp('cli-dispatch-kill-wrapper-')
  const wrapperPath = path.join(wrapperDir, 'self-reporting-worker.sh')
  // On SIGTERM (the graceful signal kill_tree sends first, well before the follow-up KILL),
  // write its own terminal record to status.json and exit cleanly — mirrors a real
  // *-stream parser getting its EOF/TERM window to finalize before being force-killed.
  fs.writeFileSync(wrapperPath, [
    '#!/usr/bin/env bash',
    'STATUS_FILE="$1"',
    'trap \'printf "%s" "{\\"state\\":\\"error\\",\\"error\\":\\"simulated-self-report\\"}" > "$STATUS_FILE"; exit 0\' TERM',
    'sleep 300 &',
    'wait',
    '',
  ].join('\n'))
  fs.chmodSync(wrapperPath, 0o755)

  const root = spawn('bash', [wrapperPath, statusFile], { detached: true, stdio: 'ignore' })
  root.unref()
  try {
    fs.writeFileSync(path.join(dir, 'worker.pid'), String(root.pid))
    await sleep(300) // let the wrapper install its trap and fork its own sleep child

    const res = await runKillScript({ sid: id, sessionsRoot })

    assert.equal(res.code, 0, `expected exit 0, got ${res.code}; stderr: ${res.stderr}`)
    assert.match(res.stdout, /state already terminal \(error\) — left as-is/, 'expected the finalize step to report the pre-existing terminal state and skip overwriting it')

    assert.equal(isAlive(root.pid), false, 'wrapper process should be dead (either via its own TERM-trap exit or the follow-up KILL)')

    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(status.state, 'error', 'status.json state must remain "error" as the worker wrote it — NOT overwritten to "killed"')
    assert.equal(status.killedAt, undefined, 'kill.md must not add killedAt when it did not perform the final state transition itself')
  } finally {
    try { if (isAlive(root.pid)) process.kill(root.pid, 'SIGKILL') } catch { /* ignore */ }
    rmrf(sessionsRoot)
    rmrf(wrapperDir)
  }
})

// ============================================================================
// Test 4: fallback path — no live worker.pid (missing entirely), the session id is found in
// a process's argv instead and that process tree is killed via the pgrep -f "$SID" fallback.
// ============================================================================
test('fallback path: no worker.pid — session id found via pgrep -f in argv is killed and status.json -> killed', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-fallback-')
  const id = 'test-fallback-' + crypto.randomBytes(4).toString('hex')
  try {
    const dir = seedSession(sessionsRoot, id, { state: 'running' })
    // No worker.pid file at all — forces the fallback branch. Give the process an argv that
    // contains the (unique, random-suffixed) session id so `pgrep -f "$SID"` matches only it.
    // NOTE: the marker MUST be a plain positional arg, not a `--flag=value`-shaped one — node's
    // own CLI parser intercepts unrecognized `--foo` args after `-e` and refuses to start
    // ("bad option"), which would make the process exit immediately and defeat the fixture.
    const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)', id], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    await sleep(300)

    const res = await runKillScript({ sid: id, sessionsRoot })

    assert.equal(res.code, 0, `expected exit 0, got ${res.code}; stderr: ${res.stderr}`)
    assert.match(res.stdout, new RegExp(`killed process tree for PID ${proc.pid} \\(worker\\.pid unavailable`))

    assert.equal(isAlive(proc.pid), false, `fallback-matched pid ${proc.pid} should be dead`)

    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
    assert.equal(status.state, 'killed')
    assert.ok(status.killedAt)
  } finally {
    rmrf(sessionsRoot)
  }
})

// ============================================================================
// Test 5: edge case — session directory does not exist at all
// ============================================================================
test('missing session dir: exits 1 with "no such session" and touches nothing', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-missing-')
  try {
    const res = await runKillScript({ sid: 'does-not-exist-' + crypto.randomBytes(4).toString('hex'), sessionsRoot })
    assert.equal(res.code, 1)
    assert.match(res.stdout, /no such session/)
  } finally {
    rmrf(sessionsRoot)
  }
})

// ============================================================================
// Test 6: edge case — no session id argument at all (usage message)
// ============================================================================
test('missing SID argument: prints usage and exits 1', async () => {
  const sessionsRoot = mkdtemp('cli-dispatch-kill-noarg-')
  try {
    const res = await runKillScript({ sid: '', sessionsRoot })
    assert.equal(res.code, 1)
    assert.match(res.stdout, /usage:.*cli-dispatch:kill/)
  } finally {
    rmrf(sessionsRoot)
  }
})
