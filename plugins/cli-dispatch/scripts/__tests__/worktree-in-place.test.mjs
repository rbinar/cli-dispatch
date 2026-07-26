// worktree-in-place.test.mjs — regression tests for the worktree runners' repo detection
// and in-place mode.
//
//   #107 — a linked worktree's .git is a FILE, so `test -d "$REPO/.git"` rejected it and
//          cx-worktree-run.sh exited 1 with "Not a git repo".
//   #108 — when --cwd is ALREADY a linked worktree the runner nested a second worktree,
//          the worker (following absolute paths in the brief) wrote into the target, and
//          the leak post-check called that a leak → exit 1 on a perfectly good run.
//          Cleanup must also never touch the caller-provided --cwd.
//   #109 — same root cause: the worker's cwd was a tmp tree it never edited, so its own
//          lint/test self-checks inspected untouched originals ("all checks passed").
//          cli-dispatch-run now appends a working-directory contract to every brief.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/worktree-in-place.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(SELF_DIR, '..')
const RUNNER_PATH = path.join(SCRIPTS_DIR, 'cli-dispatch-run')

const TRASH = []
const mkdtemp = (prefix) => {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
  TRASH.push(d)
  return d
}
after(() => {
  for (const p of TRASH) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'cli-dispatch-test',
  GIT_AUTHOR_EMAIL: 'cli-dispatch-test@example.com',
  GIT_COMMITTER_NAME: 'cli-dispatch-test',
  GIT_COMMITTER_EMAIL: 'cli-dispatch-test@example.com',
}

// A main checkout plus one linked worktree hanging off it — the exact shape the caller
// hands to `cli-dispatch-run --cwd <worktree>` in the issues.
function mkRepoWithLinkedWorktree() {
  // The main checkout gets its own parent dir so a test can assert that nothing was
  // written *next to* it without tripping over unrelated litter in $TMPDIR.
  const main = path.join(mkdtemp('cd-inplace-mainparent-'), 'repo')
  fs.mkdirSync(main)
  const env = { ...process.env, ...GIT_ENV }
  execSync('git init -q -b main', { cwd: main, env })
  fs.writeFileSync(path.join(main, 'note.txt'), 'seed\n')
  execSync('git add note.txt && git commit -q -m seed', { cwd: main, env })
  const wt = path.join(mkdtemp('cd-inplace-wtparent-'), 'wt')
  execSync(`git worktree add -q -b feature/x "${wt}" main`, { cwd: main, env })
  return { main, wt }
}

// Stub worker: records the --cwd it was launched with and the brief it received, and can
// be told to create a file in an arbitrary directory (to simulate a real or a false leak).
function mkStubStream(names) {
  const bin = mkdtemp('cd-inplace-bin-')
  const out = mkdtemp('cd-inplace-out-')
  const body = `#!/usr/bin/env bash
CWD=""; BRIEF=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --cwd) CWD="$2"; shift 2;;
    -p) BRIEF="$2"; shift 2;;
    *) shift;;
  esac
done
printf '%s' "$CWD" > "${out}/cwd.txt"
printf '%s' "$BRIEF" > "${out}/brief.txt"
[ -n "\${STUB_WRITE_TO:-}" ] && printf 'touched\\n' > "\${STUB_WRITE_TO}/stub-artifact.txt"
# Lay down the session dir the real *-stream parsers write, so a cli-dispatch-run-driven
# test gets past session discovery and actually reaches the cleanup stage.
if [ -n "\${CLI_DISPATCH_SESSIONS_DIR:-}" ]; then
  SD="\${CLI_DISPATCH_SESSIONS_DIR}/stub-session"
  mkdir -p "$SD"
  printf '{"state":"done"}' > "$SD/status.json"
  printf '{"backend":"ds","cwd":"%s"}' "$CWD" > "$SD/meta.json"
  printf '{"files":[],"diffstat":""}' > "$SD/changed-files.json"
fi
echo "claude-ds session: stub-session" >&2
echo "  thread:  stub-session" >&2
exit 0
`
  for (const n of names) {
    const p = path.join(bin, n)
    fs.writeFileSync(p, body)
    fs.chmodSync(p, 0o755)
  }
  return { bin, out }
}

function runRunner(script, { repo, branch = 'test-branch', brief = 'do the thing', env = {} }) {
  const { bin, out } = mkStubStream(['claude-ds-stream', 'cx-stream', 'ag-stream', 'oc-stream', 'cp-stream'])
  const briefFile = path.join(mkdtemp('cd-inplace-brief-'), 'brief.txt')
  fs.writeFileSync(briefFile, brief)
  const res = spawnSync('bash', [path.join(SCRIPTS_DIR, script), repo, branch, briefFile], {
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env },
  })
  if (res.error) throw res.error
  const read = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null)
  // The legacy path creates a real /tmp/<backend>-wt-* worktree the runner never removes;
  // its parent repo is deleted in after(), so without this it is orphaned on the machine.
  const cwdUsed = read('cwd.txt')
  if (cwdUsed && /[/\\](ds|ag|cx|cp|oc)-wt-/.test(cwdUsed)) TRASH.push(cwdUsed)
  return {
    status: res.status,
    output: `${res.stdout || ''}${res.stderr || ''}`,
    workerCwd: read('cwd.txt'),
    workerBrief: read('brief.txt'),
  }
}

