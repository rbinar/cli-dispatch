// worktree-sweep.test.mjs — unit tests for the worktree-artifact-sweep logic that exists in
// TWO deliberate copies (see CLAUDE.md on the self-contained-command idiom):
//   1. plugins/cli-dispatch/scripts/cli-dispatch-clean — the installed bash launcher
//      (sweep at lines ~42-136, then exec's the session engine cli-dispatch-clean.mjs)
//   2. plugins/cli-dispatch/commands/clean.md — the /cli-dispatch:clean slash command's
//      self-contained ```bash fence (same sweep + an inline node heredoc for sessions),
//      extracted verbatim and executed standalone, following kill-flow.test.mjs precedent.
// Every scenario below runs against BOTH copies, so a future edit that de-syncs them fails
// loudly here. This sweep is the destructive-`rm -rf` path: it walks /tmp and $TMPDIR for
// stale `*-wt-*` git-worktree leftovers a crashed/killed runner never cleaned up, and with
// --remove deletes the clean+stale ones, then best-effort `git worktree prune`s the source.
//
// SAFETY DESIGN — two independent isolation layers, BOTH mandatory:
// The sweep scans two roots: an unconditional, HARD-CODED `sweep_wt_dir "/tmp"` call, plus
// a conditional `sweep_wt_dir "${TMPDIR%/}"` when $TMPDIR differs from "/tmp". A test that
// isolates only one of those roots still runs real `find` (and with --remove, potentially
// real `rm -rf`) against the other on the host machine — exactly what this suite must never
// do. So:
//   Layer 1 (the literal "/tmp" call): a `find` shim placed first on the child's PATH
//     intercepts argv[1] === "/tmp" and redirects it to the per-test fixture root
//     ($CLI_DISPATCH_TEST_FAKE_TMP_ROOT), exec-ing the REAL find (resolved by absolute path
//     up front, so the shim can never recurse into itself) for every other invocation.
//   Layer 2 (the $TMPDIR call): every child invocation gets TMPDIR force-overridden to a
//     fixture-owned directory — either a dedicated empty "safe" dir, or (in the TMPDIR-branch
//     test) a second fixture root seeded on purpose. TMPDIR is NEVER inherited from the real
//     environment: on macOS the real $TMPDIR is a per-user /var/folders/... path that
//     genuinely differs from /tmp, so inheriting it would aim the second sweep at real
//     machine state. (This exact gap was flagged by a guardian review of an earlier draft of
//     this file — do not remove the override.)
// Additionally $CLI_DISPATCH_SESSIONS_DIR always points at a fresh empty tmp dir (never the
// real ~/.cache), and $CLI_DISPATCH_CLEAN_ENGINE is pinned to this repo's own
// cli-dispatch-clean.mjs so the launcher never depends on a machine-local install.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/worktree-sweep.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLEAN_SCRIPT = path.resolve(SELF_DIR, '..', 'cli-dispatch-clean')
const CLEAN_MD = path.resolve(SELF_DIR, '..', '..', 'commands', 'clean.md')
const ENGINE_MJS = path.resolve(SELF_DIR, '..', 'cli-dispatch-clean.mjs')

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

// ---- resolve the real `find` binary by absolute path (never a bare PATH lookup), so the
// shim below can exec it directly without any risk of recursing into itself or into a
// shell-function/alias named `find` some environments export. ----
function resolveRealFind() {
  for (const cand of ['/usr/bin/find', '/bin/find', '/opt/homebrew/bin/find', '/usr/local/bin/find']) {
    if (fs.existsSync(cand)) return cand
  }
  const out = execFileSync('bash', ['--noprofile', '--norc', '-c', 'command -v find'], { encoding: 'utf8' }).trim()
  assert.ok(out, 'worktree-sweep tests: could not resolve a real `find` binary on this machine')
  return out
}

