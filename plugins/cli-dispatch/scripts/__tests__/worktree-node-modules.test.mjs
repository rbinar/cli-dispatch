// worktree-node-modules.test.mjs — the worktree runners must give the worker (and the
// --verify step that runs in the same tree afterwards) the source checkout's installed
// dependencies, at every level of the repo, whatever directory --cwd pointed at.
//
// The bug this pins (issue #158): each runner symlinked "$REPO/node_modules" to
// "$WT/node_modules" — one link, source and target both at "the repo". Handed a workspace
// package as --cwd (`--cwd repo/packages/core`), $REPO was that package, `git worktree add`
// still checked out the WHOLE repo into $WT, and the worktree ROOT got the package-local
// node_modules. The hoisted root install — where npm/yarn workspaces put `.bin/vitest` —
// was never linked, so `--verify 'cd packages/core && npx vitest run …'` died with
// `sh: vitest: command not found` (exit 127) on a worker run that was otherwise fine.
//
// Contract: every ignored `node_modules` directory of the source checkout is symlinked into
// the worktree at the same relative path; the source is resolved from the repo TOP, not
// from --cwd.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/worktree-node-modules.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(SELF_DIR, '..')
const RUNNERS = [
  'ds-worktree-run.sh', 'cx-worktree-run.sh', 'ag-worktree-run.sh',
  'oc-worktree-run.sh', 'cp-worktree-run.sh',
]

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

// An npm-workspaces-shaped monorepo: hoisted root node_modules (with the .bin the verify
// command needs), one workspace package with its own non-hoisted node_modules, one
// workspace package with none. All node_modules dirs are gitignored, as in real life.
function mkMonorepo({ withNodeModules = true } = {}) {
  const repo = path.join(mkdtemp('cd-nm-repo-'), 'repo')
  fs.mkdirSync(repo)
  const env = { ...process.env, ...GIT_ENV }
  execSync('git init -q -b main', { cwd: repo, env })
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\ndist/\n')
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"mono","workspaces":["packages/*"]}\n')
  fs.mkdirSync(path.join(repo, 'packages', 'core'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'packages', 'core', 'package.json'), '{"name":"@mono/core"}\n')
  fs.mkdirSync(path.join(repo, 'packages', 'bare'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'packages', 'bare', 'package.json'), '{"name":"@mono/bare"}\n')
  execSync('git add -A && git commit -q -m seed', { cwd: repo, env })
  if (withNodeModules) {
    fs.mkdirSync(path.join(repo, 'node_modules', '.bin'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'node_modules', '.bin', 'vitest'), '#!/bin/sh\necho hoisted-vitest\n')
    fs.chmodSync(path.join(repo, 'node_modules', '.bin', 'vitest'), 0o755)
    fs.mkdirSync(path.join(repo, 'packages', 'core', 'node_modules', 'localdep'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'packages', 'core', 'node_modules', 'localdep', 'index.js'), 'module.exports = 1\n')
    // Ignored, but NOT a node_modules dir — must never be linked.
    fs.mkdirSync(path.join(repo, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'dist', 'bundle.js'), '// built\n')
  }
  return repo
}

// Stub worker: records the --cwd it was launched with. The runner's dependency links must
// already exist at that moment (the real worker runs its own tests inside the tree).
function mkStubStream() {
  const bin = mkdtemp('cd-nm-bin-')
  const out = mkdtemp('cd-nm-out-')
  const body = `#!/usr/bin/env bash
CWD=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --cwd) CWD="$2"; shift 2;;
    *) shift;;
  esac
done
printf '%s' "$CWD" > "${out}/cwd.txt"
# Snapshot what the worker sees, before any cleanup could touch it.
if [ -L "$CWD/node_modules" ]; then readlink "$CWD/node_modules" > "${out}/root-link.txt"; fi
if [ -L "$CWD/packages/core/node_modules" ]; then readlink "$CWD/packages/core/node_modules" > "${out}/core-link.txt"; fi
[ -e "$CWD/packages/bare/node_modules" ] && printf 'yes' > "${out}/bare-exists.txt"
[ -e "$CWD/dist" ] && printf 'yes' > "${out}/dist-exists.txt"
echo "claude-ds session: stub-session" >&2
exit 0
`
  for (const n of ['claude-ds-stream', 'cx-stream', 'ag-stream', 'oc-stream', 'cp-stream']) {
    const p = path.join(bin, n)
    fs.writeFileSync(p, body)
    fs.chmodSync(p, 0o755)
  }
  return { bin, out }
}

