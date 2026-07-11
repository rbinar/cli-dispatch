import { execSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildVerdict, runVerify } from '../verdict-writer.mjs'

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-verdict-'))
  execSync('git init -q', { cwd: root })
  return root
}

function makeFixture({ state = 'done', backend = 'ds', changedFiles = [{ path: 'src/app.ts' }], diffstat = '' } = {}) {
  const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-session-'))
  const worktree = makeRepo()
  const statusJson = {
    sessionId: 'session-id',
    backend,
    state,
  }
  const metaJson = {
    sessionId: 'session-id',
    backend,
    cwd: worktree,
    startedAt: '2026-07-11T00:00:00.000Z',
  }
  const changedFilesJson = {
    diffstat,
    files: changedFiles,
  }

  return { sessionRoot, worktree, statusJson, metaJson, changedFilesJson }
}

function cleanup(...paths) {
  for (const p of paths) {
    if (p) fs.rmSync(p, { recursive: true, force: true })
  }
}

test('buildVerdict: exit-code mapping [0..5]', () => {
  const doneFixture = makeFixture({ state: 'done' })
  const doneResult = buildVerdict({
    statusJson: doneFixture.statusJson,
    metaJson: doneFixture.metaJson,
    changedFilesJson: doneFixture.changedFilesJson,
    worktreeInfo: { sessionDir: doneFixture.sessionRoot, worktree: doneFixture.worktree },
  })
  assert.equal(doneResult.exitCode, 0)

  const doneFailedVerify = buildVerdict({
    statusJson: doneFixture.statusJson,
    metaJson: doneFixture.metaJson,
    changedFilesJson: doneFixture.changedFilesJson,
    verifyResults: { commands: ['npm test'], exitCode: 2, failedAt: 0, tail: 'tail' },
    worktreeInfo: { sessionDir: doneFixture.sessionRoot, worktree: doneFixture.worktree },
  })
  assert.equal(doneFailedVerify.exitCode, 1)

  const errorResult = buildVerdict({
    statusJson: { ...doneFixture.statusJson, state: 'error' },
    metaJson: { ...doneFixture.metaJson, state: 'error' },
    changedFilesJson: doneFixture.changedFilesJson,
    worktreeInfo: { sessionDir: doneFixture.sessionRoot, worktree: doneFixture.worktree },
  })
  assert.equal(errorResult.exitCode, 2)

  const timeoutResult = buildVerdict({
    statusJson: doneFixture.statusJson,
    metaJson: doneFixture.metaJson,
    changedFilesJson: doneFixture.changedFilesJson,
    worktreeInfo: { sessionDir: doneFixture.sessionRoot, worktree: doneFixture.worktree, timeoutExpired: true },
  })
  assert.equal(timeoutResult.exitCode, 3)

  const humanResult = buildVerdict({
    statusJson: { ...doneFixture.statusJson, state: 'human-controlled' },
    metaJson: { ...doneFixture.metaJson, state: 'human-controlled' },
    changedFilesJson: doneFixture.changedFilesJson,
    worktreeInfo: { sessionDir: doneFixture.sessionRoot, worktree: doneFixture.worktree },
  })
  assert.equal(humanResult.exitCode, 4)

  const badBackend = makeFixture({ state: 'done', backend: 'invalid' })
  assert.throws(() =>
    buildVerdict({
      statusJson: badBackend.statusJson,
      metaJson: badBackend.metaJson,
      changedFilesJson: badBackend.changedFilesJson,
      worktreeInfo: { sessionDir: badBackend.sessionRoot, worktree: badBackend.worktree },
    }),
    /unknown backend/,
  )

  cleanup(doneFixture.sessionRoot, doneFixture.worktree, badBackend.sessionRoot, badBackend.worktree)
})