const realish = (p) => (p ? fs.realpathSync(p) : p)

// The cli-dispatch-run-driven cases below drive the stub directly rather than through
// runRunner, so their legacy-path /tmp/<backend>-wt-* worktrees need registering too.
function trashWorkerCwd(out) {
  const f = path.join(out, 'cwd.txt')
  if (!fs.existsSync(f)) return
  const cwd = fs.readFileSync(f, 'utf8')
  if (cwd && /[/\\](ds|ag|cx|cp|oc)-wt-/.test(cwd)) TRASH.push(cwd)
}

// ---------------------------------------------------------------------------- #107

test('#107 — every backend runner accepts a linked worktree as <repo-path>', () => {
  const { wt } = mkRepoWithLinkedWorktree()
  for (const script of [
    'ds-worktree-run.sh', 'cx-worktree-run.sh', 'ag-worktree-run.sh',
    'oc-worktree-run.sh', 'cp-worktree-run.sh',
  ]) {
    const r = runRunner(script, { repo: wt })
    assert.ok(!r.output.includes('Not a git repo'), `${script}: rejected a valid linked worktree:\n${r.output}`)
    assert.equal(r.status, 0, `${script}: expected exit 0, got ${r.status}:\n${r.output}`)
  }
})

test('#107 — a non-repo directory is still rejected', () => {
  const notRepo = mkdtemp('cd-inplace-notrepo-')
  const r = runRunner('cx-worktree-run.sh', { repo: notRepo })
  assert.equal(r.status, 1)
  assert.ok(r.output.includes('Not a git repo'), r.output)
})

// ------------------------------------------------------------------------ #108/#109

test('#109 — in-place mode runs the worker IN the target worktree, not a tmp copy', () => {
  const { wt } = mkRepoWithLinkedWorktree()
  const r = runRunner('ds-worktree-run.sh', { repo: wt })
  assert.equal(r.status, 0, r.output)
  assert.ok(r.output.includes('In-place mode'), `expected in-place banner:\n${r.output}`)
  assert.equal(realish(r.workerCwd), realish(wt), 'worker must be launched in the target worktree')
})

test('#108 — writes into the target worktree are NOT reported as a leak', () => {
  const { wt } = mkRepoWithLinkedWorktree()
  const r = runRunner('ds-worktree-run.sh', { repo: wt, env: { STUB_WRITE_TO: wt } })
  assert.equal(r.status, 0, `writing to the caller's own worktree must not fail the run:\n${r.output}`)
  assert.ok(!r.output.includes('post-check FAIL'), r.output)
  assert.ok(fs.existsSync(path.join(wt, 'stub-artifact.txt')), 'the worker write should still be there')
})

test('#108 — in-place mode still guards the MAIN checkout against real leaks', () => {
  const { main, wt } = mkRepoWithLinkedWorktree()
  const r = runRunner('ds-worktree-run.sh', { repo: wt, env: { STUB_WRITE_TO: main } })
  assert.equal(r.status, 1, `a write into the main checkout must still fail:\n${r.output}`)
  assert.ok(r.output.includes('post-check FAIL'), r.output)
  assert.ok(r.output.includes(main), r.output)
})

test('#108 — in-place mode creates no nested worktree and removes nothing', () => {
  const { main, wt } = mkRepoWithLinkedWorktree()
  const before = execSync('git worktree list', { cwd: main, encoding: 'utf8' })
  const r = runRunner('ds-worktree-run.sh', { repo: wt })
  assert.equal(r.status, 0, r.output)
  const after = execSync('git worktree list', { cwd: main, encoding: 'utf8' })
  assert.equal(after, before, 'the worktree list must be untouched in in-place mode')
  assert.ok(fs.existsSync(wt), 'the caller-provided worktree must survive')
})

