import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, readFileSync, existsSync } from 'node:fs'
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
