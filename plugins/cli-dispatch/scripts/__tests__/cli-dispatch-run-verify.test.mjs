// cli-dispatch-run-verify.test.mjs — end-to-end coverage for cli-dispatch-run's
// --verify → verdict.json wiring. verdict.json is the escalation path's ONLY data source
// (the orchestrator reads it instead of babysitting the worker), so the bash-level wiring
// between run-verify and build-verdict has to be pinned, not just the engine that
// verdict-writer.test.mjs already covers.
//
// Test seam: `--resume <id>` re-attaches to an existing session (wait → verify → verdict)
// and never launches a worker, so a seeded session dir is enough to drive the real path.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/cli-dispatch-run-verify.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const RUNNER_PATH = path.join(SELF_DIR, '..', 'cli-dispatch-run')
const WRITER_PATH = path.join(SELF_DIR, '..', 'verdict-writer.mjs')

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

function mkGitRepo() {
  const repo = mkdtemp('cd-verify-repo-')
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'cd-verify-test',
    GIT_AUTHOR_EMAIL: 'cd-verify-test@example.com',
    GIT_COMMITTER_NAME: 'cd-verify-test',
    GIT_COMMITTER_EMAIL: 'cd-verify-test@example.com',
  }
  execSync('git init -q', { cwd: repo, env })
  fs.writeFileSync(path.join(repo, 'note.txt'), 'seed\n')
  execSync('git add note.txt && git commit -q -m seed', { cwd: repo, env })
  return repo
}

// Seed a terminal-state session so --resume goes straight to verify → verdict.
function seedSession(worktree, { diffstat = '' } = {}) {
  const sessionsRoot = mkdtemp('cd-verify-sessions-')
  const sessionId = 'ds-test-session'
  const dir = path.join(sessionsRoot, sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ state: 'done', sessionId }))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'ds', cwd: worktree, model: 'test-model' }))
  fs.writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({ files: [], diffstat }))
  return { sessionsRoot, sessionId, dir }
}

function runResumeWithVerify({ worktree, sessionsRoot, sessionId, verify, extraEnv = {} }) {
  const args = ['--backend', 'ds', '--cwd', worktree, '--resume', sessionId]
  for (const v of verify) args.push('--verify', v)
  const result = spawnSync('bash', [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessionsRoot, ...extraEnv },
  })
  if (result.error) throw result.error
  return result
}

function readVerdict(sessionDir) {
  const p = path.join(sessionDir, 'verdict.json')
  assert.equal(fs.existsSync(p), true, 'verdict.json must be written')
  const raw = fs.readFileSync(p, 'utf8')
  // Downstream consumers JSON.parse this file — an unparseable verdict is a hard failure.
  return JSON.parse(raw)
}

test('1. passing --verify → verdict.json records verify.exitCode 0', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId, dir } = seedSession(repo)
  try {
    const res = runResumeWithVerify({ worktree: repo, sessionsRoot, sessionId, verify: ['true'] })
    const verdict = readVerdict(dir)
    assert.equal(verdict.schemaVersion, 1)
    assert.equal(verdict.state, 'done')
    assert.ok(verdict.verify, 'verify block must be present when --verify was passed')
    assert.equal(verdict.verify.exitCode, 0, `expected verify pass; verdict: ${JSON.stringify(verdict.verify)}`)
    assert.equal(res.status, 0, `runner should exit 0 on a passing verify; output: ${res.stdout}${res.stderr}`)
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})

test('2. failing --verify → verdict.json records a non-zero verify exit and the runner does not exit 0', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId, dir } = seedSession(repo)
  try {
    const res = runResumeWithVerify({ worktree: repo, sessionsRoot, sessionId, verify: ['exit 7'] })
    const verdict = readVerdict(dir)
    assert.ok(verdict.verify, 'verify block must be present')
    assert.notEqual(verdict.verify.exitCode, 0, 'a failing verify must not be recorded as exitCode 0')
    assert.notEqual(res.status, 0, 'runner must not report success when verify failed')
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})

test('3. multiple --verify commands: the first failure is what the verdict reports', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId, dir } = seedSession(repo)
  try {
    runResumeWithVerify({ worktree: repo, sessionsRoot, sessionId, verify: ['true', 'exit 3', 'true'] })
    const verdict = readVerdict(dir)
    assert.notEqual(verdict.verify.exitCode, 0, 'a failure anywhere in the chain must fail the verdict')
    assert.ok(verdict.verify.failedAt, 'failedAt must name the failing command')
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})