test('a plain main checkout still gets an isolated nested worktree (legacy path)', () => {
  const { main } = mkRepoWithLinkedWorktree()
  const r = runRunner('ds-worktree-run.sh', { repo: main, branch: 'ds-run-legacy' })
  assert.equal(r.status, 0, r.output)
  assert.ok(!r.output.includes('In-place mode'), r.output)
  assert.notEqual(realish(r.workerCwd), realish(main), 'worker must NOT run in the main checkout')
  assert.ok(/ds-wt-/.test(r.workerCwd), `expected a tmp worktree, got ${r.workerCwd}`)
})

test('CLI_DISPATCH_NO_IN_PLACE=1 restores the legacy nested-worktree behaviour', () => {
  const { wt } = mkRepoWithLinkedWorktree()
  const r = runRunner('ds-worktree-run.sh', {
    repo: wt, branch: 'ds-run-legacy-2', env: { CLI_DISPATCH_NO_IN_PLACE: '1' },
  })
  // Without status/shape assertions this passes vacuously when the run dies early:
  // realish(null) is null, which is also !== wt.
  assert.equal(r.status, 0, r.output)
  assert.ok(!r.output.includes('In-place mode'), r.output)
  assert.notEqual(realish(r.workerCwd), realish(wt))
  assert.ok(/ds-wt-/.test(r.workerCwd), `expected a tmp worktree, got ${r.workerCwd}`)
})

test('an inherited GIT_DIR/GIT_WORK_TREE cannot hijack in-place detection', () => {
  const { main } = mkRepoWithLinkedWorktree()
  // A git hook or `git rebase --exec` exports these; `git -C <path>` obeys them, so an
  // unguarded runner would describe the INHERITED repo and hand the worker the user's
  // main checkout with zero isolation.
  const linkedGitDir = path.join(main, '.git', 'worktrees', 'wt')
  const r = runRunner('ds-worktree-run.sh', {
    repo: main,
    branch: 'ds-run-envhijack',
    env: { GIT_DIR: linkedGitDir, GIT_WORK_TREE: main },
  })
  assert.equal(r.status, 0, r.output)
  assert.ok(!r.output.includes('In-place mode'), `a main checkout must never go in-place:\n${r.output}`)
  assert.notEqual(realish(r.workerCwd), realish(main), 'worker must NOT be given the main checkout')
  assert.ok(/ds-wt-/.test(r.workerCwd), `expected a tmp worktree, got ${r.workerCwd}`)
})

test('a bare repo and a .git admin dir are rejected, not run in', () => {
  const { main } = mkRepoWithLinkedWorktree()
  const bare = path.join(mkdtemp('cd-inplace-bareparent-'), 'bare.git')
  execSync(`git clone -q --bare "${main}" "${bare}"`, { env: { ...process.env, ...GIT_ENV } })
  for (const target of [bare, path.join(main, '.git')]) {
    const r = runRunner('ds-worktree-run.sh', { repo: target })
    assert.equal(r.status, 1, `${target} should be rejected:\n${r.output}`)
    assert.ok(r.output.includes('not a work tree') || r.output.includes('Not a git repo'), r.output)
    assert.equal(r.workerCwd, null, 'the worker must never be launched')
  }
})

test('the leak patch is written to the temp dir, not next to the guarded repo', () => {
  const { main, wt } = mkRepoWithLinkedWorktree()
  const mainParent = path.dirname(main)
  const r = runRunner('ds-worktree-run.sh', { repo: wt, env: { STUB_WRITE_TO: main } })
  assert.equal(r.status, 1, r.output)
  const strays = fs.readdirSync(mainParent).filter((f) => f.startsWith('leaked-changes-'))
  assert.deepEqual(strays, [], `patch must not be dropped into ${mainParent}`)
  const m = r.output.match(/patch saved: (\S+)/)
  assert.ok(m, `expected a patch path in the output:\n${r.output}`)
  TRASH.push(m[1])
  assert.ok(fs.existsSync(m[1]), `patch should exist at ${m[1]}`)
})

// --------------------------------------------------- #108: cleanup must not touch --cwd

