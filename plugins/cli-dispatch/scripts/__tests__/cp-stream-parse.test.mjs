import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const parserScript = path.resolve('plugins/cli-dispatch/scripts/cp-stream-parse.mjs')
const testDir = path.resolve('plugins/cli-dispatch/scripts/__tests__/tmp-test-cp-session')

function runParser(events, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    const proc = spawn('node', [parserScript], {
      env: {
        ...process.env,
        CP_SESSION_DIR: testDir,
        CP_THREAD_ID: 'sess-123',
        ...envOverrides
      }
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', data => { stdout += data })
    proc.stderr.on('data', data => { stderr += data })

    proc.on('error', reject)
    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })

    for (const ev of events) {
      proc.stdin.write(JSON.stringify(ev) + '\n')
    }
    proc.stdin.end()
  })
}

test('cp-stream-parse: late ephemeral assistant.reasoning event does not clobber finalText', async () => {
  const events = [
    {
      type: 'assistant.message',
      sessionId: 'sess-123',
      data: { content: 'The final report is ready.' }
    },
    // Out-of-order/late reasoning fragment arriving AFTER the final message.
    // ephemeral:true is Copilot's authoritative "this is not the answer" signal.
    {
      type: 'assistant.reasoning',
      data: { reasoningId: 'r1', content: 'Let me think about the report format...' },
      ephemeral: true
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  // stdout is cp-stream-parse's sole source of the final answer.
  assert.equal(result.stdout.trim(), 'The final report is ready.')

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  assert.equal(status.finalResultPreview, 'The final report is ready.')

  rmSync(testDir, { recursive: true, force: true })
})

test('cp-stream-parse: assistant.reasoning_delta without ephemeral flag is still excluded from finalText', async () => {
  const events = [
    {
      type: 'assistant.message',
      sessionId: 'sess-123',
      data: { content: 'Final answer text.' }
    },
    {
      type: 'assistant.reasoning_delta',
      data: { reasoningId: 'r1', content: 'still thinking...' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Final answer text.')

  rmSync(testDir, { recursive: true, force: true })
})

test('cp-stream-parse: accumulates assistant.message outputTokens without subagent totalTokens contamination', async () => {
  const events = [
    {
      type: 'assistant.message',
      sessionId: 'sess-123',
      data: { content: 'First answer chunk.', outputTokens: 87 }
    },
    {
      type: 'subagent.completed',
      data: {
        toolCallId: 'task-1',
        agentName: 'general-purpose',
        model: 'claude-sonnet-5',
        totalToolCalls: 9,
        totalTokens: 9268974,
        durationMs: 12345
      }
    },
    {
      type: 'assistant.message',
      sessionId: 'sess-123',
      data: { content: 'Final answer.', outputTokens: 13 }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.deepEqual(status.usage, { output_tokens: 100 })

  rmSync(testDir, { recursive: true, force: true })
})

// Real-world event extracted from a production cp-agent transcript:
//   session d4426d07-1a9c-438b-b473-b5d22952cbfa, transcript.jsonl line 15
//   Copilot emitted assistant.message with outputTokens:523 during a
//   claude-sonnet-5 delegation (2026-07-06).  This verifies the parser
//   accumulates outputTokens from the field we found in Phase 1 analysis.
//
// The fixture file at fixtures/real-assistant-message-outputTokens.json
// contains the exact JSONL line from the transcript (unmodified).
test('cp-stream-parse: real GitHub Copilot assistant.message event with outputTokens', async () => {
  const fixturePath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'fixtures', 'real-assistant-message-outputTokens.json'
  )
  const realEvent = JSON.parse(readFileSync(fixturePath, 'utf8'))

  assert.equal(realEvent.type, 'assistant.message')
  assert.equal(realEvent.data.outputTokens, 523)

  const result = await runParser([realEvent])
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  assert.equal(status.usage.output_tokens, 523,
    'parser must accumulate outputTokens from assistant.message events')

  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// E3: Copilot CLI 1.0.70 assistant.message_delta events carry their streamed
// text ONLY in a `deltaContent` field. The parser must (a) accumulate those
// deltas into finalText, and (b) NOT double-count when the final complete
// assistant.message (which OVERWRITES) also arrives.
// ---------------------------------------------------------------------------

test('cp-stream-parse: accumulates deltaContent then final assistant.message overwrites (no double-count)', async () => {
  const events = [
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'Hello ' } },
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'world' } },
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: '!' } },
    // Final complete message with the FULL text — overwrites the accumulation, never appends.
    { type: 'assistant.message', sessionId: 'sess-123', data: { content: 'Hello world!', outputTokens: 5 } }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  // The final answer must be the complete message exactly once — NOT the deltas
  // concatenated with the final message ("Hello world!Hello world!").
  assert.equal(result.stdout.trim(), 'Hello world!')

  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  assert.equal(status.finalResultPreview, 'Hello world!')

  rmSync(testDir, { recursive: true, force: true })
})

test('cp-stream-parse: deltaContent stream interrupted before the final message still captures accumulated text', async () => {
  // The kill-mid-stream shape: only message_delta events, no final assistant.message.
  // Before the E3 fix, deltaContent went unrecognized and the whole answer was lost.
  const events = [
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'Partial ' } },
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'answer ' } },
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'before kill' } }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  // The accumulated deltas are the sole surviving copy of the generated content.
  assert.equal(result.stdout.trim(), 'Partial answer before kill')

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.finalResultPreview, 'Partial answer before kill')

  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// E4: finalize() must NOT downgrade a terminal error/killed status.json that a