// The regression this locks in: build-verdict's readJson() swallows parse errors and
// returns {}, which buildVerdict maps to `exitCode: 0`. So if run-verify crashes and
// leaves an empty results file, a naive "just don't abort" fix would report a PASS for a
// verify that never ran. The runner must synthesize an explicit failure instead.
test('4. run-verify crash → verdict still written AND fails closed (never a silent pass)', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId, dir } = seedSession(repo)
  const stubDir = mkdtemp('cd-verify-stub-')
  const stub = path.join(stubDir, 'verdict-writer-stub.mjs')
  // run-verify: crash silently (exit 5, no stdout) — the failure mode being guarded.
  // build-verdict: echo back the verify-results file it was handed, so the test can assert
  // what the runner actually passed downstream.
  fs.writeFileSync(stub, `
import { readFileSync } from 'node:fs'
const sub = process.argv[2]
if (sub === 'run-verify') process.exit(5)
if (sub === 'build-verdict') {
  const verifyPath = process.argv[8]
  let handed = null
  try { handed = JSON.parse(readFileSync(verifyPath, 'utf8')) } catch { handed = 'UNPARSEABLE' }
  process.stdout.write(JSON.stringify({ schemaVersion: 1, handedToBuildVerdict: handed }) + '\\n')
  process.exit(0)
}
process.exit(1)
`)
  try {
    runResumeWithVerify({
      worktree: repo, sessionsRoot, sessionId, verify: ['true'],
      extraEnv: { CLI_DISPATCH_VERDICT_WRITER: stub },
    })
    const verdict = readVerdict(dir)
    const handed = verdict.handedToBuildVerdict
    assert.notEqual(handed, 'UNPARSEABLE', 'runner must not hand an empty/unparseable verify file downstream')
    assert.notEqual(handed, null, 'runner must hand a verify-results payload downstream')
    assert.notEqual(handed.exitCode, 0, 'a crashed run-verify must NOT be reported as a passing verify')
    assert.match(handed.tail || '', /run-verify crashed/, 'the synthesized failure must say why the verify result is unknown')
  } finally {
    rmrf(stubDir); rmrf(sessionsRoot); rmrf(repo)
  }
})

test('5. no --verify → verdict.json is still written, with no verify block', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId, dir } = seedSession(repo)
  try {
    runResumeWithVerify({ worktree: repo, sessionsRoot, sessionId, verify: [] })
    const verdict = readVerdict(dir)
    assert.equal(verdict.schemaVersion, 1)
    assert.equal(verdict.verify ?? null, null, 'verify must be null when no --verify was passed')
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})

// --resume is exempt from the prompt requirement. The PowerShell twin regressed exactly
// here (no $Resume exemption → the resume path was unreachable), so pin the bash contract.
test('6. --resume without a prompt is accepted (prompt requirement is resume-exempt)', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId } = seedSession(repo)
  try {
    const res = runResumeWithVerify({ worktree: repo, sessionsRoot, sessionId, verify: ['true'] })
    const out = `${res.stdout || ''}${res.stderr || ''}`
    assert.doesNotMatch(out, /--prompt or --prompt-file is required/, '--resume must not demand a prompt')
    assert.notEqual(res.status, 5, 'resume must not exit 5 (usage error)')
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})

test('7. a trivial verdict prints one advisory before the worktree note without changing exit code', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId, dir } = seedSession(repo, {
    diffstat: ' 2 files changed, 10 insertions(+), 3 deletions(-)',
  })
  try {
    const res = runResumeWithVerify({
      worktree: repo,
      sessionsRoot,
      sessionId,
      verify: ['true'],
      extraEnv: { CLI_DISPATCH_VERDICT_WRITER: WRITER_PATH },
    })
    const verdict = readVerdict(dir)
    const advisory = 'cli-dispatch-run: trivial diff (<50 lines) — consider doing work this size inline or batching it'
    const output = `${res.stdout || ''}${res.stderr || ''}`
    assert.equal(verdict.trivial, true)
    assert.equal(res.status, 0)
    assert.equal(output.split(advisory).length - 1, 1, 'the advisory must print exactly once')
    assert.ok(output.indexOf(advisory) < output.indexOf('cli-dispatch-run: --cleanup-if-clean not set; kept worktree'))
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})

test('8. a non-trivial verdict prints no advisory', () => {
  const repo = mkGitRepo()
  const { sessionsRoot, sessionId } = seedSession(repo, {
    diffstat: ' 9 files changed, 60 insertions(+), 4 deletions(-)',
  })
  try {
    const res = runResumeWithVerify({
      worktree: repo,
      sessionsRoot,
      sessionId,
      verify: ['true'],
      extraEnv: { CLI_DISPATCH_VERDICT_WRITER: WRITER_PATH },
    })
    assert.doesNotMatch(`${res.stdout || ''}${res.stderr || ''}`, /cli-dispatch-run: trivial diff/)
  } finally {
    rmrf(sessionsRoot); rmrf(repo)
  }
})
