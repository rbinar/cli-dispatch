// statusline-fragment.test.mjs — integration tests for cli-dispatch-statusline.sh.
// Spawns the script with `bash` against temp fixtures (policy + session dirs), feeds
// a plausible statusline JSON on stdin, and asserts on stdout.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/statusline-fragment.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SELF_DIR = path.dirname(new URL(import.meta.url).pathname)
const SCRIPT_PATH = path.resolve(SELF_DIR, '..', 'cli-dispatch-statusline.sh')

const tmpDirs = []

after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj))
}

function writeStatusJson(sessionDir, state, _opts = {}) {
  const s = path.join(sessionDir, 'status.json')
  const obj = { state, sessionId: path.basename(sessionDir) }
  writeJson(s, obj)
  // Set mtime — default to now, or a specific past age in seconds.
  if (_opts.mtimeAgeSec != null) {
    const past = new Date(Date.now() - _opts.mtimeAgeSec * 1000)
    fs.utimesSync(s, past, past)
  }
  return s
}

function makeSession(rootDir, id, state, mtimeAgeSec) {
  const d = path.join(rootDir, id)
  fs.mkdirSync(d, { recursive: true })
  writeStatusJson(d, state, { mtimeAgeSec })
  return d
}

// ---- helpers ----

function runStatusline({ sessionsDir, policyFile, stdinJson, timeoutMs = 5000 }) {
  const args = [SCRIPT_PATH]
  // Build env: omit vars we don't want set, include those we do.
  const env = { ...process.env }
  if (sessionsDir != null) env.CLI_DISPATCH_SESSIONS_DIR = sessionsDir
  else delete env.CLI_DISPATCH_SESSIONS_DIR
  if (policyFile != null) env.CLI_DISPATCH_POLICY_FILE = policyFile
  else delete env.CLI_DISPATCH_POLICY_FILE

  const input = stdinJson != null ? JSON.stringify(stdinJson) : undefined

  const res = spawnSync('bash', args, {
    env,
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    // bash not found → skip
  })

  if (res.error && res.error.code === 'ENOENT') {
    return { skipped: true, reason: 'bash not found' }
  }
  if (res.error) throw res.error

  return {
    skipped: false,
    stdout: res.stdout,
    stderr: res.stderr,
    status: res.status,
    signal: res.signal,
  }
}

function skipIfBashUnavailable(t, res) {
  if (res.skipped) {
    t.skip(`bash unavailable: ${res.reason}`)
  }
}

// A plausible statusline JSON the real wrapper would pipe in.
const FAKE_STDIN = {
  sessionId: 'test-session-1',
  model: { id: 'claude-sonnet-5' },
  cost: { used: 0.05, remaining: 10 },
}

// ============================================================================
// Tests
// ============================================================================

test('bash available', () => {
  // Run first test alone to fail fast if bash is not found.
  const res = spawnSync('bash', ['--version'], { encoding: 'utf8', timeout: 5000 })
  if (res.error && res.error.code === 'ENOENT') {
    assert.fail('bash is not available — all statusline-fragment tests will be skipped')
  }
})

// ---------- policy disabled, no sessions ----------

test('policy disabled, no sessions → empty stdout, exit 0', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0, `exit ${res.status}: ${res.stderr}`)
  assert.equal(res.stdout, '', 'empty policy and no sessions → must print nothing')
})

test('missing policy file, no sessions → empty stdout, exit 0', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyFile = path.join(tmpDir('cd-sl-policy-'), 'does-not-exist.json')

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.equal(res.stdout, '')
})

// ---------- policy enabled ----------

test('policy enabled:true, no sessions → [CD] badge, no ▶ counter', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: true })

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.ok(res.stdout.includes('[CD]'), `stdout must contain [CD], got: ${JSON.stringify(res.stdout)}`)
  assert.ok(!res.stdout.includes('▶'), `no worker → no ▶ counter, got: ${JSON.stringify(res.stdout)}`)
})

// ---------- running sessions ----------

test('policy disabled, one fresh running session → [CD] AND ▶1', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  makeSession(sessionsDir, 'sess-abc', 'running', 0)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0, `exit ${res.status}: ${res.stderr}`)
  assert.ok(res.stdout.includes('[CD]'), `must contain badge, got: ${JSON.stringify(res.stdout)}`)
  assert.ok(res.stdout.includes('▶1'), `must contain ▶1 counter, got: ${JSON.stringify(res.stdout)}`)
})

// ---------- stale session ----------

