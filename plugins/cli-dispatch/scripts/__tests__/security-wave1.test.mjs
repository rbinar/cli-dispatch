// security-wave1.test.mjs — 6.1.0, from the 2026-10-07 audit. Each block pins one confirmed
// finding; all of them were reproduced against 6.0.5 before the fix.
//
//   A. Claude Code pastes $ARGUMENTS into a command's bash fence TEXTUALLY, so backticks and
//      $( ) in a prompt ran as shell (a brief quoting `git reset --hard` would execute it).
//   B. `!` pre-execution lines that carried $ARGUMENTS ran before the model saw anything:
//      `/cli-dispatch:sessions ds; touch x` created x in the sandbox container.
//   C. clean --schedule wrote --older-than / --time unchecked into a crontab line → daily RCE.
//   D. The worktree sweep ran `git status` in ANY *-wt-* dir under /tmp, so a planted repo with
//      core.fsmonitor ran its command outside a worker sandbox; real clones named *-wt-* could
//      be rm -rf'd.
//   E. is_worktree_clean treated a failing `git status` as clean, then fell back to rm -rf.
//   F. Since #167 a leak-guard failure (worker wrote OUTSIDE its worktree) was just another
//      worker exit: the run verified and reported exit 0 / verify pass.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(SCRIPTS, '..')
const COMMANDS = path.join(PLUGIN, 'commands')
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' }

const TRASH = []
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); TRASH.push(d); return d }
after(() => { for (const d of TRASH) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } })

const md = (n) => fs.readFileSync(path.join(COMMANDS, `${n}.md`), 'utf8')
const fence = (n) => { const m = /^```bash\n([\s\S]*?)^```/m.exec(md(n)); assert.ok(m, `${n}.md bash fence`); return m[1] }

function stubs(names) {
  const bin = tmp('cd-sec-bin-')
  for (const s of names) {
    fs.writeFileSync(path.join(bin, s), `#!/usr/bin/env bash\necho "STUB ${s}"\nfor a in "$@"; do printf 'ARG[%s]\\n' "$a"; done\n`)
    fs.chmodSync(path.join(bin, s), 0o755)
  }
  return bin
}

function runFence(name, args, { bin = '', pluginRoot = PLUGIN, env = {} } = {}) {
  const dir = tmp('cd-sec-fence-')
  const file = path.join(dir, 'block.sh')
  // Exactly what Claude Code does: textual substitution, then bash.
  fs.writeFileSync(file, fence(name).split('$ARGUMENTS').join(args).split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot))
  return spawnSync('bash', [file], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { PATH: `${bin ? bin + ':' : ''}${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: tmp('cd-sec-home-'), ...env },
  })
}

// ---- A. textual $ARGUMENTS never executes ---------------------------------------------------

function payload() {
  const p = tmp('cd-sec-pwn-')
  return { p, bt: `\`touch ${p}/bt\``, ds: `$(touch ${p}/ds)`, hit: () => fs.readdirSync(p) }
}