function runRunner(script, cwdArg) {
  const { bin, out } = mkStubStream()
  const briefFile = path.join(mkdtemp('cd-nm-brief-'), 'brief.txt')
  fs.writeFileSync(briefFile, 'do the thing')
  const res = spawnSync('bash', [path.join(SCRIPTS_DIR, script), cwdArg, `test-${script.replace(/\W/g, '-')}`, briefFile], {
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  })
  if (res.error) throw res.error
  const read = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8').trim() : null)
  const workerCwd = read('cwd.txt')
  // Legacy-path worktrees live in /tmp and are never removed by the runner.
  if (workerCwd && /[/\\](ds|ag|cx|cp|oc)-wt-/.test(workerCwd)) TRASH.push(workerCwd)
  return {
    status: res.status,
    output: `${res.stdout || ''}${res.stderr || ''}`,
    workerCwd,
    rootLink: read('root-link.txt'),
    coreLink: read('core-link.txt'),
    bareExists: read('bare-exists.txt'),
    distExists: read('dist-exists.txt'),
  }
}

const real = (p) => fs.realpathSync(p)

test('#158 — --cwd at a workspace package: root AND package node_modules land at the same relative paths', () => {
  const repo = mkMonorepo()
  for (const script of RUNNERS) {
    const r = runRunner(script, path.join(repo, 'packages', 'core'))
    assert.equal(r.status, 0, `${script} exited ${r.status}:\n${r.output}`)
    assert.ok(r.workerCwd, `${script}: stub worker never ran`)
    assert.ok(r.rootLink, `${script}: worktree root has no node_modules link`)
    assert.equal(real(r.rootLink), real(path.join(repo, 'node_modules')),
      `${script}: worktree ROOT node_modules must point at the repo-TOP install, got ${r.rootLink}`)
    assert.ok(r.coreLink, `${script}: worktree packages/core has no node_modules link`)
    assert.equal(real(r.coreLink), real(path.join(repo, 'packages', 'core', 'node_modules')),
      `${script}: packages/core/node_modules must point at the package-local install, got ${r.coreLink}`)
    // The one thing the verify command actually needs: the hoisted bin is reachable.
    assert.ok(fs.existsSync(path.join(r.workerCwd, 'node_modules', '.bin', 'vitest')),
      `${script}: node_modules/.bin/vitest not reachable from the worktree root`)
    assert.equal(r.bareExists, null, `${script}: a package with no node_modules must not gain one`)
    assert.equal(r.distExists, null, `${script}: non-node_modules ignored dirs (dist/) must not be linked`)
  }
})

test('#158 — --cwd at the repo root: same links (the pre-existing single-link case still holds)', () => {
  const repo = mkMonorepo()
  for (const script of RUNNERS) {
    const r = runRunner(script, repo)
    assert.equal(r.status, 0, `${script} exited ${r.status}:\n${r.output}`)
    assert.equal(real(r.rootLink), real(path.join(repo, 'node_modules')), `${script}: root link`)
    assert.equal(real(r.coreLink), real(path.join(repo, 'packages', 'core', 'node_modules')), `${script}: package link`)
  }
})

test('#158 — a repo with no node_modules at all: no links, no error', () => {
  const repo = mkMonorepo({ withNodeModules: false })
  for (const script of RUNNERS) {
    const r = runRunner(script, path.join(repo, 'packages', 'core'))
    assert.equal(r.status, 0, `${script} exited ${r.status}:\n${r.output}`)
    assert.equal(r.rootLink, null, `${script}: no source node_modules → no root link`)
    assert.equal(r.coreLink, null, `${script}: no source node_modules → no package link`)
  }
})
