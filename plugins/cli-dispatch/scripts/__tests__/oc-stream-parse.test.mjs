import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const parserScript = path.resolve('plugins/cli-dispatch/scripts/oc-stream-parse.mjs')
const testDir = path.resolve('plugins/cli-dispatch/scripts/__tests__/tmp-test-session')

function runParser(events, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    const proc = spawn('node', [parserScript], {
      env: {
        ...process.env,
        OC_SESSION_DIR: testDir,
        OC_THREAD_ID: 'sess-123',
        ...envOverrides
      }
    })
    
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', data => { stdout += data })
    proc.stderr.on('data', data => { stderr += data })
    
    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })
    
    for (const ev of events) {
      proc.stdin.write(JSON.stringify(ev) + '\n')
    }
    proc.stdin.end()
  })
}

test('oc-stream-parse: handles interrupted tool calls correctly without fatal error', async () => {
  const events = [
    {
      type: 'tool_use',
      sessionID: 'sess-123',
      part: {
        type: 'tool',
        tool: 'write',
        callID: 'write:1',
        state: { status: 'completed', input: { filePath: 'test.txt' } }
      }
    },
    {
      type: 'tool_use',
      sessionID: 'sess-123',
      part: {
        type: 'tool',
        tool: 'unknown',
        callID: 'functions.read:1',
        state: {
          status: 'error',
          input: {},
          raw: '',
          error: 'Tool execution aborted',
          metadata: { interrupted: true }
        }
      }
    },
    {
      type: 'tool_use',
      sessionID: 'sess-123',
      part: {
        type: 'tool',
        tool: 'unknown',
        callID: 'functions.read:2',
        state: {
          status: 'error',
          input: {},
          raw: '',
          error: 'Tool execution aborted',
          metadata: { interrupted: true }
        }
      }
    },
    {
      type: 'tool_use',
      sessionID: 'sess-123',
      part: {
        type: 'tool',
        tool: 'unknown',
        callID: 'functions.read:3',
        state: {
          status: 'error',
          input: {},
          raw: '',
          error: 'Tool execution aborted',
          metadata: { interrupted: true }
        }
      }
    },
    {
      type: 'text',
      sessionID: 'sess-123',
      part: {
        type: 'text',
        text: 'Success! All work is done.'
      }
    },
    {
      type: 'step_finish',
      sessionID: 'sess-123',
      part: { reason: 'stop' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)
  
  // Read status.json
  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'done')
  
  // Read progress.log
  const progressPath = path.join(testDir, 'progress.log')
  assert.ok(existsSync(progressPath))
  const progress = readFileSync(progressPath, 'utf8')
  
  // Ensure the non-fatal lines are logged with the special glyph and resolve unknown tool to callID
  assert.match(progress, /⚠ interrupted: functions\.read:1/)
  assert.match(progress, /⚠ interrupted: functions\.read:2/)
  assert.match(progress, /⚠ interrupted: functions\.read:3/)
  
  // Clean up
  rmSync(testDir, { recursive: true, force: true })
})

test('oc-stream-parse: genuine tool error results in fatal error state', async () => {
  const events = [
    {
      type: 'tool_use',
      sessionID: 'sess-123',
      part: {
        type: 'tool',
        tool: 'write',
        callID: 'write:1',
        state: { status: 'completed', input: { filePath: 'test.txt' } }
      }
    },
    {
      type: 'tool_use',
      sessionID: 'sess-123',
      part: {
        type: 'tool',
        tool: 'write',
        callID: 'write:2',
        state: {
          status: 'error',
          input: { filePath: 'test.txt' },
          error: 'Failed to write file'
        }
      }
    },
    {
      type: 'step_finish',
      sessionID: 'sess-123',
      part: { reason: 'stop' }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)
  
  // Read status.json
  const statusPath = path.join(testDir, 'status.json')
  assert.ok(existsSync(statusPath))
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.equal(status.state, 'error')
  assert.equal(status.error, 'Failed to write file')
  
  // Read progress.log
  const progressPath = path.join(testDir, 'progress.log')
  assert.ok(existsSync(progressPath))
  const progress = readFileSync(progressPath, 'utf8')
  
  // Ensure the fatal error is logged with the normal ✗ glyph
  assert.match(progress, /✗ write: Failed to write file/)
  
  // Clean up
  rmSync(testDir, { recursive: true, force: true })
})

test('oc-stream-parse: accumulates step_finish token usage across LLM calls', async () => {
  const events = [
    {
      type: 'step_finish',
      sessionID: 'sess-123',
      part: {
        reason: 'tool-calls',
        tokens: {
          input: 100,
          output: 10,
          reasoning: 2,
          cache: { read: 7, write: 0 }
        }
      }
    },
    {
      type: 'text',
      sessionID: 'sess-123',
      part: { type: 'text', text: 'done' }
    },
    {
      type: 'step_finish',
      sessionID: 'sess-123',
      part: {
        reason: 'stop',
        tokens: {
          input: 250,
          output: 30,
          reasoning: 4,
          cache: { read: 11, write: 0 }
        }
      }
    }
  ]

  const result = await runParser(events)
  assert.equal(result.code, 0)

  const statusPath = path.join(testDir, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  assert.deepEqual(status.usage, {
    input_tokens: 350,
    cached_input_tokens: 18,
    output_tokens: 40,
    reasoning_output_tokens: 6
  })

  rmSync(testDir, { recursive: true, force: true })
})
