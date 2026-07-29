import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const enginePath = fileURLToPath(new URL('../cli-dispatch-clean.mjs', import.meta.url))
const samplePatch = '--- a/file.txt\n+++ b/file.txt\n@@\n-1\n+2\n'

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-clean-'))
}

function makeStaleSession(root, { id, backend = 'cx', withPatch = false, withVerdictJson = false }) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  const statusPath = path.join(dir, 'status.json')
  const metaPath = path.join(dir, 'meta.json')
  fs.writeFileSync(statusPath, JSON.stringify({ state: 'running', backend }))
  fs.writeFileSync(metaPath, JSON.stringify({ backend, startedAt: '2026-01-01T00:00:00.000Z' }))

  const oldTime = new Date(Date.now() - 2000 * 1000)
  fs.utimesSync(statusPath, oldTime, oldTime)

  if (withPatch) fs.writeFileSync(path.join(dir, 'verdict-diff.patch'), samplePatch)
  if (withVerdictJson) fs.writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ sessionId: id, state: 'done' }))

  return dir
}

function runClean(root, args) {
  return execFileSync(process.execPath, [enginePath, ...args], {
    env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: root },
    encoding: 'utf8',
  })
}

function cleanup(...paths) {
  for (const p of paths) {
    if (p) fs.rmSync(p, { recursive: true, force: true })
  }
}

test('dry-run marks stale candidate with verdict patch and prints preserve hint', () => {
  const root = tmpRoot()
  const id = 'stale-with-patch'
  makeStaleSession(root, { id, withPatch: true, withVerdictJson: true })

  const out = runClean(root, ['--stale-secs', '1'])

  assert.ok(out.includes('⚠ has verdict patch'))
  assert.ok(out.includes('note: 1 candidate(s) carry a verdict-diff.patch'))
  assert.ok(out.includes('they will be archived on removal; pass --no-preserve-verdicts to skip archiving'))
  cleanup(root)
})

test('dry-run does not mark stale candidate without verdict patch', () => {
  const root = tmpRoot()
  const id = 'stale-without-patch'
  makeStaleSession(root, { id, withPatch: false })

  const out = runClean(root, ['--stale-secs', '1'])

  assert.ok(!out.includes('⚠ has verdict patch'))
  assert.ok(!out.includes('note:'))
  cleanup(root)
})

test('remove archives verdict files by default and deletes session', () => {
  const root = tmpRoot()
  const id = 'stale-default-archive'
  const patch = samplePatch
  const verdict = JSON.stringify({ sessionId: id, state: 'done' })
  const dir = makeStaleSession(root, { id, withPatch: true, withVerdictJson: true })
  const out = runClean(root, ['--remove', '--stale-secs', '1'])

  assert.equal(out.includes('archived verdicts for 1 session(s).'), true)
  assert.equal(fs.existsSync(dir), false)
  const archivedPatch = path.join(root, 'verdict-archive', `${id}.patch`)
  const archivedJson = path.join(root, 'verdict-archive', `${id}.json`)
  assert.equal(fs.readFileSync(archivedPatch, 'utf8'), patch)
  assert.equal(fs.readFileSync(archivedJson, 'utf8'), verdict)
  cleanup(root)
})

test('remove + no-preserve-verdicts deletes session without creating archive', () => {
  const root = tmpRoot()
  const id = 'stale-no-preserve'
  const dir = makeStaleSession(root, { id, withPatch: true, withVerdictJson: true })
  const out = runClean(root, ['--remove', '--no-preserve-verdicts', '--stale-secs', '1'])

  const archiveDir = path.join(root, 'verdict-archive')
  assert.equal(fs.existsSync(dir), false)
  assert.equal(fs.existsSync(archiveDir), false)
  assert.ok(out.includes('verdict archiving disabled.'))
  assert.equal(out.includes('archived verdicts for 0 session(s).'), false)
  cleanup(root)
})

test('remove + preserve-verdicts still archives verdict files and deletes session', () => {
  const root = tmpRoot()
  const id = 'stale-with-archive'
  const patch = samplePatch
  const verdict = JSON.stringify({ sessionId: id, state: 'done' })
  const dir = makeStaleSession(root, { id, withPatch: true, withVerdictJson: true })
  const out = runClean(root, ['--remove', '--preserve-verdicts', '--stale-secs', '1'])

  assert.equal(out.includes('archived verdicts for 1 session(s).'), true)
  assert.equal(fs.existsSync(dir), false)
  const archivedPatch = path.join(root, 'verdict-archive', `${id}.patch`)
  const archivedJson = path.join(root, 'verdict-archive', `${id}.json`)
  assert.equal(fs.readFileSync(archivedPatch, 'utf8'), patch)
  assert.equal(fs.readFileSync(archivedJson, 'utf8'), verdict)
  cleanup(root)
})

test('dry-run with no-preserve-verdicts reports archiving disabled instead of preserve hint', () => {
  const root = tmpRoot()
  const id = 'stale-no-preserve-dry-run'
  makeStaleSession(root, { id, withPatch: true, withVerdictJson: true })

  const out = runClean(root, ['--no-preserve-verdicts', '--stale-secs', '1'])

  assert.ok(out.includes('verdict archiving is disabled by --no-preserve-verdicts'))
  assert.equal(out.includes('they will be archived on removal'), false)
  cleanup(root)
})

test('verdict-archive dir is skipped by clean scan', () => {
  const root = tmpRoot()
  const archiveDir = path.join(root, 'verdict-archive')
  const sessionId = 'stale-session'
  const sessionDir = makeStaleSession(root, { id: sessionId, withPatch: true })
  fs.mkdirSync(archiveDir, { recursive: true })
  fs.writeFileSync(path.join(archiveDir, 'leftover'), 'keep-me')

  const out = runClean(root, ['--stale-secs', '1'])

  assert.ok(!out.includes('verdict-archive'))

  runClean(root, ['--remove', '--stale-secs', '1'])

  assert.equal(fs.existsSync(sessionDir), false)
  assert.equal(fs.existsSync(archiveDir), true)
  assert.equal(fs.readFileSync(path.join(archiveDir, 'leftover'), 'utf8'), 'keep-me')
  cleanup(root)
})

test('session dir with NO status.json ever written becomes a stale candidate via dir mtime', () => {
  const root = tmpRoot()
  const dir = path.join(root, 'never-finalized')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'cx', startedAt: '2026-01-01T00:00:00.000Z' }))
  const oldTime = new Date(Date.now() - 2000 * 1000)
  fs.utimesSync(dir, oldTime, oldTime)

  const out = runClean(root, [])
  assert.ok(out.includes('never-finalized'))
  assert.ok(out.includes('(no status.json)'))

  runClean(root, ['--remove'])
  assert.equal(fs.existsSync(dir), false)
  cleanup(root)
})