// wrapper-level reconcile_session_error() already wrote. Simulate the race:
// stream the (interrupted) content, let the parser settle its throttled
// 'running' write, externally write a terminal error record (as the bash
// reconcile would on a kill), THEN close stdin so the parser's finalize runs.
// ---------------------------------------------------------------------------

function runParserWithReconcile(events, reconcileStatus, { settleMs = 350 } = {}) {
  return new Promise((resolve, reject) => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    const proc = spawn('node', [parserScript], {
      env: { ...process.env, CP_SESSION_DIR: testDir, CP_THREAD_ID: 'sess-123' }
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })
    proc.on('error', reject)
    proc.on('close', code => resolve({ code, stdout, stderr }))

    for (const ev of events) proc.stdin.write(JSON.stringify(ev) + '\n')
    // Let the parser process events and let any throttled status write settle to 'running'.
    setTimeout(() => {
      const statusPath = path.join(testDir, 'status.json')
      let cur = {}
      try { cur = JSON.parse(readFileSync(statusPath, 'utf8')) } catch { /* first write pending */ }
      writeFileSync(statusPath, JSON.stringify({ ...cur, ...reconcileStatus }, null, 2) + '\n')
      proc.stdin.end() // stdin EOF → parser finalize runs the reconcile-race guard
    }, settleMs)
  })
}

test('cp-stream-parse: finalize does not overwrite a reconciled terminal error state', async () => {
  const events = [
    // Interrupted mid-stream: deltas accumulate, but no final message and no error event —
    // exactly the shape where finalize would otherwise compute done/exitCode:0.
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'partial work' } }
  ]

  const result = await runParserWithReconcile(events, { state: 'error', error: 'interrupted: TERM' })
  assert.equal(result.code, 0)

  const status = JSON.parse(readFileSync(path.join(testDir, 'status.json'), 'utf8'))
  assert.equal(status.state, 'error', 'finalize must NOT downgrade a reconciled error to done')
  assert.equal(status.error, 'interrupted: TERM', 'the reconciled error reason must be preserved')
  // E3 content is still surfaced even though the record stays terminal-error.
  assert.equal(status.finalResultPreview, 'partial work')

  rmSync(testDir, { recursive: true, force: true })
})

test('cp-stream-parse: finalize does not overwrite a reconciled killed state', async () => {
  const events = [
    { type: 'assistant.message_delta', sessionId: 'sess-123', data: { deltaContent: 'some text' } }
  ]

  const result = await runParserWithReconcile(events, { state: 'killed', error: 'killed by user' })
  assert.equal(result.code, 0)

  const status = JSON.parse(readFileSync(path.join(testDir, 'status.json'), 'utf8'))
  assert.equal(status.state, 'killed', 'finalize must NOT downgrade a reconciled killed state to done')

  rmSync(testDir, { recursive: true, force: true })
})