test('#108 — cleanup never removes the caller-provided --cwd', () => {
  const { wt } = mkRepoWithLinkedWorktree()
  // Clean + exit 0 + --cleanup-if-clean is exactly the combination that WOULD remove it.
  const res = spawnSync('bash', [
    RUNNER_PATH, '--cwd', wt, '--cleanup-if-clean', '--_test-cleanup', wt, '0',
  ], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  if (res.error) throw res.error
  const output = `${res.stdout || ''}${res.stderr || ''}`
  assert.equal(res.status, 0, output)
  assert.ok(fs.existsSync(wt), `the caller's --cwd must never be removed:\n${output}`)
  assert.ok(output.includes('leaving it untouched'), output)
})

test('#108 — the in-place marker survives cli-dispatch-run\'s capture and arms IN_PLACE_RUN', () => {
  // The marker belt is the PRIMARY guard; the path comparison is only the fallback.
  // cli-dispatch-run captures the runner with `2>&1 >/dev/null | tee`, so a marker on
  // stdout is silently discarded and the belt is inert — this asserts it is not.
  const { wt } = mkRepoWithLinkedWorktree()
  const { bin } = mkStubStream(['claude-ds-stream'])
  const res = spawnSync('bash', [
    RUNNER_PATH, '--backend', 'ds', '--cwd', wt, '--prompt', 'do the thing', '--cleanup-if-clean',
  ], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env, ...GIT_ENV,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      CLI_DISPATCH_SESSIONS_DIR: mkdtemp('cd-inplace-sessions-'),
    },
  })
  const output = `${res.stdout || ''}${res.stderr || ''}`
  assert.ok(output.includes('cli-dispatch: in-place=1'), `marker lost before cli-dispatch-run saw it:\n${output}`)
  assert.ok(
    output.includes('worker ran in-place'),
    `cleanup must key off the marker, not fall through to the path belt:\n${output}`,
  )
  assert.ok(fs.existsSync(wt), "the caller's worktree must survive")
})

test('cleanup still removes a clean worktree the runner created itself', () => {
  const { main, wt } = mkRepoWithLinkedWorktree()
  const res = spawnSync('bash', [
    RUNNER_PATH, '--cwd', main, '--cleanup-if-clean', '--_test-cleanup', wt, '0',
  ], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  if (res.error) throw res.error
  const output = `${res.stdout || ''}${res.stderr || ''}`
  assert.equal(res.status, 0, output)
  assert.equal(fs.existsSync(wt), false, `a runner-owned clean worktree should be removed:\n${output}`)
})

// ------------------------------------------------ #109: working-directory contract

test('#109 — cli-dispatch-run appends the working-directory contract to the brief', () => {
  const { main } = mkRepoWithLinkedWorktree()
  const { bin, out } = mkStubStream(['claude-ds-stream'])
  // The run cannot complete (no real session dir); we only care about the brief the
  // worktree runner handed to the worker.
  spawnSync('bash', [RUNNER_PATH, '--backend', 'ds', '--cwd', main, '--prompt', 'do the thing'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env, ...GIT_ENV,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      CLI_DISPATCH_SESSIONS_DIR: mkdtemp('cd-inplace-sessions-'),
    },
  })
  trashWorkerCwd(out)
  const briefPath = path.join(out, 'brief.txt')
  assert.ok(fs.existsSync(briefPath), 'the worker should have been launched')
  const brief = fs.readFileSync(briefPath, 'utf8')
  assert.ok(brief.includes('do the thing'), 'the caller prompt must be preserved')
  assert.ok(brief.includes('Working-directory contract'), `contract missing from brief:\n${brief}`)
  assert.ok(brief.includes('Your self-reported results are not the gate'), brief)
})

test("#109 — the caller's --prompt-file is copied, never mutated", () => {
  const { main } = mkRepoWithLinkedWorktree()
  const { bin, out } = mkStubStream(['claude-ds-stream'])
  const promptFile = path.join(mkdtemp('cd-inplace-prompt-'), 'brief.md')
  const original = 'refactor the parser\n'
  fs.writeFileSync(promptFile, original)
  spawnSync('bash', [RUNNER_PATH, '--backend', 'ds', '--cwd', main, '--prompt-file', promptFile], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env, ...GIT_ENV,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      CLI_DISPATCH_SESSIONS_DIR: mkdtemp('cd-inplace-sessions-'),
    },
  })
  trashWorkerCwd(out)
  assert.equal(fs.readFileSync(promptFile, 'utf8'), original, "the caller's file must be byte-identical")
  const brief = fs.readFileSync(path.join(out, 'brief.txt'), 'utf8')
  assert.ok(brief.startsWith(original), 'the caller prompt must lead the brief')
  assert.ok(brief.includes('Working-directory contract'), brief)
})

