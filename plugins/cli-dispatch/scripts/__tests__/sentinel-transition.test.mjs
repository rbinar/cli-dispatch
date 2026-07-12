import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  bumpTransitionSentinel,
  clearTakeoverState,
  createStatusWriter,
  markTakeoverActive,
} from '../parse-utils.mjs'

function makeSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-sentinel-'))
  const dir = path.join(root, 'session-1')
  fs.mkdirSync(dir, { recursive: true })
  const statusFile = path.join(dir, 'status.json')
  const sentinelFile = path.join(root, '.cli-dispatch-transitions')
  return { root, dir, statusFile, sentinelFile }
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

test('createStatusWriter only bumps the sentinel when state transitions', () => {
  const { root, statusFile, sentinelFile } = makeSession()
  try {
    fs.writeFileSync(sentinelFile, 'old\n')
    fs.utimesSync(sentinelFile, new Date('2000-01-01T00:00:00.000Z'), new Date('2000-01-01T00:00:00.000Z'))
    const before = fs.statSync(sentinelFile)
    const beforeContent = fs.readFileSync(sentinelFile, 'utf8')

    const status = { state: 'running', events: 0 }
    const writer = createStatusWriter(statusFile, status, { throttleMs: 0 })
    writer.flush()
    status.events += 1
    writer.write()
    status.events += 1
    writer.flush()

    assert.equal(fs.readFileSync(sentinelFile, 'utf8'), beforeContent)
    assert.equal(fs.statSync(sentinelFile).mtimeMs, before.mtimeMs)

    status.state = 'done'
    writer.flush()

    assert.equal(fs.existsSync(sentinelFile), true)
    assert.match(fs.readFileSync(sentinelFile, 'utf8'), /^\d{4}-\d{2}-\d{2}T.*Z\n$/)
    assert.ok(fs.statSync(sentinelFile).mtimeMs > before.mtimeMs)
  } finally {
    cleanup(root)
  }
})

test('markTakeoverActive bumps the transition sentinel', () => {
  const { root, statusFile, sentinelFile } = makeSession()
  try {
    fs.writeFileSync(statusFile, JSON.stringify({ state: 'running' }) + '\n')
    markTakeoverActive(statusFile, {
      host: '127.0.0.1:0',
      ptyPid: 123,
      ptyPgid: 123,
      now: '2026-01-01T00:00:00.000Z',
    })

    assert.equal(fs.existsSync(sentinelFile), true)
    assert.match(fs.readFileSync(sentinelFile, 'utf8'), /^\d{4}-\d{2}-\d{2}T.*Z\n$/)
  } finally {
    cleanup(root)
  }
})

test('clearTakeoverState bumps the transition sentinel', () => {
  const { root, statusFile, sentinelFile } = makeSession()
  try {
    fs.writeFileSync(statusFile, JSON.stringify({
      state: 'human-controlled',
      takeover: { active: true },
    }) + '\n')
    clearTakeoverState(statusFile, { finalState: 'done', completedVia: 'human-takeover' })

    assert.equal(fs.existsSync(sentinelFile), true)
    assert.match(fs.readFileSync(sentinelFile, 'utf8'), /^\d{4}-\d{2}-\d{2}T.*Z\n$/)
  } finally {
    cleanup(root)
  }
})

test('bumpTransitionSentinel is best-effort when the workers root is unwritable', () => {
  const { root, statusFile } = makeSession()
  try {
    fs.chmodSync(root, 0o555)
    assert.doesNotThrow(() => bumpTransitionSentinel(statusFile, '2026-01-01T00:00:00.000Z'))
  } finally {
    try { fs.chmodSync(root, 0o755) } catch { /* ignore */ }
    cleanup(root)
  }
})
