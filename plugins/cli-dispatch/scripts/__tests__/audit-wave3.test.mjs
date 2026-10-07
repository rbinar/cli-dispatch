// audit-wave3.test.mjs — 6.1.2, the low-severity findings of the 2026-10-07 audit plus the two
// pieces 6.1.1 left open (signals during verify, the .ps1 session fallback). Each failed on 6.1.1.
import assert from 'node:assert/strict'
import { execSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(SCRIPTS, '..')
const WRITER = path.join(SCRIPTS, 'verdict-writer.mjs')
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' }
const TRASH = []
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); TRASH.push(d); return d }
const KILL = []
after(() => {
  for (const p of KILL) { try { process.kill(p, 'SIGKILL') } catch {} }
  for (const d of TRASH) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

const fence = (name) => { const m = /^```bash\n([\s\S]*?)^```/m.exec(fs.readFileSync(path.join(PLUGIN, 'commands', `${name}.md`), 'utf8')); return m[1] }
function runFence(name, args, { bin = '', env = {} } = {}) {
  const f = path.join(tmp('cd-w3-fence-'), 'b.sh')
  fs.writeFileSync(f, fence(name).split('$ARGUMENTS').join(args).split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN))
  return spawnSync('bash', [f], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: `${bin ? bin + ':' : ''}${process.env.PATH}`, ...env } })
}
function repo() {
  const r = path.join(tmp('cd-w3-repo-'), 'repo'); fs.mkdirSync(r)
  fs.writeFileSync(path.join(r, 'a'), 'a\n')
  execSync('git init -q && git add -A && git commit -qm s', { cwd: r, env: { ...process.env, ...GIT_ENV } })
  return r
}

// ---- kill only kills a cli-dispatch worker -------------------------------------------------------

test('kill: a worker.pid that now belongs to an unrelated process is not killed', async () => {
  const sessions = tmp('cd-w3-sess-')
  const d = path.join(sessions, 'reused'); fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ state: 'running', sessionId: 'reused' }))
  const victim = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' }); KILL.push(victim.pid)
  fs.writeFileSync(path.join(d, 'worker.pid'), String(victim.pid))
  runFence('kill', 'reused', { env: { CLI_DISPATCH_SESSIONS_DIR: sessions } })
  await sleep(500)
  assert.equal(alive(victim.pid), true, 'a recycled pid must not be killed')
})

// ---- API keys never appear in a process's argv ---------------------------------------------------

test('balance: keys travel in a header file or stdin, never in curl\'s argv', () => {
  const bin = tmp('cd-w3-curl-'); const rec = path.join(bin, 'argv.txt')
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${rec}"\ncat >/dev/null 2>&1 || true\necho '{}'\n`)
  fs.chmodSync(path.join(bin, 'curl'), 0o755)
  const cfg = path.join(bin, 'config')
  fs.writeFileSync(cfg, 'DEEPSEEK_API_KEY="sk-ds-SECRET-111"\nOPENROUTER_API_KEY="sk-or-SECRET-222"\n')
  spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-balance.sh')], {
    encoding: 'utf8', timeout: 60000, input: '',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: tmp('cd-w3-home-'), CLI_DISPATCH_CONFIG: cfg },
  })
  const argv = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : ''
  assert.ok(argv.length > 0, 'curl was never called')
  assert.doesNotMatch(argv, /SECRET-111|SECRET-222/, argv)
})

// ---- the leak patch is private and unpredictable -------------------------------------------------