test('stale running session (>90s mtime) → NOT counted', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  // mtimeAgeSec: 120 — well past the 90s staleness window
  makeSession(sessionsDir, 'sess-stale', 'running', 120)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  // The script exits 0 with empty stdout because policy is disabled and no fresh
  // session is counted. The stale session must NOT produce a ▶.
  assert.equal(res.stdout, '',
    `stale session must not produce output, got: ${JSON.stringify(res.stdout)}`)
})

// ---------- terminal states ----------

test('sessions in terminal states (done, error, killed) → NOT counted', (t) => {
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  for (const state of ['done', 'error', 'killed']) {
    const sessionsDir = tmpDir(`cd-sl-test-${state}-`)
    makeSession(sessionsDir, `sess-${state}`, state, 0)

    const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
    skipIfBashUnavailable(t, res)

    assert.equal(res.status, 0)
    assert.equal(res.stdout, '',
      `state=${state} must be silent, got: ${JSON.stringify(res.stdout)}`)
  }
})

// ---------- two running ----------

test('two fresh running sessions → ▶2', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  makeSession(sessionsDir, 'sess-1', 'running', 0)
  makeSession(sessionsDir, 'sess-2', 'running', 0)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.ok(res.stdout.includes('▶2'), `must contain ▶2, got: ${JSON.stringify(res.stdout)}`)
})

// ---------- mixed: one fresh, one stale, one terminal ----------

test('mixed sessions: only fresh running counted', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  makeSession(sessionsDir, 'sess-fresh', 'running', 0)
  makeSession(sessionsDir, 'sess-stale', 'running', 200)
  makeSession(sessionsDir, 'sess-done', 'done', 0)
  makeSession(sessionsDir, 'sess-error', 'error', 0)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.ok(res.stdout.includes('▶1'),
    `only 1 fresh running → ▶1, got: ${JSON.stringify(res.stdout)}`)
  assert.ok(!res.stdout.includes('▶2'))
  assert.ok(!res.stdout.includes('▶3'))
  assert.ok(!res.stdout.includes('▶4'))
})

// ---------- stdin drain ----------

test('stdin drain: does not hang when stdin is given', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: true })

  // Large stdin — proves cat >/dev/null drains it fully without blocking.
  const largeStdin = { items: Array.from({ length: 1000 }, (_, i) => `line-${i}`) }

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: largeStdin })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.ok(res.stdout.includes('[CD]'))
})

test('stdin drain: does not hang when stdin is closed immediately (no input)', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: true })

  // Pass undefined stdin → spawnSync closes stdin immediately.
  const res = runStatusline({ sessionsDir, policyFile, stdinJson: undefined })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.ok(res.stdout.includes('[CD]'))
})

// ---------- ANSI escape ----------

test('output contains ANSI escape codes', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: true })

  makeSession(sessionsDir, 'sess-1', 'running', 0)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  // \x1b is the ESC character — $'\033' in bash produces this byte.
  assert.ok(res.stdout.includes('\x1b'),
    `output must contain ANSI escape byte, got: ${JSON.stringify(res.stdout)}`)
  // Verify both colour codes are present (cyan for badge, yellow for counter).
  const escCount = (res.stdout.match(/\x1b/g) || []).length
  assert.ok(escCount >= 2, `expected ≥2 escape sequences, found ${escCount}`)
})

// ---------- only fresh sessions counted (boundary: exactly at 90s) ----------

test('session at exactly 90s is counted (≤ stale threshold)', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  // The script uses `-le 90`, so exactly 90s old is still counted.
  makeSession(sessionsDir, 'sess-boundary', 'running', 90)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.ok(res.stdout.includes('▶1'),
    `session at 90s must be counted (≤), got: ${JSON.stringify(res.stdout)}`)
})

test('session at 91s is NOT counted (> stale threshold)', (t) => {
  const sessionsDir = tmpDir('cd-sl-test-')
  const policyDir = tmpDir('cd-sl-policy-')
  const policyFile = path.join(policyDir, 'policy.json')
  writeJson(policyFile, { enabled: false })

  // 91s > 90s staleness window — must be excluded.
  makeSession(sessionsDir, 'sess-over', 'running', 91)

  const res = runStatusline({ sessionsDir, policyFile, stdinJson: FAKE_STDIN })
  skipIfBashUnavailable(t, res)

  assert.equal(res.status, 0)
  assert.equal(res.stdout, '',
    `session at 91s (>90) must not be counted, got: ${JSON.stringify(res.stdout)}`)
})
