import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pruneSessionRoot, resolveMaxSessions, DEFAULT_MAX_SESSIONS } from '../parse-utils.mjs'

// Passive cap on finished session dirs, applied by every parser at session-dir creation
// time. The dangerous failure mode is not "kept too much" — it is deleting a session that
// is still alive, or dropping the only record of a deterministic run. Most of these tests
// exist to pin those two guarantees down.

let seq = 0
const mkRoot = () => mkdtempSync(path.join(os.tmpdir(), 'cd-prune-'))

// startedAt drives the ordering; a bigger `age` means older.
function mkSession(root, name, { state = 'done', age = 0, verdict = false, patch = false, meta = true } = {}) {
  const dir = path.join(root, name)
  mkdirSync(dir, { recursive: true })
  const startedAt = new Date(Date.UTC(2026, 0, 1) - age * 3600_000).toISOString()
  if (state !== null) writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ state, backend: 'codex' }))
  if (meta) writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ startedAt, backend: 'codex' }))
  if (verdict) writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ sessionId: name, exitCode: 0 }))
  if (patch) writeFileSync(path.join(dir, 'verdict-diff.patch'), 'diff --git a/x b/x\n')
  return dir
}

const withRoot = (fn) => {
  const root = mkRoot()
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('resolveMaxSessions: default, override, and the disable values', () => {
  assert.equal(resolveMaxSessions({}), DEFAULT_MAX_SESSIONS)
  assert.equal(resolveMaxSessions({ CLI_DISPATCH_MAX_SESSIONS: '' }), DEFAULT_MAX_SESSIONS)
  assert.equal(resolveMaxSessions({ CLI_DISPATCH_MAX_SESSIONS: '5' }), 5)
  assert.equal(resolveMaxSessions({ CLI_DISPATCH_MAX_SESSIONS: '2.7' }), 2)
  // 0 / negative / garbage all mean "off" rather than "prune everything" — a misconfigured
  // value must never be read as an instruction to delete the whole session root.
  assert.equal(resolveMaxSessions({ CLI_DISPATCH_MAX_SESSIONS: '0' }), 0)
  assert.equal(resolveMaxSessions({ CLI_DISPATCH_MAX_SESSIONS: '-3' }), 0)
  assert.equal(resolveMaxSessions({ CLI_DISPATCH_MAX_SESSIONS: 'lots' }), 0)
})

test('prunes only the surplus, newest kept', () => withRoot((root) => {
  for (let i = 0; i < 5; i++) mkSession(root, `s${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 2 })
  assert.deepEqual(r.removed.sort(), ['s2', 's3', 's4'])
  assert.ok(existsSync(path.join(root, 's0')))
  assert.ok(existsSync(path.join(root, 's1')))
}))

test('max 0 disables pruning entirely', () => withRoot((root) => {
  for (let i = 0; i < 5; i++) mkSession(root, `s${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 0 })
  assert.equal(r.skipped, 'disabled')
  assert.equal(r.removed.length, 0)
  assert.equal(readdirSync(root).length, 5)
}))

for (const state of ['running', 'human-controlled']) {
  test(`a ${state} session is never removed, however old`, () => withRoot((root) => {
    // The live one is the OLDEST, so a naive newest-first cap would delete it first.
    mkSession(root, 'live', { state, age: 999 })
    for (let i = 0; i < 4; i++) mkSession(root, `done${i}`, { age: i })
    const r = pruneSessionRoot(root, { max: 1 })
    assert.ok(existsSync(path.join(root, 'live')), `${state} session was deleted`)
    assert.ok(!r.removed.includes('live'))
    assert.deepEqual(r.removed.sort(), ['done1', 'done2', 'done3'])
  }))
}

test('a session with no state at all is left for cli-dispatch-clean', () => withRoot((root) => {
  // A parser that died before its first status write looks exactly like one that never
  // started. Only clean has the idle-time evidence to judge it, so the cap must not.
  mkSession(root, 'stateless', { state: null, age: 999 })
  for (let i = 0; i < 3; i++) mkSession(root, `done${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 1 })
  assert.ok(existsSync(path.join(root, 'stateless')))
  assert.ok(!r.removed.includes('stateless'))
}))

test('the caller\'s own session dir is never its own prune target', () => withRoot((root) => {
  const mine = mkSession(root, 'mine', { state: 'running', age: 500 })
  for (let i = 0; i < 3; i++) mkSession(root, `done${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 1, keepDir: mine })
  assert.ok(existsSync(mine))
  assert.ok(!r.removed.includes('mine'))
}))

test('verdicts are archived before the dir is removed', () => withRoot((root) => {
  mkSession(root, 'newest', { age: 0 })
  mkSession(root, 'withVerdict', { age: 5, verdict: true, patch: true })
  const r = pruneSessionRoot(root, { max: 1 })
  assert.deepEqual(r.removed, ['withVerdict'])
  assert.equal(r.archived, 1)
  const archive = path.join(root, 'verdict-archive')
  assert.ok(existsSync(path.join(archive, 'withVerdict.json')), 'verdict.json not archived')
  assert.ok(existsSync(path.join(archive, 'withVerdict.patch')), 'verdict-diff.patch not archived')
  assert.match(readFileSync(path.join(archive, 'withVerdict.json'), 'utf8'), /"exitCode":0/)
}))

test('the verdict-archive dir is not itself a prune candidate', () => withRoot((root) => {
  mkdirSync(path.join(root, 'verdict-archive'), { recursive: true })
  writeFileSync(path.join(root, 'verdict-archive', 'old.json'), '{}')
  for (let i = 0; i < 3; i++) mkSession(root, `s${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 1 })
  assert.ok(!r.removed.includes('verdict-archive'))
  assert.ok(existsSync(path.join(root, 'verdict-archive', 'old.json')))
}))

test('dotfiles (e.g. the transition sentinel) are skipped', () => withRoot((root) => {
  writeFileSync(path.join(root, '.cli-dispatch-transitions'), 'x')
  for (let i = 0; i < 3; i++) mkSession(root, `s${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 1 })
  assert.ok(existsSync(path.join(root, '.cli-dispatch-transitions')))
  assert.ok(!r.removed.some((n) => n.startsWith('.')))
}))

test('sessions with no meta.json fall back to dir mtime instead of being skipped', () => withRoot((root) => {
  for (let i = 0; i < 3; i++) mkSession(root, `s${i}`, { age: i, meta: false })
  const r = pruneSessionRoot(root, { max: 1 })
  assert.equal(r.removed.length, 2, 'undated sessions must still be prunable')
}))

test('an unreadable root is reported, not thrown', () => {
  const r = pruneSessionRoot(path.join(os.tmpdir(), 'cd-prune-does-not-exist-' + (seq++)), { max: 3 })
  assert.equal(r.skipped, 'unreadable-root')
  assert.equal(r.removed.length, 0)
})

test('a root already under the cap is left completely alone', () => withRoot((root) => {
  for (let i = 0; i < 3; i++) mkSession(root, `s${i}`, { age: i })
  const r = pruneSessionRoot(root, { max: 10 })
  assert.equal(r.removed.length, 0)
  assert.equal(r.kept, 3)
  assert.equal(readdirSync(root).length, 3)
}))

test('every parser prunes at session-dir creation and swallows failures', () => {
  // The cap is only enforced if each backend actually calls it — and it must never be able
  // to break the run that triggered it.
  const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  for (const f of [
    'ds-stream-parse.mjs', 'cx-stream-parse.mjs', 'cp-stream-parse.mjs',
    'oc-stream-parse.mjs', 'ag-transcript-parse.mjs',
  ]) {
    const src = readFileSync(path.join(scriptsDir, f), 'utf8')
    assert.match(src, /pruneSessionRoot/, `${f} does not prune`)
    assert.match(
      src,
      /try \{ pruneSessionRoot\(path\.dirname\(dir\), \{ keepDir: dir \}\) \} catch/,
      `${f} must prune the session ROOT, keep its own dir, and swallow failures`,
    )
    // Ordering matters: pruning before the dir exists would make it a candidate.
    assert.ok(
      src.indexOf('mkdirSync(dir') < src.indexOf('pruneSessionRoot('),
      `${f} prunes before creating its own session dir`,
    )
  }
})