test('leak patch: random name, mode 600', () => {
  const r = repo()
  const bin = tmp('cd-w3-leakbin-')
  fs.writeFileSync(path.join(bin, 'cx-stream'), `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do [ "$1" = --cwd ] && { cd "$2" || exit 9; }; shift; done
MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
echo x >> "$MAIN/a"
exit 0
`)
  fs.chmodSync(path.join(bin, 'cx-stream'), 0o755)
  const brief = path.join(tmp('cd-w3-brief-'), 'b'); fs.writeFileSync(brief, 'x')
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cx-worktree-run.sh'), r, 'leak3', brief], {
    cwd: tmp('cd-w3-cwd-'), encoding: 'utf8', env: { ...process.env, ...GIT_ENV, CLI_DISPATCH_NO_IN_PLACE: '1', PATH: `${bin}:${process.env.PATH}` },
  })
  const m = /patch saved: (\S+)/.exec(res.stdout + res.stderr)
  assert.ok(m, res.stdout + res.stderr)
  TRASH.push(m[1])
  assert.doesNotMatch(path.basename(m[1]), /^cli-dispatch-leaked-changes-\d+\.patch$/, 'name must not be guessable')
  assert.equal(fs.statSync(m[1]).mode & 0o777, 0o600)
})

// ---- ids never escape the sessions root ----------------------------------------------------------

test('ids: ../ is rejected by wait, wait --run, claude-ds-stream --resume and the commands', () => {
  const sessions = tmp('cd-w3-sess-')
  const env = { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions }
  for (const args of [['--run', '../x'], ['../x']]) {
    const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-wait'), ...args, '--timeout', '1'], { encoding: 'utf8', env, timeout: 20000 })
    assert.notEqual(r.status, 0, args.join(' '))
    assert.match(r.stdout + r.stderr, /invalid/i, args.join(' '))
  }
  const bin = tmp('cd-w3-claude-'); const called = path.join(bin, 'called')
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\ntouch "${called}"\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755)
  const s = spawnSync('bash', [path.join(SCRIPTS, 'claude-ds-stream'), '--resume', '../x', '-p', 'hi'], {
    encoding: 'utf8', timeout: 30000, env: { ...env, PATH: `${bin}:${process.env.PATH}`, CLI_DISPATCH_CONFIG: '/dev/null', DEEPSEEK_API_KEY: 'k' },
  })
  assert.notEqual(s.status, 0); assert.equal(fs.existsSync(called), false, 'claude must not start')
  for (const [name, args] of [['watch', '../x'], ['kill', '../x'], ['resume', '../x follow up']]) {
    const r = runFence(name, args, { env: { CLI_DISPATCH_SESSIONS_DIR: sessions } })
    assert.notEqual(r.status, 0, name)
    assert.match(r.stdout + r.stderr, /invalid/i, name)
  }
})

// ---- the fix attempt finds the worker even when ~/.local/bin is not on PATH ----------------------

test('fix attempt: resumes the worker from the runner\'s own directory when it is not on PATH', () => {
  const r = repo()
  const sessions = tmp('cd-w3-sess-'); const sid = 'fx'; const s = path.join(sessions, sid); fs.mkdirSync(s)
  fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: sid }))
  fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: r }))
  fs.writeFileSync(path.join(s, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
  const bin = tmp('cd-w3-runbin-')
  for (const f of ['cli-dispatch-run', 'cli-dispatch-run-summary.sh', 'ds-worktree-run.sh', 'stream-utils.sh']) { fs.copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); fs.chmodSync(path.join(bin, f), 0o755) }
  fs.writeFileSync(path.join(bin, 'claude-ds-stream'), '#!/usr/bin/env bash\n: > fixed.txt\nexit 0\n'); fs.chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
  const res = spawnSync('bash', [path.join(bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', r, '--resume', sid, '--verify', 'test -f fixed.txt', '--fix-attempts', '1'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER },
  })
  assert.equal(res.status, 0, res.stderr.slice(-400))
})

// ---- /run never shows another run's verdict --------------------------------------------------------

