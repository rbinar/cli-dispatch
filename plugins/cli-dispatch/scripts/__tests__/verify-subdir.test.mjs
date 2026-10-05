// verify-subdir.test.mjs — issue #172: `cli-dispatch-run --cwd <repo>/pkg --verify CMD` made
// the worktree for the whole repo (correct) but ran CMD at the worktree ROOT. The verify
// command must run in the same relative subdirectory the caller pointed --cwd at.
//
// Seam: `--resume <id>` against a seeded terminal session (see cli-dispatch-run-verify.test.mjs).
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/verify-subdir.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const RUNNER_PATH = path.join(SELF_DIR, '..', 'cli-dispatch-run')

const mkdtemp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }
const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
}

function mkRepo() {
  const repo = path.join(mkdtemp('cd-subdir-repo-'), 'repo')
  fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'marker-root'), 'r\n')
  fs.writeFileSync(path.join(repo, 'pkg', 'marker-pkg'), 'p\n')
  const env = { ...process.env, ...GIT_ENV }
  execSync('git init -q -b main && git add -A && git commit -q -m seed', { cwd: repo, env })
  return repo
}

function seed(sessionCwd) {
  const sessionsRoot = mkdtemp('cd-subdir-sessions-')
  const sessionId = 'ds-subdir-session'
  const dir = path.join(sessionsRoot, sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ state: 'done', sessionId }))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'ds', cwd: sessionCwd, model: 'm' }))
  fs.writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
  return { sessionsRoot, sessionId, dir }
}

function run({ cwdArg, sessionCwd, verify }) {
  const { sessionsRoot, sessionId, dir } = seed(sessionCwd)
  try {
    const res = spawnSync('bash', [RUNNER_PATH, '--backend', 'ds', '--cwd', cwdArg, '--resume', sessionId, '--verify', verify], {
      encoding: 'utf8',
      env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessionsRoot },
    })
    const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf8'))
    return { res, verdict }
  } finally { rmrf(sessionsRoot) }
}

test('#172 — --cwd at a package subdir: verify runs in <worktree>/pkg', () => {
  const repo = mkRepo()
  try {
    // The session's cwd is the worktree ROOT (what the runners record); --cwd is the subdir.
    const { res, verdict } = run({ cwdArg: path.join(repo, 'pkg'), sessionCwd: repo, verify: 'test -f marker-pkg' })
    assert.equal(verdict.verify.exitCode, 0, `verify must run in pkg/: ${JSON.stringify(verdict.verify)}`)
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`)
  } finally { rmrf(path.dirname(repo)) }
})

test('#172 — --cwd at the repo top level: verify still runs at the root', () => {
  const repo = mkRepo()
  try {
    const { res, verdict } = run({ cwdArg: repo, sessionCwd: repo, verify: 'test -f marker-root' })
    assert.equal(verdict.verify.exitCode, 0, JSON.stringify(verdict.verify))
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`)
  } finally { rmrf(path.dirname(repo)) }
})

test('#172 — in-place (session cwd already the subdir): no double subdir', () => {
  const repo = mkRepo()
  try {
    const sub = path.join(repo, 'pkg')
    const { res, verdict } = run({ cwdArg: sub, sessionCwd: sub, verify: 'test -f marker-pkg' })
    assert.equal(verdict.verify.exitCode, 0, JSON.stringify(verdict.verify))
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`)
  } finally { rmrf(path.dirname(repo)) }
})