test('#109 — CLI_DISPATCH_NO_CWD_CONTRACT=1 opts out', () => {
  const { main } = mkRepoWithLinkedWorktree()
  const { bin, out } = mkStubStream(['claude-ds-stream'])
  spawnSync('bash', [RUNNER_PATH, '--backend', 'ds', '--cwd', main, '--prompt', 'do the thing'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env, ...GIT_ENV,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      CLI_DISPATCH_SESSIONS_DIR: mkdtemp('cd-inplace-sessions-'),
      CLI_DISPATCH_NO_CWD_CONTRACT: '1',
    },
  })
  trashWorkerCwd(out)
  const brief = fs.readFileSync(path.join(out, 'brief.txt'), 'utf8')
  assert.equal(brief.trim(), 'do the thing')
})

// ---------------------------------------------------------------------------- #124
// The leak post-check answers one question: did the worker write OUTSIDE the tree it was
// given? Only ds-worktree-run.sh asked it (11 GUARD_REPO refs; 0 in ag/cx/oc/cp), so on the
// other four backends a worker that resolved an absolute path back out of its worktree did so
// silently. These tests run the real scripts against a real repo for ALL FIVE, so the guard
// cannot regress on one backend while passing on another.

const ALL_RUNNERS = [
  ['ds', 'ds-worktree-run.sh'],
  ['ag', 'ag-worktree-run.sh'],
  ['cx', 'cx-worktree-run.sh'],
  ['oc', 'oc-worktree-run.sh'],
  ['cp', 'cp-worktree-run.sh'],
]

for (const [backend, script] of ALL_RUNNERS) {
  test(`#124 [${backend}] a worker writing outside its worktree is caught`, () => {
    const repo = mkRepo()
    // STUB_WRITE_TO points the stub at the repo it was NOT given — a real leak.
    const r = runRunner(script, { repo, env: { STUB_WRITE_TO: repo } })
    assert.ok(r.output.includes('post-check FAIL'), `${backend}: leak not reported\n${r.output}`)
    assert.equal(r.status, 1, `${backend}: a leak must exit non-zero`)
    assert.ok(/patch saved:/.test(r.output), `${backend}: the recovery patch must be reported`)
  })

  test(`#124 [${backend}] a clean run reports no leak`, () => {
    const repo = mkRepo()
    const r = runRunner(script, { repo })
    assert.ok(r.output.includes('post-check OK'), `${backend}: clean run not confirmed\n${r.output}`)
    assert.equal(r.status, 0, `${backend}: a clean run must exit 0`)
  })

  // The guard must fire only on NEW dirt. A pre-existing untracked file (a stray CLAUDE.md,
  // editor droppings) previously failed every perfectly good run in production.
  test(`#124 [${backend}] pre-existing dirt is not blamed on the worker`, () => {
    const repo = mkRepo()
    fs.writeFileSync(path.join(repo, 'was-already-here.txt'), 'not the worker\n')
    const r = runRunner(script, { repo })
    assert.ok(!r.output.includes('post-check FAIL'), `${backend}: false positive on pre-existing dirt\n${r.output}`)
    assert.equal(r.status, 0, `${backend}: pre-existing dirt must not fail the run`)
  })

  test(`#124 [${backend}] --post-check mode works standalone`, () => {
    const repo = mkRepo()
    const clean = spawnSync('bash', [path.join(SCRIPTS_DIR, script), '--post-check', repo],
      { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
    assert.equal(clean.status, 0, `${backend}: clean repo should pass --post-check`)
    assert.ok(`${clean.stdout}`.includes('post-check OK'))
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x\n')
    const dirty = spawnSync('bash', [path.join(SCRIPTS_DIR, script), '--post-check', repo],
      { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
    assert.equal(dirty.status, 1, `${backend}: dirty repo should fail --post-check`)
    assert.ok(`${dirty.stderr}`.includes('post-check FAIL'))
  })
}

// mkRepo: a plain main checkout (the in-place helper above builds a linked worktree instead).
function mkRepo() {
  const repo = mkdtemp('cd-guard-repo-')
  const env = { ...process.env, ...GIT_ENV }
  execSync('git init -q -b main', { cwd: repo, env })
  fs.writeFileSync(path.join(repo, 'note.txt'), 'seed\n')
  execSync('git add note.txt && git commit -q -m seed', { cwd: repo, env })
  return repo
}