test('run: when this run wrote no verdict, an older run\'s verdict is not shown', () => {
  const sessions = tmp('cd-w3-sess-')
  const old = path.join(sessions, 'older-run-session'); fs.mkdirSync(old)
  fs.writeFileSync(path.join(old, 'verdict.json'), JSON.stringify({ sessionId: 'older-run-session', state: 'done', verify: { exitCode: 0 } }))
  const bin = tmp('cd-w3-runstub-')
  fs.writeFileSync(path.join(bin, 'cli-dispatch-run'), '#!/usr/bin/env bash\necho "setup failed" >&2\nexit 5\n'); fs.chmodSync(path.join(bin, 'cli-dispatch-run'), 0o755)
  const r = runFence('run', 'ds "x"', { bin, env: { CLI_DISPATCH_SESSIONS_DIR: sessions } })
  assert.equal(r.status, 5)
  assert.doesNotMatch(r.stdout, /older-run-session/, r.stdout)
})

// ---- --resume re-attach to a session whose cwd is not a repo ------------------------------------------

test('resume re-attach: a session cwd that is not a git work tree still gets a verdict', () => {
  const notGit = tmp('cd-w3-notgit-')
  const sessions = tmp('cd-w3-sess-'); const s = path.join(sessions, 'ng'); fs.mkdirSync(s)
  fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: 'ng' }))
  fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: notGit }))
  const res = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', notGit, '--resume', 'ng'], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER },
  })
  assert.ok(fs.existsSync(path.join(s, 'verdict.json')), `exit ${res.status}: ${res.stderr.slice(-300)}`)
})

// ---- ag transcript parser -----------------------------------------------------------------------

function agParser(env) {
  const dir = tmp('cd-w3-ag-'); const tr = path.join(dir, 'transcript_full.jsonl'); const done = path.join(dir, 'done')
  const sess = path.join(dir, 'session')
  const p = spawn(process.execPath, [path.join(SCRIPTS, 'ag-transcript-parse.mjs')], { env: { ...process.env, AG_SESSION_DIR: sess, AG_TRANSCRIPT: tr, AG_DONEFILE: done, AG_CONV_ID: 'c', ...env } })
  let out = ''; p.stdout.on('data', (d) => { out += d })
  const closed = new Promise((r) => p.on('close', r))
  return { tr, done, sess, closed, out: () => out }
}

test('ag parser: a multibyte character split across two polls is decoded intact', async () => {
  const a = agParser({})
  const line = Buffer.from(JSON.stringify({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Çalışma şekli güncellendi', tool_calls: [] }) + '\n')
  const cut = line.indexOf(Buffer.from('ş')) + 1 // inside the 2-byte ş
  fs.writeFileSync(a.tr, line.subarray(0, cut))
  await sleep(1200)
  fs.appendFileSync(a.tr, line.subarray(cut))
  await sleep(1200)
  fs.writeFileSync(a.done, '0')
  await a.closed
  assert.equal(a.out().trim(), 'Çalışma şekli güncellendi')
})

test('ag parser: a resumed turn that produced no answer is not "done" with the old one', async () => {
  const a = agParser({ AG_RESUME: '1' })
  fs.writeFileSync(a.tr, JSON.stringify({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'OLD ANSWER', tool_calls: [] }) + '\n')
  await sleep(1200)
  fs.writeFileSync(a.done, '0')
  await a.closed
  assert.doesNotMatch(a.out(), /OLD ANSWER/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.sess, 'status.json'), 'utf8')).state, 'error')
})

// ---- signals during verify -----------------------------------------------------------------------

test('SIGTERM during verify ends the run promptly with 143', async () => {
  const r = repo()
  const sessions = tmp('cd-w3-sess-'); const s = path.join(sessions, 'vt'); fs.mkdirSync(s)
  fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: 'vt' }))
  fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: r }))
  const p = spawn('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', r, '--resume', 'vt', '--verify', 'sleep 30'], {
    env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: WRITER },
  })
  await sleep(3000)
  const t0 = Date.now(); p.kill('SIGTERM')
  const code = await new Promise((res) => p.on('close', (c, sig) => res(c ?? sig)))
  assert.ok(Date.now() - t0 < 8000, 'must not wait for verify to finish')
  assert.equal(code, 143)
})