const REAL_FIND = resolveRealFind()
const shimDir = mkdtemp('cli-dispatch-wtsweep-shim-')
const findShimPath = path.join(shimDir, 'find')
fs.writeFileSync(findShimPath, [
  '#!/usr/bin/env bash',
  `REAL_FIND="${REAL_FIND}"`,
  'if [ "$1" = "/tmp" ] && [ -n "${CLI_DISPATCH_TEST_FAKE_TMP_ROOT:-}" ]; then',
  '  shift',
  '  exec "$REAL_FIND" "$CLI_DISPATCH_TEST_FAKE_TMP_ROOT" "$@"',
  'fi',
  'exec "$REAL_FIND" "$@"',
  '',
].join('\n'))
fs.chmodSync(findShimPath, 0o755)

// ---- extract the ```bash fence from clean.md verbatim (kill-flow.test.mjs precedent):
// the fence is self-contained — flags arrive via `ARGS="$*"` (script positional args) and
// the session root via CLI_DISPATCH_SESSIONS_DIR, both of which we supply the same way the
// real slash command does. ----
function extractBashBlock(mdPath) {
  const content = fs.readFileSync(mdPath, 'utf8')
  const match = content.match(/```bash\n([\s\S]*?)\n```/)
  assert.ok(match, `no \`\`\`bash fence found in ${mdPath}`)
  return match[1]
}

const fenceDir = mkdtemp('cli-dispatch-wtsweep-fence-')
const fenceScriptPath = path.join(fenceDir, 'clean-block.sh')
fs.writeFileSync(fenceScriptPath, extractBashBlock(CLEAN_MD))

after(() => { rmrf(shimDir); rmrf(fenceDir) })

// ---- the two copies of the sweep logic every scenario runs against ----
const TARGETS = [
  { name: 'scripts/cli-dispatch-clean', scriptPath: CLEAN_SCRIPT },
  { name: 'clean.md fence', scriptPath: fenceScriptPath },
]

// ---- git fixture helpers ----
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function initMainRepo(dir) {
  fs.mkdirSync(dir, { recursive: true })
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'wtsweep-test@example.com'], dir)
  git(['config', 'user.name', 'wtsweep-test'], dir)
  git(['commit', '--allow-empty', '-q', '-m', 'init'], dir)
}

function addWorktree(mainRepoDir, wtPath, branch) {
  git(['-C', mainRepoDir, 'worktree', 'add', '-q', '-b', branch, wtPath])
}

function backdateDays(p, days) {
  const t = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  fs.utimesSync(p, t, t)
}

function uniq(label) { return `${label}-${crypto.randomBytes(4).toString('hex')}` }

