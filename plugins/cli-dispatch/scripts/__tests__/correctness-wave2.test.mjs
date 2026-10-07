// correctness-wave2.test.mjs — 6.1.1, the correctness findings of the 2026-10-07 audit. Each test
// failed against 6.1.0. Workers are stubs on PATH; nothing here needs a real CLI or network.
import assert from 'node:assert/strict'
import { execSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WRITER = path.join(SCRIPTS, 'verdict-writer.mjs')
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' }
const TRASH = []
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); TRASH.push(d); return d }
after(() => { for (const d of TRASH) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } })
const sh = (cmd, cwd) => execSync(cmd, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' })

function repo(files = { 'note.txt': 'seed\n' }) {
  const r = path.join(tmp('cd-w2-repo-'), 'repo')
  fs.mkdirSync(r)
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), c) }
  sh('git init -q && git add -A && git commit -qm seed', r)
  return r
}

// A copy of the runner next to a stub per-backend worktree runner (same seam as
// worker-death-verdict.test.mjs).
function runnerWithStub(stubBody, backend = 'ds') {
  const dir = tmp('cd-w2-run-')
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
    fs.copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); fs.chmodSync(path.join(bin, f), 0o755)
  }
  const sessions = path.join(dir, 'sessions'); fs.mkdirSync(sessions)
  fs.writeFileSync(path.join(bin, `${backend}-worktree-run.sh`), `#!/usr/bin/env bash\nSESSIONS="${sessions}"\n${stubBody}\n`)
  fs.chmodSync(path.join(bin, `${backend}-worktree-run.sh`), 0o755)
  const env = { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER, CLI_DISPATCH_NO_IN_PLACE: '1' }
  return { bin, sessions, env, run: (args, opts = {}) => spawnSync('bash', [path.join(bin, 'cli-dispatch-run'), ...args], { encoding: 'utf8', timeout: 60000, env, ...opts }) }
}
const SESSION = (state, sid = 's1') => `S="$SESSIONS/${sid}"; mkdir -p "$S"
printf '{"state":"${state}","sessionId":"${sid}","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s","model":"m"}' "$1" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "claude-ds session: ${sid}" >&2`

// ---- 8. --effort reaches the DeepSeek worker; OpenCode rejects it up front ------------------

test('8: --backend ds --effort high reaches claude-ds-stream', () => {
  const r = repo()
  const sessions = tmp('cd-w2-sess-')
  const bin = tmp('cd-w2-bin-'); const rec = path.join(bin, 'rec.txt')
  fs.writeFileSync(path.join(bin, 'claude-ds-stream'), `#!/usr/bin/env bash
{ echo "ENV=\${CLAUDE_DS_EFFORT:-}"; for a in "$@"; do echo "ARG=$a"; done; } > "${rec}"
S="${sessions}/eff"; mkdir -p "$S"
printf '{"state":"done","sessionId":"eff","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s"}' "$PWD" > "$S/meta.json"
echo "claude-ds session: eff" >&2
`)
  fs.chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', r, '--prompt', 'x', '--effort', 'high'], {
    cwd: tmp('cd-w2-cwd-'), encoding: 'utf8', timeout: 60000,
    env: { ...process.env, ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER, CLI_DISPATCH_NO_IN_PLACE: '1' },
  })
  const got = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : ''
  assert.ok(/^ENV=high$/m.test(got) || /^ARG=--effort\nARG=high$/m.test(got), `effort lost; recorded:\n${got}\n${res.stderr.slice(-300)}`)
})

test('8: --backend oc --effort is rejected as a usage error (OpenCode has no effort flag)', () => {
  const r = repo()
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'oc', '--cwd', r, '--prompt', 'x', '--effort', 'high'], { encoding: 'utf8', timeout: 30000 })
  assert.equal(res.status, 5, res.stdout + res.stderr)
})

// ---- 9. a failing worker keeps its node_modules link for verify --------------------------------

