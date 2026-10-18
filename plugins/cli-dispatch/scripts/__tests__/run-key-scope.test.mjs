// The dispatch tool hands the dispatched backend's plugin-config key to cli-dispatch-run in the
// private variable CLI_DISPATCH_RUN_KEY. The runner must give it to the worker (and to the
// --fix-attempts resume) under the real variable name, and to nothing else: not to --verify, not
// to any argv. Harness as in worker-death-verdict.test.mjs: the runner is copied next to stubs.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SENTINEL = 'SENTINEL-RUN-KEY-123'

const have = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0

function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-runkey-'))
  const bin = path.join(dir, 'bin'); mkdirSync(bin)
  for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
    copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); chmodSync(path.join(bin, f), 0o755)
  }
  const repo = path.join(dir, 'repo')
  execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo seed > note.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed`)
  const sessions = path.join(dir, 'sessions'); mkdirSync(sessions)
  const rec = path.join(dir, 'rec'); mkdirSync(rec)
  const sid = 'ds-key-session'
  // Stub worker runner: records the worker's key view and its own argv, then makes a session.
  writeFileSync(path.join(bin, 'ds-worktree-run.sh'), `#!/usr/bin/env bash
REPO="$1"
S="${sessions}/${sid}"
mkdir -p "$S"
printf '%s|%s\\n' "\${DEEPSEEK_API_KEY:-}" "\${CLI_DISPATCH_RUN_KEY:-}" >> "${rec}/worker-env"
ps -o args= -p $$ >> "${rec}/worker-argv"
printf '{"state":"done","sessionId":"${sid}","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "claude-ds session: ${sid}" >&2
exit 0
`)
  chmodSync(path.join(bin, 'ds-worktree-run.sh'), 0o755)
  // Stub resume target (--fix-attempts runs claude-ds-stream --resume): records and "fixes".
  writeFileSync(path.join(bin, 'claude-ds-stream'), `#!/usr/bin/env bash