// ---- run one target script with BOTH isolation layers active (find-shim for the literal
// "/tmp" sweep, forced TMPDIR override for the $TMPDIR sweep) ----
function runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args = [] }) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [target.scriptPath, ...args], {
      env: {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
        CLI_DISPATCH_TEST_FAKE_TMP_ROOT: fakeTmpRoot,
        // NEVER inherit the real TMPDIR (see SAFETY DESIGN header) — always a fixture dir.
        TMPDIR: tmpdirRoot,
        CLI_DISPATCH_SESSIONS_DIR: sessionsDir,
        CLI_DISPATCH_CLEAN_ENGINE: ENGINE_MJS, // launcher-only; harmless for the fence
      },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function newFixture() {
  const work = mkdtemp('cli-dispatch-wtsweep-fixture-')
  const mainRepo = path.join(work, 'main-repo')
  const fakeTmpRoot = path.join(work, 'faketmp') // stands in for the literal "/tmp" sweep root
  const tmpdirRoot = path.join(work, 'faketmpdir') // stands in for the $TMPDIR sweep root
  const sessionsDir = path.join(work, 'sessions')
  fs.mkdirSync(fakeTmpRoot, { recursive: true })
  fs.mkdirSync(tmpdirRoot, { recursive: true })
  fs.mkdirSync(sessionsDir, { recursive: true })
  return { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir }
}

for (const target of TARGETS) {
  const T = target.name

  // ==========================================================================
  // Test 0: sanity — the script is syntactically valid bash on its own
  // ==========================================================================
  test(`[${T}] passes \`bash -n\` syntax check`, () => {
    assert.doesNotThrow(() => execFileSync('bash', ['-n', target.scriptPath], { stdio: 'pipe' }))
  })

  // ==========================================================================
  // Test 1: dry-run default — an old, clean *-wt-* worktree is listed but NOT deleted
  // ==========================================================================
  test(`[${T}] dry-run default: stale clean worktree is listed as a candidate but not removed`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtDir = path.join(fakeTmpRoot, uniq('ds-wt-old'))
      addWorktree(mainRepo, wtDir, uniq('wt-old-branch'))
      backdateDays(wtDir, 5) // well past the 3-day default threshold

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: [] })

      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.match(res.stdout, /worktree stale \(clean, idle > 3d\):.*ds-wt-old/, 'expected the stale worktree to be reported as a candidate')
      assert.match(res.stdout, /DRY-RUN — 1 of 1 candidate\(s\) would be deleted/, 'expected a dry-run summary counting exactly 1 eligible candidate')
      assert.equal(fs.existsSync(wtDir), true, 'dry-run must NOT delete the worktree directory')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 2: --remove + stale clean worktree older than the threshold -> actually deleted
  // ==========================================================================
  test(`[${T}] --remove: stale clean worktree older than threshold is deleted`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtDir = path.join(fakeTmpRoot, uniq('ds-wt-old'))
      addWorktree(mainRepo, wtDir, uniq('wt-old-branch'))
      backdateDays(wtDir, 5)

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })

      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.match(res.stdout, /removed 1 worktree\(s\), skipped 0 dirty, 0 unreadable\./)
      assert.equal(fs.existsSync(wtDir), false, 'worktree directory should have been rm -rf\'d')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 3: age below threshold -> untouched, not even reported as a candidate
  // ==========================================================================
  test(`[${T}] worktree younger than threshold is left untouched (not reported, not deleted)`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtDir = path.join(fakeTmpRoot, uniq('ds-wt-young'))
      addWorktree(mainRepo, wtDir, uniq('wt-young-branch'))
      // no backdating — mtime is "now", well inside the 3-day default threshold

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })

      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.match(res.stdout, /none found\./, 'a young worktree must not even surface as a find match')
      assert.doesNotMatch(res.stdout, /ds-wt-young/, 'young worktree path should never appear in the sweep output')
      assert.equal(fs.existsSync(wtDir), true, 'young worktree directory must remain untouched')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 4: dirty worktree (uncommitted changes) -> never removed, always reported
  // ==========================================================================
  test(`[${T}] dirty worktree is never removed, even with --remove, and is reported as dirty`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtDir = path.join(fakeTmpRoot, uniq('ds-wt-dirty'))
      addWorktree(mainRepo, wtDir, uniq('wt-dirty-branch'))
      fs.writeFileSync(path.join(wtDir, 'untracked.txt'), 'uncommitted change\n')
      backdateDays(wtDir, 5)

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })

      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.match(res.stdout, /DIRTY \(skipped, uncommitted changes\).*ds-wt-dirty/, 'expected the dirty worktree to be explicitly reported')
      assert.match(res.stdout, /removed 0 worktree\(s\), skipped 1 dirty, 0 unreadable\./)
      assert.equal(fs.existsSync(wtDir), true, 'dirty worktree must survive --remove')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 5a: a plain directory matching the pattern with NO git repo at all -> skipped, no crash
  // ==========================================================================
  test(`[${T}] non-git directory matching *-wt-* pattern is skipped without crashing`, async () => {
    const { work, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      const junkDir = path.join(fakeTmpRoot, uniq('ds-wt-notgit'))
      fs.mkdirSync(junkDir, { recursive: true })
      fs.writeFileSync(path.join(junkDir, 'random-file.txt'), 'not a git repo\n')
      backdateDays(junkDir, 5)

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })

      assert.equal(res.code, 0, `expected exit 0 (no crash); stderr: ${res.stderr}`)
      assert.match(res.stdout, /SKIP \(git status failed — not a valid worktree\?\).*ds-wt-notgit/)
      assert.match(res.stdout, /removed 0 worktree\(s\), skipped 0 dirty, 1 unreadable\./)
      assert.equal(fs.existsSync(junkDir), true, 'non-git directory must never be deleted')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 5b: a directory with a broken/dangling ".git" FILE (simulating a worktree whose
  // linked gitdir no longer resolves) -> skipped, no crash
  // ==========================================================================
  test(`[${T}] directory with a broken/dangling .git file is skipped without crashing`, async () => {
    const { work, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      const brokenDir = path.join(fakeTmpRoot, uniq('ds-wt-broken'))
      fs.mkdirSync(brokenDir, { recursive: true })
      fs.writeFileSync(path.join(brokenDir, '.git'), 'gitdir: /this/path/does/not/exist/.git/worktrees/ghost\n')
      backdateDays(brokenDir, 5)

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })

      assert.equal(res.code, 0, `expected exit 0 (no crash); stderr: ${res.stderr}`)
      assert.match(res.stdout, /SKIP \(git status failed — not a valid worktree\?\).*ds-wt-broken/)
      assert.equal(fs.existsSync(brokenDir), true, 'directory with a broken .git file must never be deleted')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 6: --skip-worktrees -> the entire sweep is skipped (no header, nothing touched)
  // ==========================================================================
  test(`[${T}] --skip-worktrees: sweep is skipped entirely, even for an otherwise-eligible stale worktree`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtDir = path.join(fakeTmpRoot, uniq('ds-wt-old'))
      addWorktree(mainRepo, wtDir, uniq('wt-old-branch'))
      backdateDays(wtDir, 5)

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove', '--skip-worktrees'] })

      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.doesNotMatch(res.stdout, /worktree artifact sweep/, 'sweep header must not appear when --skip-worktrees is set')
      assert.equal(fs.existsSync(wtDir), true, 'worktree must remain untouched when the sweep is skipped, even with --remove')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 7a: after removal, the source repo gets a best-effort `git worktree prune` — the
  // stale administrative record (git worktree list / .git/worktrees/<name>) is gone afterward
  // ==========================================================================
  test(`[${T}] --remove: source repo is pruned after deletion, stale worktree record disappears from \`git worktree list\``, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtName = uniq('ds-wt-prune')
      const wtDir = path.join(fakeTmpRoot, wtName)
      addWorktree(mainRepo, wtDir, uniq('wt-prune-branch'))
      backdateDays(wtDir, 5)

      const before = git(['-C', mainRepo, 'worktree', 'list', '--porcelain'], mainRepo)
      assert.ok(before.includes(wtDir), 'sanity: worktree list should include the fixture worktree before the sweep')

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })
      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.equal(fs.existsSync(wtDir), false, 'worktree directory should be gone')

      const after = git(['-C', mainRepo, 'worktree', 'list', '--porcelain'], mainRepo)
      assert.ok(!after.includes(wtDir), 'stale worktree record should be gone from `git worktree list` after the best-effort prune')
      assert.equal(fs.existsSync(path.join(mainRepo, '.git', 'worktrees', path.basename(wtDir))), false, 'the worktree\'s admin metadata dir under .git/worktrees should be pruned away too')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 7b: best-effort prune degrades silently when there is no derivable source repo to
  // prune against (e.g. a stray directory that is its own standalone git repo, not a linked
  // worktree with a ".git" pointer file) — deletion still succeeds, no crash, no error output.
  // NOTE the literal "source repo deleted after the worktree went stale" case is NOT
  // constructible here: deleting a linked worktree's main repo breaks `git status` inside the
  // worktree itself, which routes into the SKIP branch before the rm/prune logic is reached.
  // ==========================================================================
  test(`[${T}] --remove: deletion succeeds silently (no crash) when there is no linked source repo to prune`, async () => {
    const { work, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      const standaloneDir = path.join(fakeTmpRoot, uniq('ds-wt-standalone'))
      initMainRepo(standaloneDir) // a REAL, clean, standalone repo (".git" is a directory,
      // not a worktree-style ".git" pointer file) — the sweep only tries to derive a source
      // repo to prune when "$wt/.git" is a FILE, so this exercises the "no derivable source
      // repo" branch (src_repo stays empty, prune step skipped) without crashing or blocking
      // the deletion.
      backdateDays(standaloneDir, 5)

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })

      assert.equal(res.code, 0, `expected exit 0 (no crash even though there's nothing to prune against); stderr: ${res.stderr}`)
      assert.equal(res.stderr, '', 'no stderr output expected from the silent best-effort prune skip')
      assert.match(res.stdout, /removed 1 worktree\(s\), skipped 0 dirty, 0 unreadable\./)
      assert.equal(fs.existsSync(standaloneDir), false, 'the clean, stale, standalone repo should still be deleted')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 8: --worktree-days N — custom threshold changes what counts as "stale"
  // ==========================================================================
  test(`[${T}] --worktree-days: custom threshold gates staleness (5-day-old worktree)`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      const wtDir = path.join(fakeTmpRoot, uniq('ds-wt-5d'))
      addWorktree(mainRepo, wtDir, uniq('wt-5d-branch'))
      backdateDays(wtDir, 5)

      const tooStrict = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--worktree-days', '7'] })
      assert.equal(tooStrict.code, 0, `expected exit 0; stderr: ${tooStrict.stderr}`)
      assert.match(tooStrict.stdout, /older than 7d/)
      assert.match(tooStrict.stdout, /none found\./, 'a 5-day-old worktree must not qualify under a 7-day threshold')
      assert.equal(fs.existsSync(wtDir), true)

      const lenient = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--worktree-days', '1'] })
      assert.equal(lenient.code, 0, `expected exit 0; stderr: ${lenient.stderr}`)
      assert.match(lenient.stdout, /older than 1d/)
      assert.match(lenient.stdout, /worktree stale \(clean, idle > 1d\):.*ds-wt-5d/, 'the same 5-day-old worktree must qualify under a 1-day threshold')
      assert.equal(fs.existsSync(wtDir), true, 'still a dry-run — no --remove passed, so nothing should be deleted')
    } finally {
      rmrf(work)
    }
  })

  // ==========================================================================
  // Test 9: the SECOND sweep root — a stale worktree under $TMPDIR (when it differs from
  // /tmp) is also found and removed. This both covers the `sweep_wt_dir "${TMPDIR%/}"`
  // branch and proves the TMPDIR override in runClean is what keeps that branch pointed at
  // fixture-owned state instead of the machine's real temp dir (see SAFETY DESIGN header).
  // ==========================================================================
  test(`[${T}] $TMPDIR sweep branch: stale clean worktree under the (overridden) TMPDIR is found and removed`, async () => {
    const { work, mainRepo, fakeTmpRoot, tmpdirRoot, sessionsDir } = newFixture()
    try {
      initMainRepo(mainRepo)
      // NOTE: seeded under tmpdirRoot (the $TMPDIR root), NOT fakeTmpRoot (the "/tmp" root),
      // which stays empty — so any hit can only have come from the $TMPDIR sweep call.
      const wtDir = path.join(tmpdirRoot, uniq('cx-wt-tmpdir'))
      addWorktree(mainRepo, wtDir, uniq('wt-tmpdir-branch'))
      backdateDays(wtDir, 5)

      const dry = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: [] })
      assert.equal(dry.code, 0, `expected exit 0; stderr: ${dry.stderr}`)
      assert.match(dry.stdout, /worktree stale \(clean, idle > 3d\):.*cx-wt-tmpdir/, 'the $TMPDIR sweep must surface the candidate')
      assert.equal(fs.existsSync(wtDir), true, 'dry-run: nothing deleted yet')

      const res = await runClean(target, { fakeTmpRoot, tmpdirRoot, sessionsDir, args: ['--remove'] })
      assert.equal(res.code, 0, `expected exit 0; stderr: ${res.stderr}`)
      assert.match(res.stdout, /removed 1 worktree\(s\), skipped 0 dirty, 0 unreadable\./)
      assert.equal(fs.existsSync(wtDir), false, 'stale worktree under $TMPDIR should have been removed')
    } finally {
      rmrf(work)
    }
  })
}