test('A: /run passes backticks and $( ) through as text, never runs them', () => {
  const x = payload()
  const r = runFence('run', `ds "fix ${x.bt} and ${x.ds}" --verify 'true'`, { bin: stubs(['cli-dispatch-run']) })
  assert.deepEqual(x.hit(), [], `executed! ${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /^STUB cli-dispatch-run$/m, r.stderr)
  assert.ok(r.stdout.includes(`fix ${x.bt} and ${x.ds}`), `prompt must arrive verbatim:\n${r.stdout}`)
})

test('A: /ask passes backticks and $( ) through as text', () => {
  const x = payload()
  const r = runFence('ask', `ds "explain ${x.bt} ${x.ds}"`, { bin: stubs(['ds-agent']) })
  assert.deepEqual(x.hit(), [], `executed! ${r.stdout}${r.stderr}`)
  assert.ok(r.stdout.includes(`ARG[explain ${x.bt} ${x.ds}]`), r.stdout + r.stderr)
})

test('A: /resume keeps the follow-up verbatim and runs nothing in it', () => {
  const x = payload()
  const root = tmp('cd-sec-sess-')
  fs.mkdirSync(path.join(root, 'sid1'))
  fs.writeFileSync(path.join(root, 'sid1', 'meta.json'), JSON.stringify({ backend: 'codex' }))
  const prompt = `fix ${x.bt} and ${x.ds} "two words" don't`
  const r = runFence('resume', `sid1 ${prompt}`, { bin: stubs(['cx-agent']), env: { CLI_DISPATCH_SESSIONS_DIR: root } })
  assert.deepEqual(x.hit(), [], `executed! ${r.stdout}${r.stderr}`)
  assert.ok(r.stdout.includes(`ARG[${prompt}]`), `prompt must arrive verbatim as one argument:\n${r.stdout}${r.stderr}`)
})

for (const [name, args, bins] of [
  ['kill', (x) => `abc${x.bt}${x.ds}`, []],
  ['watch', (x) => `abc${x.ds} --wait`, ['cli-dispatch-wait']],
  ['gain', (x) => `--days 1 ${x.bt} ${x.ds}`, ['cli-dispatch-gain']],
  ['clean', (x) => `--older-than 7 ${x.bt} ${x.ds}`, ['cli-dispatch-clean']],
]) {
  test(`A: /${name} runs nothing from its arguments`, () => {
    const x = payload()
    const r = runFence(name, args(x), { bin: stubs(bins), env: { CLI_DISPATCH_SESSIONS_DIR: tmp('cd-sec-sess-') } })
    assert.deepEqual(x.hit(), [], `executed! ${r.stdout}${r.stderr}`)
  })
}

test('A: /clean --schedule runs nothing from its arguments', () => {
  const x = payload()
  const root = tmp('cd-sec-plugin-')
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, 'scripts', 'cli-dispatch-clean-schedule.sh'), '#!/usr/bin/env bash\necho SCHED "$@"\n')
  fs.copyFileSync(path.join(SCRIPTS, 'cli-dispatch-args.mjs'), path.join(root, 'scripts', 'cli-dispatch-args.mjs'))
  const r = runFence('clean', `--schedule status ${x.bt} ${x.ds}`, { pluginRoot: root })
  assert.deepEqual(x.hit(), [], `executed! ${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /^SCHED status/m)
})

// ---- B. no $ARGUMENTS in pre-executed lines --------------------------------------------------

for (const name of fs.readdirSync(COMMANDS).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))) {
  test(`B: ${name}.md has no $ARGUMENTS in a \`!\` pre-execution line`, () => {
    for (const line of md(name).split('\n').filter((l) => l.startsWith('!`'))) {
      assert.doesNotMatch(line, /\$ARGUMENTS/, `${name}.md: ${line}`)
    }
  })
}

// ---- C. schedule arguments are validated before anything is written --------------------------

function schedule(args, uname = 'Linux') {
  const home = tmp('cd-sec-sched-home-')
  const bin = tmp('cd-sec-sched-bin-')
  const cap = path.join(home, 'crontab.in')
  fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\necho ${uname}\n`)
  fs.writeFileSync(path.join(bin, 'crontab'), `#!/bin/sh\nif [ "$1" = "-" ]; then cat > "${cap}"; fi\nexit 0\n`)
  fs.writeFileSync(path.join(bin, 'launchctl'), '#!/bin/sh\nexit 0\n')
  for (const f of ['uname', 'crontab', 'launchctl']) fs.chmodSync(path.join(bin, f), 0o755)
  const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-clean-schedule.sh'), ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  })
  const plists = fs.existsSync(path.join(home, 'Library', 'LaunchAgents')) ? fs.readdirSync(path.join(home, 'Library', 'LaunchAgents')) : []
  return { r, cron: fs.existsSync(cap) ? fs.readFileSync(cap, 'utf8') : null, plists }
}

for (const [label, args] of [
  ['--older-than with a shell payload', ['install', '--older-than', '7;touch${IFS}/tmp/x']],
  ['--older-than that is not a number', ['install', '--older-than', 'seven']],
  ['--time out of range', ['install', '--time', '25:00']],
  ['--time with a payload', ['install', '--time', '03:00;id']],
]) {
  test(`C: schedule refuses ${label} and writes nothing`, () => {
    for (const os_ of ['Linux', 'Darwin']) {
      const s = schedule(args, os_)
      assert.notEqual(s.r.status, 0, `${os_}: must fail; stdout: ${s.r.stdout}`)
      assert.equal(s.cron, null, `${os_}: crontab must not be written`)
      assert.deepEqual(s.plists, [], `${os_}: no plist`)
    }
  })
}