printf '%s|%s\\n' "\${DEEPSEEK_API_KEY:-}" "\${CLI_DISPATCH_RUN_KEY:-}" >> "${rec}/resume-env"
ps -o args= -p $$ >> "${rec}/resume-argv"
: > fixed.txt
`)
  chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1' }
  delete env.DEEPSEEK_API_KEY
  delete env.CLI_DISPATCH_RUN_KEY
  const read = (n) => (existsSync(path.join(rec, n)) ? readFileSync(path.join(rec, n), 'utf8') : '')
  return { dir, bin, repo, sessions, rec, env, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const verifyCmd = (h) => `sh -c 'printf "%s|%s\\n" "\${DEEPSEEK_API_KEY:-}" "\${CLI_DISPATCH_RUN_KEY:-}" >> ${h.rec}/verify-env'`
const run = (h, extra, env = {}) =>
  spawnSync('bash', [path.join(h.bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', h.repo, '--prompt', 'x', ...extra], { encoding: 'utf8', timeout: 120000, env: { ...h.env, ...env } })

function assertNoLeakInArgv(h) {
  for (const f of ['worker-argv', 'resume-argv']) assert.ok(!h.read(f).includes(SENTINEL), `${f} must not contain the key`)
}

test('foreground: the worker gets the key under the real name, verify gets nothing', () => {
  const h = harness()
  try {
    const r = run(h, ['--verify', verifyCmd(h)], { CLI_DISPATCH_RUN_KEY: SENTINEL })
    assert.equal(r.status, 0, r.stderr.slice(-400))
    assert.equal(h.read('worker-env').trim(), `${SENTINEL}|`)
    assert.equal(h.read('verify-env').trim(), '|')
    assert.ok(!r.stdout.includes(SENTINEL) && !r.stderr.includes(SENTINEL))
    assertNoLeakInArgv(h)
  } finally { h.cleanup() }
})

test('without the private variable the worker gets no key', () => {
  const h = harness()
  try {
    const r = run(h, ['--verify', verifyCmd(h)])
    assert.equal(r.status, 0, r.stderr.slice(-400))
    assert.equal(h.read('worker-env').trim(), '|')
  } finally { h.cleanup() }
})

test('--detach: the detached child passes the key to the worker only', () => {
  const h = harness()
  try {
    const r = run(h, ['--detach', '--verify', verifyCmd(h)], { CLI_DISPATCH_RUN_KEY: SENTINEL })
    assert.equal(r.status, 0, r.stderr)
    const runId = /^run: (\S+)/m.exec(r.stdout)?.[1]
    assert.ok(runId, r.stdout)
    const w = spawnSync('bash', [path.join(h.bin, 'cli-dispatch-wait'), '--run', runId, '--timeout', '100'], { encoding: 'utf8', timeout: 120000, env: h.env })
    assert.equal(w.status, 0, w.stdout + w.stderr)
    assert.equal(h.read('worker-env').trim(), `${SENTINEL}|`)
    assert.equal(h.read('verify-env').trim(), '|')
    assert.ok(!w.stdout.includes(SENTINEL))
    assertNoLeakInArgv(h)
  } finally { h.cleanup() }
})

test('--fix-attempts: the resume gets the key, both verify rounds get nothing', () => {
  const h = harness()
  try {
    const verify = `${verifyCmd(h)} && test -f fixed.txt`
    const r = run(h, ['--fix-attempts', '1', '--verify', verify], { CLI_DISPATCH_RUN_KEY: SENTINEL })
    assert.equal(r.status, 0, r.stderr.slice(-600))
    assert.equal(h.read('worker-env').trim(), `${SENTINEL}|`)
    assert.equal(h.read('resume-env').trim(), `${SENTINEL}|`)
    assert.deepEqual(h.read('verify-env').trim().split('\n'), ['|', '|'])
    assertNoLeakInArgv(h)
  } finally { h.cleanup() }
})

test('structure: the key is never added to WORKTREE_BASE_VARS (env(1) argv)', () => {
  const src = readFileSync(path.join(SCRIPTS, 'cli-dispatch-run'), 'utf8')
  assert.ok(!/WORKTREE_BASE_VARS\+=.*RUN_KEY/.test(src))
})

test('structure: the .ps1 twin captures and removes the private variable, never sets the key at script scope', () => {
  const src = readFileSync(path.join(SCRIPTS, 'cli-dispatch-run.ps1'), 'utf8')
  assert.ok(src.includes('Remove-Item Env:CLI_DISPATCH_RUN_KEY'))
  assert.ok(!/\$env:(DEEPSEEK|CODEX)_API_KEY *= *\$runKey/.test(src))
})

test('pwsh: the capture snippet of the .ps1 runner reads the key and removes the variable', { skip: !have('pwsh') }, () => {
  // A full .ps1 run needs cmd.exe for verify, so only the capture lines are executed here, taken
  // verbatim from the shipped script. Where the key then goes (baseVars, around the worker call
  // only) is pinned by the structural test above.
  const src = readFileSync(path.join(SCRIPTS, 'cli-dispatch-run.ps1'), 'utf8')
  const start = src.indexOf('$runKey = $env:CLI_DISPATCH_RUN_KEY')
  const endMarker = 'Remove-Item Env:CLI_DISPATCH_RUN_KEY -ErrorAction SilentlyContinue'
  const end = src.indexOf(endMarker)
  assert.ok(start !== -1 && end > start)
  const snippet = src.slice(start, end + endMarker.length)
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', `${snippet}; Write-Output "key=$runKey"; Write-Output "left=$env:CLI_DISPATCH_RUN_KEY"`], {
    encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_RUN_KEY: SENTINEL },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, new RegExp(`key=${SENTINEL}`))
  assert.match(r.stdout, /left=\s*$/m)
})