test('9: a worker that exits non-zero leaves the node_modules link in its worktree', () => {
  const r = repo({ '.gitignore': 'node_modules/\n', 'package.json': '{}\n' })
  fs.mkdirSync(path.join(r, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(r, 'node_modules', 'x', 'a'), '')
  const bin = tmp('cd-w2-nmbin-'); const rec = path.join(bin, 'cwd.txt')
  fs.writeFileSync(path.join(bin, 'cx-stream'), `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do [ "$1" = --cwd ] && { cd "$2" || exit 9; }; shift; done
pwd > "${rec}"; echo "cx session: s" >&2; exit 1
`)
  fs.chmodSync(path.join(bin, 'cx-stream'), 0o755)
  const brief = path.join(tmp('cd-w2-brief-'), 'b'); fs.writeFileSync(brief, 'x')
  spawnSync('bash', [path.join(SCRIPTS, 'cx-worktree-run.sh'), r, 'nm-branch', brief], {
    cwd: tmp('cd-w2-cwd-'), encoding: 'utf8', env: { ...process.env, ...GIT_ENV, CLI_DISPATCH_NO_IN_PLACE: '1', PATH: `${bin}:${process.env.PATH}` },
  })
  const wt = fs.readFileSync(rec, 'utf8').trim(); TRASH.push(wt)
  assert.ok(fs.existsSync(path.join(wt, 'node_modules', 'x', 'a')), 'verify (#167) runs in this worktree after a failed turn')
})

// ---- 10. runner artifacts do not make a worktree dirty ------------------------------------------

function linkedWorktree() {
  const r = repo({ '.gitignore': 'node_modules/\n', 'a.txt': 'a\n' })
  const wt = path.join(tmp('cd-w2-wt-'), 'cx-wt-x')
  sh(`git worktree add -q -b w2-${Date.now()} "${wt}"`, r)
  fs.symlinkSync(os.tmpdir(), path.join(wt, 'node_modules'))
  fs.writeFileSync(path.join(wt, 'worker-report.json'), '{"claims":[]}\n')
  return { r, wt }
}

test('10: --cleanup-if-clean removes a worktree whose only entries are the runner\'s own', () => {
  const { wt } = linkedWorktree()
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--_test-cleanup', wt, '0', '--cleanup-if-clean'], { encoding: 'utf8' })
  assert.equal(fs.existsSync(wt), false, res.stdout + res.stderr)
})

test('10: such a worktree is not reported as stranded', () => {
  const { wt } = linkedWorktree()
  const sessions = tmp('cd-w2-sess-'); const s = path.join(sessions, 'st')
  fs.mkdirSync(s)
  fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: 'st' }))
  fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: wt }))
  fs.writeFileSync(path.join(s, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', wt, '--resume', 'st'], {
    encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER },
  })
  const v = JSON.parse(fs.readFileSync(path.join(s, 'verdict.json'), 'utf8'))
  assert.equal(v.stranded, false, res.stderr.slice(-300))
})

// ---- 11. a resumed turn keeps the files the first turn changed ---------------------------------