test('C: schedule still installs valid values', () => {
  const s = schedule(['install', '--time', '04:15', '--older-than', '9'])
  assert.equal(s.r.status, 0, s.r.stdout + s.r.stderr)
  assert.match(s.cron, /^15 4 \* \* \* .*--older-than 9 /m)
})

test('C: the Windows schedule script validates the same values', () => {
  const src = fs.readFileSync(path.join(SCRIPTS, 'cli-dispatch-clean-schedule.ps1'), 'utf8')
  assert.match(src, /\^\\d\+\$/, 'older-than must be checked as digits')
  assert.match(src, /\[0-5\]\\d/, 'time must be checked as HH:MM')
})

// ---- D. the sweep only touches real linked worktrees with a backend prefix ---------------------

function sweepFixture() {
  const work = tmp('cd-sec-sweep-')
  const fake = path.join(work, 'faketmp'); const tdir = path.join(work, 'faketmpdir'); const sess = path.join(work, 'sessions')
  for (const d of [fake, tdir, sess]) fs.mkdirSync(d)
  const shim = path.join(work, 'shim'); fs.mkdirSync(shim)
  const realFind = ['/usr/bin/find', '/bin/find'].find((p) => fs.existsSync(p))
  fs.writeFileSync(path.join(shim, 'find'), `#!/usr/bin/env bash\nif [ "$1" = "/tmp" ]; then shift; exec "${realFind}" "${fake}" "$@"; fi\nexec "${realFind}" "$@"\n`)
  fs.chmodSync(path.join(shim, 'find'), 0o755)
  const run = (args) => spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-clean'), ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, TMPDIR: tdir, CLI_DISPATCH_SESSIONS_DIR: sess, CLI_DISPATCH_CLEAN_ENGINE: path.join(SCRIPTS, 'cli-dispatch-clean.mjs') },
  })
  const old = (p) => { const t = new Date(Date.now() - 10 * 86400000); fs.utimesSync(p, t, t) }
  return { work, fake, run, old }
}

test('D: a planted *-wt-* repo never gets git run in it (core.fsmonitor) and is not deleted', () => {
  const f = sweepFixture()
  const evil = path.join(f.fake, 'cx-wt-evil')
  const marker = path.join(f.work, 'FSMONITOR_RAN')
  execSync(`git init -q "${evil}" && git -C "${evil}" config core.fsmonitor "touch ${marker}; false"`)
  f.old(evil)
  for (const args of [[], ['--remove']]) {
    f.run(args)
    assert.equal(fs.existsSync(marker), false, `fsmonitor command ran (args: ${args})`)
    assert.equal(fs.existsSync(evil), true, 'a standalone clone is not a worktree and must survive')
  }
})

test('D: a stale linked worktree whose name has no backend prefix is left alone', () => {
  const f = sweepFixture()
  const repo = path.join(f.work, 'main')
  execSync(`git init -q "${repo}" && git -C "${repo}" -c user.email=t@e -c user.name=t commit -q --allow-empty -m i`, { env: { ...process.env, ...GIT_ENV } })
  const wt = path.join(f.fake, 'my-wt-notes')
  execSync(`git -C "${repo}" worktree add -q -b side "${wt}"`)
  f.old(wt)
  f.run(['--remove'])
  assert.equal(fs.existsSync(wt), true, 'only (ds|ag|cx|oc|cp)-wt-* belong to cli-dispatch')
})

test('D: a stale clean cli-dispatch worktree is still removed', () => {
  const f = sweepFixture()
  const repo = path.join(f.work, 'main')
  execSync(`git init -q "${repo}" && git -C "${repo}" -c user.email=t@e -c user.name=t commit -q --allow-empty -m i`, { env: { ...process.env, ...GIT_ENV } })
  const wt = path.join(f.fake, 'cx-wt-abc123')
  execSync(`git -C "${repo}" worktree add -q -b side2 "${wt}"`)
  f.old(wt)
  const r = f.run(['--remove'])
  assert.equal(fs.existsSync(wt), false, r.stdout + r.stderr)
})

