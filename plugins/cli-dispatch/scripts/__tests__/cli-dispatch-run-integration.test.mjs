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
const WRITER_PATH = path.join(SELF_DIR, '..', 'verdict-writer.mjs')

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

function runCleanupMode({ worktree, exitCode, cleanupIfClean, sessionDir }) {
  const stubBin = mkdtemp('cli-dispatch-run-stubbin-')
  const stubOut = mkdtemp('cli-dispatch-run-stubouts-')
  writeStubBins(stubBin, ['claude', 'cx-stream'])

  // The optional third value drives the worktreeRemoved bookkeeping (issue #128) as well as
  // the removal; without it the runner takes exactly the path the other scenarios exercise.
  const args = ['--_test-cleanup', worktree, String(exitCode)]
  if (sessionDir) args.push(sessionDir)
  if (cleanupIfClean) args.push('--cleanup-if-clean')

  const result = spawnSync('bash', [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubBin}${path.delimiter}${process.env.PATH}`,
      // Pin the engine to THIS checkout. The runner's own search order prefers
      // ~/.local/share/cli-dispatch/verdict-writer.mjs — the last-installed copy — so without
      // this the test silently grades the installed version instead of the one being changed.
      // (It found this bug: a repo-fresh subcommand against a stale installed engine.)
      CLI_DISPATCH_VERDICT_WRITER: WRITER_PATH,
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

// ---- issue #128: worktreeRemoved is recorded AFTER the removal ---------------------------
//
// verdict.json is written before cleanup can act (it is the escalation artifact and must exist
// even if cleanup dies), so the runner has to come back and record the removal. Before this fix
// the field was structurally always false and the SDD's own contract (:217) was unmeetable.

function writeVerdict(sessionDir, extra = {}) {
  const verdict = {
    schemaVersion: 1,
    sessionId: 'session-id',
    backend: 'ds',
    state: 'done',
    exitCode: 0,
    stranded: false,
    worktreeRemoved: false,
    ...extra,
  }
  fs.writeFileSync(path.join(sessionDir, 'verdict.json'), `${JSON.stringify(verdict)}\n`)
  return verdict
}

function readVerdict(sessionDir) {
  return JSON.parse(fs.readFileSync(path.join(sessionDir, 'verdict.json'), 'utf8'))
}

function scenarioRemovalRecordsWorktreeRemoved() {
  const repo = mkGitRepo({ dirty: false })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)
  writeVerdict(sessionDir)

  try {
    runCleanupMode({ worktree: repo, exitCode: 0, cleanupIfClean: true, sessionDir })
    assert.equal(fs.existsSync(repo), false, 'clean worktree should be removed')
    assert.equal(readVerdict(sessionDir).worktreeRemoved, true, 'removal must be recorded in verdict.json')
    // The bookkeeping write touches one field and nothing else.
    assert.equal(readVerdict(sessionDir).exitCode, 0)
    assert.equal(readVerdict(sessionDir).state, 'done')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

function scenarioKeptWorktreeLeavesFieldFalse() {
  // The mirror assertion, and the one that matters most: a KEPT worktree must never be
  // reported as removed. Dirty worktrees are exactly the stranded-changes population.
  const repo = mkGitRepo({ dirty: true })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)
  writeVerdict(sessionDir)

  try {
    runCleanupMode({ worktree: repo, exitCode: 0, cleanupIfClean: true, sessionDir })
    assert.equal(fs.existsSync(repo), true, 'dirty worktree should be kept')
    assert.equal(readVerdict(sessionDir).worktreeRemoved, false, 'a kept worktree must stay worktreeRemoved:false')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

function scenarioMissingVerdictDoesNotFailTheRun() {
  // Cleanup can legitimately run with no verdict on disk (a killed run). The bookkeeping step
  // is not allowed to turn that into a failure — runCleanupMode asserts exit 0 itself.
  const repo = mkGitRepo({ dirty: false })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)

  try {
    const out = runCleanupMode({ worktree: repo, exitCode: 0, cleanupIfClean: true, sessionDir })
    assert.equal(fs.existsSync(repo), false, 'clean worktree should still be removed')
    assert.equal(fs.existsSync(path.join(sessionDir, 'verdict.json')), false, 'no verdict should be invented')
    assert.ok(out.includes('removed clean worktree'), 'output should still report the removal')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
  }
}

// ---- empty-verdict fail-closed: build-verdict that produces no output must NOT exit 0 ----
//
// When build-verdict prints nothing (regardless of its exit status), the runner must report
// exit code 5 ("setup error") rather than trusting the helper's exit code. A helper that
// exits 0 with no output must never read as "the run passed."

function writeStubVerdictWriter(dirPath, buildVerdictBehavior) {
  // buildVerdictBehavior: { output?: string, exitCode?: number }
  const p = path.join(dirPath, 'stub-verdict-writer.mjs')
  const output = buildVerdictBehavior.output !== undefined ? JSON.stringify(buildVerdictBehavior.output) : 'null'
  const exitCode = buildVerdictBehavior.exitCode ?? 0
  fs.writeFileSync(p, `#!/usr/bin/env node
const sub = process.argv[2]
if (sub === 'build-verdict') {
${buildVerdictBehavior.output !== undefined ? `  process.stdout.write(${output})` : '  // print nothing'}
  process.exit(${exitCode})
}
// Behave sanely for other subcommands (run-verify, mark-worktree-removed)
console.log(JSON.stringify({state:'done'}))
`)
  fs.chmodSync(p, 0o755)
  return p
}

function scenarioEmptyBuildVerdictExitsFiveNotZero() {
  console.log('\n=== Scenario H: empty build-verdict output + exit 0 must exit 5 ===')
  const repo = mkGitRepo({ dirty: false })
  const sessionDir = mkdtemp('cli-dispatch-run-session-')
  seedSessionArtifacts(sessionDir, repo)

  const stubWriterDir = mkdtemp('cli-dispatch-run-stubwriter-')
  const stubWriterPath = writeStubVerdictWriter(stubWriterDir, { exitCode: 0 })

  try {
    const result = spawnSync('bash', [RUNNER_PATH, '--_test-verdict-build', sessionDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLI_DISPATCH_VERDICT_WRITER: stubWriterPath,
      },
    })

    const output = `${result.stdout || ''}${result.stderr || ''}`
    assert.equal(result.status, 5, `empty build-verdict output should exit 5, not ${result.status}; output: ${output}`)

    const verdictPath = path.join(sessionDir, 'verdict.json')
    assert.equal(fs.existsSync(verdictPath), true, 'verdict.json should exist even when build-verdict fails')
    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'))
    assert.ok(verdict.error, 'verdict should carry error field')
    assert.equal(verdict.exitCode, 5, `verdict.exitCode should be 5, not ${verdict.exitCode}`)
    assert.equal(verdict.schemaVersion, 1, 'verdict should still carry schemaVersion')
    assert.ok(verdict.sessionId, 'verdict should still carry sessionId')
    assert.ok(result.stderr.includes('verdict could not be built'), 'stderr should report verdict build failure')

    console.log('  [H] PASS')
  } finally {
    rmrf(sessionDir)
    rmrf(repo)
    rmrf(stubWriterDir)
  }
}

// One node:test per scenario, so a failure names the case that broke.
test('a) a pre-existing dirty repo with exitCode 0 keeps the worktree', scenarioRegressedDirtyWithExitZeroKeepsWorktree)
test('b) a clean worktree with exitCode 0 and --cleanup-if-clean is removed', scenarioCleanWithExitZeroAndFlagRemovesWorktree)
test('c) a clean worktree with exitCode 1 keeps the worktree', scenarioCleanExitOneKeepsWorktree)
test('d) without --cleanup-if-clean the worktree is always kept', scenarioNoFlagAlwaysKeepsWorktree)
test('e) a removed worktree is recorded as worktreeRemoved:true in verdict.json (#128)', scenarioRemovalRecordsWorktreeRemoved)
test('f) a kept worktree stays worktreeRemoved:false (#128)', scenarioKeptWorktreeLeavesFieldFalse)
test('g) missing verdict.json does not fail the cleanup path (#128)', scenarioMissingVerdictDoesNotFailTheRun)
test('h) empty build-verdict output exits 5 (setup error) not 0', scenarioEmptyBuildVerdictExitsFiveNotZero)