test('11: cx-stream --resume does not count the session\'s own earlier changes as pre-existing', () => {
  const r = repo({ 'a.js': '1\n' })
  fs.writeFileSync(path.join(r, 'a.js'), '2\n') // round 1 left this
  fs.writeFileSync(path.join(r, 'b.js'), 'new\n')
  const sessions = tmp('cd-w2-sess-'); const sid = 'thr-resume-1'; const s = path.join(sessions, sid)
  fs.mkdirSync(s)
  fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: sid, backend: 'codex' }))
  fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'codex', cwd: r }))
  fs.writeFileSync(path.join(s, 'changed-files.json'), JSON.stringify({ files: [{ path: 'a.js', status: 'M' }, { path: 'b.js', status: '??' }], diffstat: '', preexistingDirty: [] }))
  const bin = tmp('cd-w2-codex-'); const home = tmp('cd-w2-home-'); fs.mkdirSync(path.join(home, '.codex'))
  const lines = [
    { type: 'thread.started', thread_id: sid },
    { type: 'item.completed', item: { id: '1', type: 'agent_message', text: 'ok' } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
  ].map((e) => JSON.stringify(e)).join('\n')
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/bash\ncat <<'EOF_JSONL'\n${lines}\nEOF_JSONL\nexit 0\n`)
  fs.chmodSync(path.join(bin, 'codex'), 0o755)
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cx-stream'), '--resume', sid, '-p', 'again', '--cwd', r], {
    encoding: 'utf8', timeout: 90000,
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: sessions, CODEX_HOME: path.join(home, '.codex') },
  })
  const cf = JSON.parse(fs.readFileSync(path.join(s, 'changed-files.json'), 'utf8'))
  assert.deepEqual(cf.files.map((f) => f.path).sort(), ['a.js', 'b.js'], `${JSON.stringify(cf)}\n${res.stderr.slice(-300)}`)
})

// ---- 12. timeouts are validated --------------------------------------------------------------

for (const flag of ['--timeout', '--verify-timeout']) {
  test(`12: ${flag} 5m is a usage error (exit 5) before any worker starts`, () => {
    const h = runnerWithStub(`touch "$SESSIONS/STARTED"; ${SESSION('done')}`)
    const res = h.run(['--backend', 'ds', '--cwd', repo(), '--prompt', 'x', '--verify', 'true', flag, '5m'])
    assert.equal(res.status, 5, res.stdout + res.stderr)
    assert.equal(fs.existsSync(path.join(h.sessions, 'STARTED')), false, 'the worker must not have run')
  })
}

// ---- 13. SIGTERM stops the runner -------------------------------------------------------------

test('13: SIGTERM ends cli-dispatch-run promptly with 143', async () => {
  const h = runnerWithStub(`${SESSION('running')}\nsleep 30`)
  const p = spawn('bash', [path.join(h.bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', repo(), '--prompt', 'x'], { env: h.env })
  await new Promise((r) => setTimeout(r, 2500))
  const t0 = Date.now()
  p.kill('SIGTERM')
  const code = await new Promise((r) => p.on('close', (c, sig) => r(c ?? sig)))
  assert.ok(Date.now() - t0 < 8000, 'must stop, not run on')
  assert.equal(code, 143)
})

// ---- 14. wait --run notices a dead detached runner --------------------------------------------

test('14: cli-dispatch-wait --run exits 5 when the detached runner died without an exit file', () => {
  const sessions = tmp('cd-w2-sess-')
  const run = path.join(sessions, '.runs', 'run-dead'); fs.mkdirSync(run, { recursive: true })
  const dead = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim()
  fs.writeFileSync(path.join(run, 'pid'), dead + '\n')
  const t0 = Date.now()
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-wait'), '--run', 'run-dead', '--timeout', '60'], {
    encoding: 'utf8', timeout: 70000, env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions },
  })
  assert.equal(res.status, 5, res.stdout + res.stderr)
  assert.ok(Date.now() - t0 < 20000, 'must not wait out the timeout')
})

// ---- 15. no session found never resolves to "." -------------------------------------------------

test('15: a worker that never created a session writes no verdict into the sessions root', () => {
  // GNU xargs runs its command even on empty input; emulate that.
  const shim = tmp('cd-w2-xargs-')
  fs.writeFileSync(path.join(shim, 'xargs'), `#!/usr/bin/env bash\nin="$(cat)"\nif [ -z "$in" ]; then [ "$1" = -0 ] && shift; exec "$@"; fi\nprintf '%s' "$in" | /usr/bin/xargs "$@"\n`)
  fs.chmodSync(path.join(shim, 'xargs'), 0o755)
  const h = runnerWithStub('echo "worker failed before starting" >&2; exit 1')
  const res = h.run(['--backend', 'ds', '--cwd', repo(), '--prompt', 'x', '--verify', 'true'], { env: { ...h.env, PATH: `${shim}:${process.env.PATH}` } })
  assert.notEqual(res.status, 0)
  assert.equal(fs.existsSync(path.join(h.sessions, 'verdict.json')), false, 'verdict written into the sessions root')
})

// ---- 16. setup errors are exit 5 -----------------------------------------------------------------

