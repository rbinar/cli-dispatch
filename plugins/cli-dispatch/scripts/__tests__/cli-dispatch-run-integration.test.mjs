// cli-dispatch-run-integration.test.mjs — integration checks for the --cleanup-if-clean
// gate (verdict-clean worktree removal) in cli-dispatch-run.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/cli-dispatch-run-integration.test.mjs
//
// Converted to node:test in 4.5.0 (issue #125). It was a hand-rolled main() + process.exit(),
// which collapsed four scenarios into ONE reporting unit: a single failure told you the file
// failed, not which scenario. No correctness was lost by the old shape — process.exit(1) does
// surface as a failure under `node --test` — only the ability to see which case broke.
// Each scenario still uses isolated fixtures created with mkdtemp + explicit teardown.

import { test } from 'node:test'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import assert from 'assert/strict'
import { fileURLToPath } from 'url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const RUNNER_PATH = path.join(SELF_DIR, '..', 'cli-dispatch-run')

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

function writeStubBins(dir, names) {
  fs.mkdirSync(dir, { recursive: true })
  const body = '#!/usr/bin/env bash\nprintf "echo:$1\\n"\n'
  for (const name of names) {
    const p = path.join(dir, name)
    fs.writeFileSync(p, body)
    fs.chmodSync(p, 0o755)
  }
}

function mkGitRepo({ dirty = false } = {}) {
  const repo = mkdtemp('cli-dispatch-run-wt-')
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'cli-dispatch-run-test',
    GIT_AUTHOR_EMAIL: 'cli-dispatch-run-test@example.com',
    GIT_COMMITTER_NAME: 'cli-dispatch-run-test',
    GIT_COMMITTER_EMAIL: 'cli-dispatch-run-test@example.com',
  }
  execSync('git init -q', { cwd: repo, env })
  const src = path.join(repo, 'note.txt')
  fs.writeFileSync(src, 'seed\n')
  execSync('git add note.txt && git commit -m seed', { cwd: repo, env })
  if (dirty) {
    fs.appendFileSync(src, 'dirty\n')
  }
  return repo
}

function seedSessionArtifacts(sessionRoot, worktreePath) {
  fs.mkdirSync(sessionRoot, { recursive: true })
  fs.writeFileSync(path.join(sessionRoot, 'status.json'), JSON.stringify({ state: 'done' }))
  fs.writeFileSync(path.join(sessionRoot, 'meta.json'), JSON.stringify({ backend: 'ds', cwd: worktreePath }))
  fs.writeFileSync(path.join(sessionRoot, 'changed-files.json'), JSON.stringify({ files: [] }))
}

function runCleanupMode({ worktree, exitCode, cleanupIfClean }) {
  const stubBin = mkdtemp('cli-dispatch-run-stubbin-')
  const stubOut = mkdtemp('cli-dispatch-run-stubouts-')
  writeStubBins(stubBin, ['claude', 'cx-stream'])

  const args = ['--_test-cleanup', worktree, String(exitCode)]
  if (cleanupIfClean) args.push('--cleanup-if-clean')

  const result = spawnSync('bash', [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubBin}${path.delimiter}${process.env.PATH}`,
    },
  })

  if (result.error) throw result.error

  rmrf(stubBin)
  rmrf(stubOut)
  const output = `${result.stdout || ''}${result.stderr || ''}`
  assert.equal(result.status, 0, `cli-dispatch-run --_test-cleanup should exit 0; output: ${output}`)
  return output
}

function scenarioRegressedDirtyWithExitZeroKeepsWorktree() {
  console.log('\n=== Scenario A: dirty worktree + exitCode 0 + --cleanup-if-clean keeps worktree ===')
  const repo = mkGitRepo({ dirty: true })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)

  try {
    const out = runCleanupMode({ worktree: repo, exitCode: 0, cleanupIfClean: true })
    assert.equal(fs.existsSync(repo), true, 'dirty worktree should be kept')
    assert.ok(out.includes('kept worktree'), 'output should state worktree kept')
    assert.ok(out.includes(repo), 'output should include kept worktree path')
    console.log('  [A] PASS')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

function scenarioCleanWithExitZeroAndFlagRemovesWorktree() {
  console.log('\n=== Scenario B: clean worktree + exitCode 0 + --cleanup-if-clean removes worktree ===')
  const repo = mkGitRepo({ dirty: false })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)

  try {
    runCleanupMode({ worktree: repo, exitCode: 0, cleanupIfClean: true })
    assert.equal(fs.existsSync(repo), false, 'clean worktree should be removed')
    console.log('  [B] PASS')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

function scenarioCleanExitOneKeepsWorktree() {
  console.log('\n=== Scenario C: clean worktree + exitCode 1 + --cleanup-if-clean keeps worktree ===')
  const repo = mkGitRepo({ dirty: false })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)

  try {
    const out = runCleanupMode({ worktree: repo, exitCode: 1, cleanupIfClean: true })
    assert.equal(fs.existsSync(repo), true, 'non-zero verdict should keep clean worktree')
    assert.ok(out.includes('kept worktree'), 'output should state worktree kept')
    assert.ok(out.includes(repo), 'output should include kept worktree path')
    console.log('  [C] PASS')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

function scenarioNoFlagAlwaysKeepsWorktree() {
  console.log('\n=== Scenario D: clean worktree + exitCode 0 w/o --cleanup-if-clean keeps worktree ===')
  const repo = mkGitRepo({ dirty: false })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)

  try {
    const out = runCleanupMode({ worktree: repo, exitCode: 0, cleanupIfClean: false })
    assert.equal(fs.existsSync(repo), true, 'missing flag should keep worktree')
    assert.ok(out.includes('kept worktree'), 'output should state worktree kept')
    assert.ok(out.includes(repo), 'output should include kept worktree path')
    console.log('  [D] PASS')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

// One node:test per scenario, so a failure names the case that broke.
test('a) a pre-existing dirty repo with exitCode 0 keeps the worktree', scenarioRegressedDirtyWithExitZeroKeepsWorktree)
test('b) a clean worktree with exitCode 0 and --cleanup-if-clean is removed', scenarioCleanWithExitZeroAndFlagRemovesWorktree)
test('c) a clean worktree with exitCode 1 keeps the worktree', scenarioCleanExitOneKeepsWorktree)
test('d) without --cleanup-if-clean the worktree is always kept', scenarioNoFlagAlwaysKeepsWorktree)
