import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeWorkerReport, readWorkerReport, WORKER_REPORT_FILE, crossCheckClaims, attachCrossCheck } from '../verdict-writer.mjs'

// worker-report.json is the worker's own account of what it checked. It is a SELF-REPORT:
// these tests pin down that it is normalized, bounded, and — above all — that an unchecked
// claim stays visibly unchecked. The whole value of the record collapses if an assertion
// with no command behind it reads the same as one with evidence.

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const withDir = (fn) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cd-report-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
// Async twin: the sync helper's `finally` fires the moment the callback returns its promise,
// deleting the dir out from under the still-running test.
const withDirAsync = async (fn) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cd-report-'))
  try { return await fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
const writeReport = (dir, body) =>
  writeFileSync(path.join(dir, WORKER_REPORT_FILE), typeof body === 'string' ? body : JSON.stringify(body))

test('a full report is normalized field by field', () => {
  const r = normalizeWorkerReport({
    claims: [{ claim: 'tests pass', howVerified: 'ran the suite', command: 'node --test x', result: '479 pass' }],
    notDone: ['skipped the ps1 twin'],
    assumptions: ['assumed origin/main is the base'],
  })
  assert.equal(r.valid, true)
  assert.deepEqual(r.claims, [
    { claim: 'tests pass', howVerified: 'ran the suite', command: 'node --test x', result: '479 pass' },
  ])
  assert.deepEqual(r.notDone, ['skipped the ps1 twin'])
  assert.deepEqual(r.assumptions, ['assumed origin/main is the base'])
  assert.equal(r.unevidencedClaims, 0)
})

test('a claim with no command is counted as unevidenced, not dropped', () => {
  // Dropping it would hide the assertion; treating it as evidence would be worse. It stays,
  // and it stays countable.
  const r = normalizeWorkerReport({
    claims: [
      { claim: 'output is unchanged', command: 'diff a b', result: 'no differences' },
      { claim: 'nothing else regressed' },
    ],
  })
  assert.equal(r.claims.length, 2)
  assert.equal(r.unevidencedClaims, 1)
})

test('a claim with no claim text is dropped', () => {
  const r = normalizeWorkerReport({ claims: [{ command: 'ls' }, { claim: 'real' }] })
  assert.deepEqual(r.claims.map((c) => c.claim), ['real'])
})

test('non-object and non-string members are rejected without throwing', () => {
  const r = normalizeWorkerReport({
    claims: ['a string', null, 42, { claim: 'kept' }],
    notDone: [null, 7, 'kept too', { a: 1 }],
    assumptions: 'not an array',
  })
  assert.deepEqual(r.claims.map((c) => c.claim), ['kept'])
  assert.deepEqual(r.notDone, ['kept too'])
  assert.deepEqual(r.assumptions, [])
})

test('oversized reports are bounded in both directions', () => {
  const r = normalizeWorkerReport({
    claims: Array.from({ length: 200 }, (_, i) => ({ claim: `c${i}`, command: 'x' })),
    notDone: Array.from({ length: 200 }, (_, i) => `n${i}`),
  })
  assert.equal(r.claims.length, 50)
  assert.equal(r.notDone.length, 50)
  const long = normalizeWorkerReport({ claims: [{ claim: 'x'.repeat(9000) }] })
  assert.equal(long.claims[0].claim.length, 2000)
})

test('an unusable report is recorded as invalid, never silently dropped', () => {
  // "The worker wrote garbage" and "the worker claimed nothing" must not look identical to
  // the orchestrator.
  assert.deepEqual(normalizeWorkerReport(['a', 'b']).reason, 'not-an-object')
  assert.deepEqual(normalizeWorkerReport('nope').reason, 'not-an-object')
  assert.equal(normalizeWorkerReport({}).valid, false)
  assert.equal(normalizeWorkerReport({}).reason, 'empty')
  assert.equal(normalizeWorkerReport({ claims: [] }).reason, 'empty')
})

test('a missing report is null, distinct from an invalid one', () => withDir((dir) => {
  assert.equal(readWorkerReport(dir), null)
  writeReport(dir, '{ not json')
  const r = readWorkerReport(dir)
  assert.equal(r.valid, false)
  assert.equal(r.reason, 'invalid-json')
}))

test('readWorkerReport reads and normalizes from disk', () => withDir((dir) => {
  writeReport(dir, { claims: [{ claim: 'ran it', command: 'true', result: 'ok' }], notDone: [], assumptions: [] })
  const r = readWorkerReport(dir)
  assert.equal(r.valid, true)
  assert.equal(r.claims[0].claim, 'ran it')
  assert.equal(r.unevidencedClaims, 0)
}))

test('buildVerdict carries workerReport, and null when there is none', () => withDirAsync(async (dir) => {
  const { buildVerdict } = await import('../verdict-writer.mjs')
  const base = {
    statusJson: { state: 'done', sessionId: 's1', backend: 'codex' },
    metaJson: { backend: 'codex', cwd: dir, startedAt: new Date(0).toISOString() },
    changedFilesJson: { files: [], diffstat: '' },
    verifyResults: { commands: ['true'], exitCode: 0, failedAt: null, tail: '' },
    worktreeInfo: { sessionDir: dir, worktree: dir },
  }
  assert.equal(buildVerdict(base).verdict.workerReport, null)
  writeReport(dir, { claims: [{ claim: 'checked', command: 'true', result: 'ok' }] })
  const withReport = buildVerdict(base).verdict.workerReport
  assert.equal(withReport.valid, true)
  assert.equal(withReport.claims[0].claim, 'checked')
}))

test('both runner twins append the evidence-record instruction behind the same opt-out', () => {
  // Parity is a behaviour rule here, not just file existence — a drifted .ps1 would silently
  // stop asking Windows workers for evidence.
  for (const f of ['cli-dispatch-run', 'cli-dispatch-run.ps1']) {
    const src = readFileSync(path.join(scriptsDir, f), 'utf8')
    assert.match(src, /CLI_DISPATCH_NO_WORKER_REPORT/, `${f} has no opt-out`)
    assert.match(src, /worker-report\.json/, `${f} does not ask for the record`)
    assert.match(src, /"claims":/, `${f} does not show the schema`)
    assert.match(src, /record, not a gate/, `${f} must state that the record is not trusted`)
  }
})

// ---- cross-check against the measured diff (issue #148, case 2) ----
//
// A worker wrote and ran a test inside its worktree, reported "added page.test.tsx — 594
// passed", and never committed the file. The claim described a state no consumer could see.
// The claim text and the changed-file list come from different places — the worker vs
// `git status --short` — so a disagreement is worth surfacing on its own.

test('a claimed file absent from the measured diff is flagged', () => {
  const out = crossCheckClaims(
    [{ claim: 'added app/x/page.test.tsx with two scenarios', command: 'npx vitest run', result: '594 passed' }],
    ['CHANGELOG.md', 'app/fiyat-kurallari/page.tsx'],
  )
  assert.deepEqual(out, ['app/x/page.test.tsx'])
})

test('a bare basename matches a measured path by suffix', () => {
  // The worker says "page.test.tsx", the measured list carries the full path. That is a hit.
  assert.deepEqual(
    crossCheckClaims([{ claim: 'added page.test.tsx' }], ['app/x/page.test.tsx']),
    [],
  )
})

test('nothing is flagged when every named file was measured', () => {
  assert.deepEqual(
    crossCheckClaims(
      [{ claim: 'edited gain-report.mjs and CHANGELOG.md' }],
      ['plugins/cli-dispatch/scripts/gain-report.mjs', 'CHANGELOG.md'],
    ),
    [],
  )
})

test('prose without a file-looking token flags nothing', () => {
  assert.deepEqual(crossCheckClaims([{ claim: 'the suite passes and behaviour is unchanged' }], []), [])
})

test('empty or malformed inputs never throw', () => {
  assert.deepEqual(crossCheckClaims([], ['a.js']), [])
  assert.deepEqual(crossCheckClaims(null, null), [])
  assert.deepEqual(crossCheckClaims([{ claim: 'x.js' }], null), ['x.js'])
})

test('attachCrossCheck leaves a null or invalid report untouched', () => {
  assert.equal(attachCrossCheck(null, ['a.js']), null)
  const invalid = { valid: false, reason: 'empty', claims: [] }
  assert.deepEqual(attachCrossCheck(invalid, ['a.js']), invalid)
})

test('buildVerdict surfaces claimedButMissing from the measured file list', () => withDirAsync(async (dir) => {
  const { buildVerdict } = await import('../verdict-writer.mjs')
  writeReport(dir, { claims: [{ claim: 'added page.test.tsx', command: 'vitest', result: '594 passed' }] })
  const { verdict } = buildVerdict({
    statusJson: { state: 'done', sessionId: 's1', backend: 'codex' },
    metaJson: { backend: 'codex', cwd: dir, startedAt: new Date(0).toISOString() },
    changedFilesJson: { files: [{ path: 'app/page.tsx', status: 'M' }], diffstat: '' },
    verifyResults: { commands: ['true'], exitCode: 0, failedAt: null, tail: '' },
    worktreeInfo: { sessionDir: dir, worktree: dir },
  })
  assert.deepEqual(verdict.workerReport.claimedButMissing, ['page.test.tsx'])
}))