test('buildVerdict: verify null vs pass/fail', () => {
  const fixture = makeFixture({ state: 'done' })
  const nullVerify = buildVerdict({
    statusJson: fixture.statusJson,
    metaJson: fixture.metaJson,
    changedFilesJson: fixture.changedFilesJson,
    worktreeInfo: { sessionDir: fixture.sessionRoot, worktree: fixture.worktree },
  })
  assert.equal(nullVerify.verdict.verify, null)

  const passVerify = buildVerdict({
    statusJson: fixture.statusJson,
    metaJson: fixture.metaJson,
    changedFilesJson: fixture.changedFilesJson,
    verifyResults: { commands: ['npm run -s test'], exitCode: 0, failedAt: null, tail: 'ok' },
    worktreeInfo: { sessionDir: fixture.sessionRoot, worktree: fixture.worktree },
  })
  assert.equal(passVerify.exitCode, 0)
  assert.equal(passVerify.verdict.verify.exitCode, 0)

  const failVerify = buildVerdict({
    statusJson: fixture.statusJson,
    metaJson: fixture.metaJson,
    changedFilesJson: fixture.changedFilesJson,
    verifyResults: { commands: ['npm run -s test'], exitCode: 3, failedAt: 0, tail: 'err' },
    worktreeInfo: { sessionDir: fixture.sessionRoot, worktree: fixture.worktree },
  })
  assert.equal(failVerify.exitCode, 1)
  assert.equal(failVerify.verdict.verify.exitCode, 3)

  cleanup(fixture.sessionRoot, fixture.worktree)
})

test('buildVerdict: diffPatchPath and changedFiles are populated', () => {
  const fixture = makeFixture({
    changedFiles: [{ path: 'src/app.ts' }, { path: 'src/index.ts' }],
    diffstat: '2 files changed',
  })

  const result = buildVerdict({
    statusJson: fixture.statusJson,
    metaJson: fixture.metaJson,
    changedFilesJson: fixture.changedFilesJson,
    worktreeInfo: { sessionDir: fixture.sessionRoot, worktree: fixture.worktree },
  })

  assert.equal(typeof result.verdict.diffPatchPath, 'string')
  assert.ok(result.verdict.diffPatchPath.endsWith(path.join('', 'verdict-diff.patch')))
  assert.deepEqual(result.verdict.changedFiles, ['src/app.ts', 'src/index.ts'])

  cleanup(fixture.sessionRoot, fixture.worktree)
})

test('buildVerdict: stranded tracks git status truthiness', () => {
  const cleanRepo = makeRepo()
  const cleanFixture = makeFixture({ state: 'done' })
  cleanFixture.metaJson.cwd = cleanRepo

  const clean = buildVerdict({
    statusJson: cleanFixture.statusJson,
    metaJson: cleanFixture.metaJson,
    changedFilesJson: cleanFixture.changedFilesJson,
    worktreeInfo: { sessionDir: cleanFixture.sessionRoot, worktree: cleanRepo },
  })
  assert.equal(clean.verdict.stranded, false)

  const dirtyRepo = makeRepo()
  fs.writeFileSync(path.join(dirtyRepo, 'dirty.txt'), 'dirty')
  const dirtyFixture = makeFixture({ state: 'done' })
  dirtyFixture.metaJson.cwd = dirtyRepo
  const dirty = buildVerdict({
    statusJson: dirtyFixture.statusJson,
    metaJson: dirtyFixture.metaJson,
    changedFilesJson: dirtyFixture.changedFilesJson,
    worktreeInfo: { sessionDir: dirtyFixture.sessionRoot, worktree: dirtyRepo },
  })
  assert.equal(dirty.verdict.stranded, true)

  cleanup(cleanRepo, dirtyRepo, cleanFixture.sessionRoot, dirtyFixture.sessionRoot)
})

test('runVerify: stops at first failure and captures tail', () => {
  const cwd = makeRepo()

  const pass = runVerify(['echo ok', 'printf "hi"'], { cwd, timeoutMs: 1000, tailLines: 1 })
  assert.equal(pass.exitCode, 0)
  assert.equal(pass.failedAt, null)
  assert.equal(pass.commands.length, 2)
  assert.equal(pass.tail, 'hi')

  const fail = runVerify(['echo ok', 'echo fail && exit 7', 'echo never'], { cwd, timeoutMs: 1000, tailLines: 10 })
  assert.equal(fail.exitCode, 7)
  assert.equal(fail.failedAt, 1)
  assert.equal(fail.commands[2], 'echo never')
  assert.ok(fail.tail.includes('fail'))

  cleanup(cwd)
})