// ---- .ps1 session fallback skips dot dirs and the archive ----------------------------------------

test('ps1: the newest-session fallback ignores .runs, dot dirs and verdict-archive', () => {
  const src = fs.readFileSync(path.join(SCRIPTS, 'cli-dispatch-run.ps1'), 'utf8')
  const i = src.indexOf('$launchTime = (Get-Item -Path $launchMarker)')
  assert.ok(i > 0)
  const block = src.slice(i, i + 600)
  assert.match(block, /verdict-archive/)
  assert.match(block, /StartsWith\('\.'\)|-notlike '\.\*'|-notmatch '\^\\\.'/)
})

// ---- docs and dead code ------------------------------------------------------------------------

const REPO = path.join(PLUGIN, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

test('docs: no page still names the per-backend *-balance commands removed in 6.0.0', () => {
  const pages = ['README.md', 'README.tr.md', 'TERMINAL.md', 'CLAUDE.md']
  for (const d of ['docs', 'docs/tr']) for (const f of fs.readdirSync(path.join(REPO, d)).filter((x) => x.endsWith('.md'))) pages.push(`${d}/${f}`)
  const hits = []
  for (const p of pages) read(p).split('\n').forEach((l, i) => { if (/`\*-balance`|\b(ds|ag|cx|oc|cp)-balance\b/.test(l)) hits.push(`${p}:${i + 1}`) })
  assert.deepEqual(hits, [])
})

test('docs: CHANGELOG.tr.md carries every version CHANGELOG.md does', () => {
  const versions = (f) => [...read(f).matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1])
  const en = versions('CHANGELOG.md'), tr = versions('CHANGELOG.tr.md')
  assert.deepEqual(en.filter((v) => !tr.includes(v)), [], 'missing from the Turkish changelog')
  assert.deepEqual(tr, en, 'same versions in the same order')
})

test('docs: CLAUDE.md describes the runner agent re-calling wait on 124, not 2', () => {
  assert.doesNotMatch(read('CLAUDE.md'), /re-calling on exit 2/)
})

test('dead code: the never-installed node path, the uncalled --policy-injection flag and the unused re-export are gone', () => {
  for (const f of ['cli-dispatch-run', 'cli-dispatch-run.ps1']) assert.doesNotMatch(fs.readFileSync(path.join(SCRIPTS, f), 'utf8'), /\.local[/\\]share[/\\]cli-dispatch[/\\]node\b/, f)
  assert.doesNotMatch(fs.readFileSync(path.join(SCRIPTS, 'install.sh'), 'utf8'), /--policy-injection/)
  assert.doesNotMatch(fs.readFileSync(path.join(SCRIPTS, 'install.ps1'), 'utf8'), /PolicyInjection/)
  assert.doesNotMatch(fs.readFileSync(path.join(SCRIPTS, 'verdict-writer.mjs'), 'utf8'), /export \{ normalizeBackend \}/)
})

// Found live in the sandbox (6.1.2): /cli-dispatch:sessions listed the detached-run dir `.runs`
// (and would list verdict-archive) as sessions with status "?".
test('sessions: .runs, other dot dirs and verdict-archive are not listed as sessions', () => {
  const sessions = tmp('cd-w3-sess-')
  for (const d of ['.runs', '.tmp', 'verdict-archive', 'real-session']) fs.mkdirSync(path.join(sessions, d))
  fs.writeFileSync(path.join(sessions, 'real-session', 'status.json'), JSON.stringify({ state: 'done', backend: 'deepseek' }))
  const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-sessions.sh')], { encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions } })
  assert.match(r.stdout, /real-session/)
  assert.doesNotMatch(r.stdout, /\.runs|\.tmp|verdict-archive/, r.stdout)
})
