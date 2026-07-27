import { execSync, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildVerdict, markWorktreeRemoved, runVerify } from '../verdict-writer.mjs'

const WRITER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'verdict-writer.mjs')

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

test('buildVerdict: accepts long backend names and falls back to status.backend', () => {
  // Parsers write LONG names ("codex", "deepseek", …) into status/meta —
  // regression guard for the smoke-test failure where "codex" was rejected.
  const longName = makeFixture({ backend: 'codex' })
  const viaMeta = buildVerdict({
    statusJson: longName.statusJson,
    metaJson: longName.metaJson,
    changedFilesJson: longName.changedFilesJson,
    worktreeInfo: { sessionDir: longName.sessionRoot, worktree: longName.worktree },
  })
  assert.equal(viaMeta.verdict.backend, 'cx')

  // ds meta.json historically had NO backend field at all — status.backend fallback.
  const noMeta = makeFixture({ backend: 'deepseek' })
  delete noMeta.metaJson.backend
  const viaStatus = buildVerdict({
    statusJson: noMeta.statusJson,
    metaJson: noMeta.metaJson,
    changedFilesJson: noMeta.changedFilesJson,
    worktreeInfo: { sessionDir: noMeta.sessionRoot, worktree: noMeta.worktree },
  })
  assert.equal(viaStatus.verdict.backend, 'ds')

  assert.throws(() => buildVerdict({
    statusJson: { ...noMeta.statusJson, backend: 'nonsense' },
    metaJson: { ...noMeta.metaJson, backend: 'nonsense' },
    changedFilesJson: noMeta.changedFilesJson,
    worktreeInfo: { sessionDir: noMeta.sessionRoot, worktree: noMeta.worktree },
  }), /unknown backend/)

  cleanup(longName.sessionRoot, longName.worktree, noMeta.sessionRoot, noMeta.worktree)
})

// ---- markWorktreeRemoved (issue #128) ---------------------------------------------------
//
// The field was structurally always false: buildVerdict() cannot know the answer, because the
// verdict is written before --cleanup-if-clean gets to act. These lock the after-the-fact write
// AND its fail-soft contract — a bookkeeping write must never be able to fail a finished run.

function writeVerdictFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-mark-'))
  const file = path.join(dir, 'verdict.json')
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return { dir, file }
}

test('markWorktreeRemoved: flips the field and preserves every other one', () => {
  const original = {
    schemaVersion: 1,
    sessionId: 'session-id',
    backend: 'ds',
    state: 'done',
    exitCode: 0,
    stranded: false,
    worktreeRemoved: false,
    verify: { commands: ['true'], exitCode: 0, failedAt: null, tail: 'line1\nline2' },
  }
  const { dir, file } = writeVerdictFile(original)

  assert.equal(markWorktreeRemoved(file), true)

  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(after.worktreeRemoved, true)
  // Everything else byte-identical: this writer owns ONE boolean.
  assert.deepEqual({ ...after, worktreeRemoved: false }, original)
  // Embedded newlines in the verify tail survive the round-trip.
  assert.equal(after.verify.tail, 'line1\nline2')

  cleanup(dir)
})

test('markWorktreeRemoved: idempotent, and leaves no .tmp file behind', () => {
  const { dir, file } = writeVerdictFile({ schemaVersion: 1, state: 'done', worktreeRemoved: true })

  assert.equal(markWorktreeRemoved(file), true)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).worktreeRemoved, true)
  assert.equal(markWorktreeRemoved(file), true)
  assert.deepEqual(fs.readdirSync(dir), ['verdict.json'])

  cleanup(dir)
})

test('markWorktreeRemoved: refuses the build-verdict error shape', () => {
  // cli-dispatch-run writes {schemaVersion, error, sessionId, exitCode} when build-verdict
  // throws. Adding worktreeRemoved there would dress a crash record up as a real verdict —
  // and that exitCode is a node exit status, not the 0-5 runner contract.
  const errShape = { schemaVersion: 1, error: 'build-verdict failed (exit 5) — see stderr', sessionId: 's', exitCode: 5 }
  const { dir, file } = writeVerdictFile(errShape)

  assert.equal(markWorktreeRemoved(file), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), errShape)
  assert.equal('worktreeRemoved' in JSON.parse(fs.readFileSync(file, 'utf8')), false)

  cleanup(dir)
})

test('markWorktreeRemoved: fail-soft on unreadable, unparseable and non-object input', () => {
  // Never throws: the run is already over and the worktree really is gone.
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-mark-'))
  assert.equal(markWorktreeRemoved(path.join(missing, 'nope.json')), false)
  cleanup(missing)

  const truncated = writeVerdictFile('{"schemaVersion":1,"state":"do')
  assert.equal(markWorktreeRemoved(truncated.file), false)
  cleanup(truncated.dir)

  const arrayShape = writeVerdictFile([{ state: 'done' }])
  assert.equal(markWorktreeRemoved(arrayShape.file), false)
  cleanup(arrayShape.dir)

  const nullShape = writeVerdictFile('null')
  assert.equal(markWorktreeRemoved(nullShape.file), false)
  cleanup(nullShape.dir)
})

test('markWorktreeRemoved: an error verdict that DID reach a state is still updated', () => {
  // `error` is also a legitimate status.state, so the error-shape guard must key on the
  // ABSENCE of state, not on the presence of an error field.
  const { dir, file } = writeVerdictFile({ schemaVersion: 1, state: 'error', exitCode: 2, worktreeRemoved: false })

  assert.equal(markWorktreeRemoved(file), true)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).worktreeRemoved, true)

  cleanup(dir)
})

test('mark-worktree-removed CLI: exits 0 whether or not the write lands', () => {
  const ok = writeVerdictFile({ schemaVersion: 1, state: 'done', worktreeRemoved: false })
  const good = spawnSync(process.execPath, [WRITER_PATH, 'mark-worktree-removed', ok.file], { encoding: 'utf8' })
  assert.equal(good.status, 0)
  assert.equal(JSON.parse(fs.readFileSync(ok.file, 'utf8')).worktreeRemoved, true)
  cleanup(ok.dir)

  const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-mark-'))
  const bad = spawnSync(process.execPath, [WRITER_PATH, 'mark-worktree-removed', path.join(gone, 'nope.json')], { encoding: 'utf8' })
  assert.equal(bad.status, 0, 'a failed bookkeeping write must not fail the run')
  assert.match(bad.stderr, /could not record worktreeRemoved/)
  cleanup(gone)

  // No path at all is a usage error, not a fail-soft case.
  const noArgs = spawnSync(process.execPath, [WRITER_PATH, 'mark-worktree-removed'], { encoding: 'utf8' })
  assert.equal(noArgs.status, 1)
  assert.match(noArgs.stderr, /mark-worktree-removed/)
})