test('D: the Windows sweep applies the same backend-prefix rule', () => {
  assert.match(fs.readFileSync(path.join(SCRIPTS, 'cli-dispatch-clean.ps1'), 'utf8'), /\(ds\|ag\|cx\|oc\|cp\)-wt-/)
})

// ---- E. a git error is never "clean" ---------------------------------------------------------

test('E: --cleanup-if-clean never deletes a directory git cannot read', () => {
  const d = tmp('cd-sec-notgit-')
  fs.writeFileSync(path.join(d, 'work.txt'), 'finished work\n')
  const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--_test-cleanup', d, '0', '--cleanup-if-clean'], { encoding: 'utf8' })
  assert.equal(fs.existsSync(path.join(d, 'work.txt')), true, r.stdout + r.stderr)
})

// ---- F. a leak fails the run -----------------------------------------------------------------

test('F: the worktree runners exit 7 when the worker wrote outside its worktree', () => {
  const repo = path.join(tmp('cd-sec-leak-'), 'repo')
  execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo a > a && git add -A && git commit -qm s`, { env: { ...process.env, ...GIT_ENV } })
  const bin = tmp('cd-sec-leakbin-')
  // The stub "worker" edits its worktree AND the main checkout.
  // Streams get --cwd <worktree>; they do not run there, so cd first (as the real ones do).
  fs.writeFileSync(path.join(bin, 'cx-stream'), `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do [ "$1" = --cwd ] && { cd "$2" || exit 9; }; shift; done
MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
echo leaked > "$MAIN/LEAKED.txt"
echo ok > fixed.txt
echo "cx session: s1" >&2
exit 0
`)
  fs.chmodSync(path.join(bin, 'cx-stream'), 0o755)
  const brief = path.join(tmp('cd-sec-brief-'), 'b.txt'); fs.writeFileSync(brief, 'x')
  const r = spawnSync('bash', [path.join(SCRIPTS, 'cx-worktree-run.sh'), repo, 'leak-branch', brief], {
    cwd: tmp('cd-sec-leakcwd-'), encoding: 'utf8', env: { ...process.env, ...GIT_ENV, CLI_DISPATCH_NO_IN_PLACE: '1', PATH: `${bin}:${process.env.PATH}` },
  })
  const wt = /worktree[^\n]*?(\/\S*cx-wt-\S+)/.exec(r.stdout + r.stderr)
  if (wt) TRASH.push(wt[1])
  assert.equal(r.status, 7, r.stdout + r.stderr)
})

test('F: cli-dispatch-run turns a leak into a failed run, records it and shows it in the summary', () => {
  const dir = tmp('cd-sec-leakrun-')
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
    fs.copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); fs.chmodSync(path.join(bin, f), 0o755)
  }
  const repo = path.join(dir, 'repo')
  execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo s > s && git add -A && git commit -qm s`, { env: { ...process.env, ...GIT_ENV } })
  const sessions = path.join(dir, 'sessions'); fs.mkdirSync(sessions)
  fs.writeFileSync(path.join(bin, 'ds-worktree-run.sh'), `#!/usr/bin/env bash
REPO="$1"; S="${sessions}/leak-s"
mkdir -p "$S"
printf '{"state":"done","sessionId":"leak-s","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
: > "$REPO/fixed.txt"
echo "claude-ds session: leak-s" >&2
echo ">>> post-check FAIL: NEW changes appeared in $REPO, outside the worktree" >&2
exit 7
`)
  fs.chmodSync(path.join(bin, 'ds-worktree-run.sh'), 0o755)
  const r = spawnSync('bash', [path.join(bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', repo, '--prompt', 'x', '--verify', 'test -f fixed.txt'], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1' },
  })
  const vp = path.join(sessions, 'leak-s', 'verdict.json')
  assert.ok(fs.existsSync(vp), r.stderr.slice(-400))
  const v = JSON.parse(fs.readFileSync(vp, 'utf8'))
  assert.equal(v.leak, true, 'verdict must record the leak')
  assert.equal(r.status, 2, `a leak is a worker error even when verify passes; got ${r.status}`)
  const sum = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run-summary.sh'), vp, String(r.status)], { encoding: 'utf8' })
  assert.match(sum.stdout, /LEAK/, sum.stdout)
})