test('16: setup errors exit 5, not 1 (1 means "verify failed")', () => {
  const r = repo()
  const notGit = tmp('cd-w2-notgit-')
  const base = ['--backend', 'ds', '--prompt', 'x']
  const cases = [
    [[...base, '--cwd', notGit], {}],
    [['--backend', 'ds', '--cwd', r, '--prompt-file', path.join(notGit, 'missing.txt')], {}],
    [[...base, '--cwd', r], { CLI_DISPATCH_NODE: '/nonexistent/node' }],
    [[...base, '--cwd', r], { CLI_DISPATCH_VERDICT_WRITER: '/nonexistent/verdict-writer.mjs' }],
  ]
  for (const [args, env] of cases) {
    const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: tmp('cd-w2-sess-'), ...env } })
    assert.equal(res.status, 5, `${JSON.stringify(args)} ${JSON.stringify(env)}: ${res.stderr.slice(-200)}`)
  }
})

// ---- 17. a subdirectory --cwd still ships the whole change --------------------------------------

test('17: the patch carries changes outside the --cwd subdirectory', () => {
  const r = repo({ 'README': 'r\n', 'pkg/p.txt': 'p\n' })
  fs.writeFileSync(path.join(r, 'README'), 'r2\n')
  fs.writeFileSync(path.join(r, 'pkg', 'p.txt'), 'p2\n')
  const sessions = tmp('cd-w2-sess-'); const s = path.join(sessions, 'sub')
  fs.mkdirSync(s)
  fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: 'sub' }))
  fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: path.join(r, 'pkg') }))
  fs.writeFileSync(path.join(s, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
  spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', path.join(r, 'pkg'), '--resume', 'sub'], {
    encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER },
  })
  const patch = fs.readFileSync(path.join(s, 'verdict-diff.patch'), 'utf8')
  assert.match(patch, /^diff --git a\/README b\/README$/m, patch)
  assert.match(patch, /^diff --git a\/pkg\/p\.txt b\/pkg\/p\.txt$/m, patch)
})

// ---- 18. a finished runner never leaves the run waiting on "running" ----------------------------

test('18: exit 0 with status still "running" settles the session instead of hanging', () => {
  const h = runnerWithStub(`${SESSION('running', 'hang')}\nexit 0`)
  const t0 = Date.now()
  const res = h.run(['--backend', 'ds', '--cwd', repo(), '--prompt', 'x'], { timeout: 40000 })
  assert.ok(Date.now() - t0 < 35000 && res.signal === null, 'runner hung on a session nobody will finish')
  const v = JSON.parse(fs.readFileSync(path.join(h.sessions, 'hang', 'verdict.json'), 'utf8'))
  assert.equal(v.state, 'error')
})

// ---- 19. clean never removes a session whose worker is alive -------------------------------------

test('19: clean --remove keeps a quiet "running" session whose worker.pid is alive', () => {
  const sessions = tmp('cd-w2-sess-')
  const mk = (id, pid) => {
    const d = path.join(sessions, id); fs.mkdirSync(d)
    fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ state: 'running', sessionId: id }))
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ backend: 'deepseek', startedAt: new Date().toISOString() }))
    fs.writeFileSync(path.join(d, 'worker.pid'), String(pid))
    const old = new Date(Date.now() - 30 * 60 * 1000)
    fs.utimesSync(path.join(d, 'status.json'), old, old); fs.utimesSync(d, old, old)
    return d
  }
  const alive = mk('alive', process.pid)
  const dead = mk('dead', spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim())
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, 'cli-dispatch-clean.mjs'), '--remove'], { encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions } })
  assert.equal(fs.existsSync(alive), true, `a live worker's session was deleted\n${res.stdout}`)
  assert.equal(fs.existsSync(dead), false, `a dead worker's stale session should still go\n${res.stdout}`)
})

// ---- PS1 verify reads its pipes before waiting --------------------------------------------------

test('ps1: verify starts reading stdout/stderr before WaitForExit (no 4 KB pipe deadlock)', () => {
  const src = fs.readFileSync(path.join(SCRIPTS, 'cli-dispatch-run.ps1'), 'utf8')
  const wait = src.indexOf('WaitForExit(')
  assert.ok(wait > 0)
  const asyncRead = src.search(/ReadToEndAsync\(\)/)
  assert.ok(asyncRead > 0 && asyncRead < wait, 'ReadToEndAsync must be started before WaitForExit')
})
