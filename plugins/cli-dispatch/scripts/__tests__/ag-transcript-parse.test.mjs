import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const parserScript = path.resolve('plugins/cli-dispatch/scripts/ag-transcript-parse.mjs')
const testDir = path.resolve('plugins/cli-dispatch/scripts/__tests__/tmp-test-ag-session')
const transcriptPath = path.join(testDir, 'transcript_full.jsonl')
const doneFilePath = path.join(testDir, 'done.sentinel')

// ag-transcript-parse.mjs polls every 300ms. Give the poll loop plenty of margin
// to observe writes before we assert / write the next fixture step.
const POLL_MARGIN_MS = 500

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function spawnParser(envOverrides = {}) {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
  mkdirSync(testDir, { recursive: true })

  const proc = spawn('node', [parserScript], {
    env: {
      ...process.env,
      AG_SESSION_DIR: testDir,
      AG_TRANSCRIPT: transcriptPath,
      AG_DONEFILE: doneFilePath,
      AG_CONV_ID: 'conv-123',
      ...envOverrides
    }
  })

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', data => { stdout += data })
  proc.stderr.on('data', data => { stderr += data })

  const closed = new Promise((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', code => resolve(code))
  })

  return {
    proc,
    closed,
    getStdout: () => stdout,
    getStderr: () => stderr
  }
}

test('ag-transcript-parse: PLANNER_RESPONSE + model-selection scrape finalize to done', async () => {
  const { closed, getStdout } = spawnParser()

  // Give the parser a beat to start its poll loop before the transcript file exists.
  await sleep(POLL_MARGIN_MS)

  const lines = [
    JSON.stringify({
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'The task is complete.',
      tool_calls: []
    }),
    JSON.stringify({
      type: 'USER_INPUT',
      content: 'You changed setting `Model Selection` from None to Gemini 3.5 Flash (High).'
    })
  ]
  writeFileSync(transcriptPath, lines.join('\n') + '\n')

  // Let the poll loop drain the lines we just wrote.
  await sleep(POLL_MARGIN_MS)

  // Trigger finalize(): "0" == success sentinel.
  writeFileSync(doneFilePath, '0')

  const code = await closed
  assert.equal(code, 0)
  assert.equal(getStdout().trim(), 'The task is complete.')

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  assert.equal(status.finalResultPreview, 'The task is complete.')

  const metaPath = path.join(testDir, 'meta.json')
  assert.ok(existsSync(metaPath))
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  // The observed model scraped from the USER_INPUT settings-change prose overwrites
  // whatever AG_MODEL was requested (ground truth per the source's own comment).
  assert.equal(meta.model, 'Gemini 3.5 Flash (High)')
  assert.equal(meta.backend, 'antigravity')
  assert.equal(meta.exitCode, 0)
  assert.equal(meta.state, 'done')

  rmSync(testDir, { recursive: true, force: true })
})

test('ag-transcript-parse: non-zero donefile with no finalText sets status.state=error', async () => {
  const { closed, getStdout } = spawnParser()

  await sleep(POLL_MARGIN_MS)

  // No PLANNER_RESPONSE content ever arrives — simulate agy exiting with a failure
  // before producing any answer.
  writeFileSync(doneFilePath, '1')

  const code = await closed
  assert.equal(code, 0)
  assert.equal(getStdout(), '')

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'error')
  assert.equal(status.error, '1')

  const metaPath = path.join(testDir, 'meta.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  assert.equal(meta.state, 'error')
  assert.equal(meta.error, '1')
  assert.equal(meta.exitCode, 1)

  rmSync(testDir, { recursive: true, force: true })
})
