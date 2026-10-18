import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// progress.idx maps each progress line (by byte offset) to the transcript bytes of the event
// that produced it. The parsers run for real; the session dirs live in a private temp root so
// the passive prune never looks at anything else.

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const script = (n) => path.join(SELF_DIR, '..', n)
const root = mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-test-pidx-'))
let counter = 0
const newDir = () => path.join(root, `s${++counter}`)

function run(parser, env, events) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [script(parser)], { env: { ...process.env, ...env } })
    proc.on('error', reject)
    proc.on('close', (code) => resolve(code))
    for (const ev of events) proc.stdin.write(JSON.stringify(ev) + '\n')
    proc.stdin.end()
  })
}

// Every progress line (not the resume marker, not a blank line) with its byte offset.
function progressLines(dir) {
  const buf = readFileSync(path.join(dir, 'progress.log'))
  const out = []
  let pos = 0
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos)
    const text = buf.subarray(pos, nl).toString('utf8')
    if (text && !text.startsWith('--- resume @')) out.push({ p: pos, text })
    pos = nl + 1
  }
  return out
}

function idxRecords(dir) {
  const f = path.join(dir, 'progress.idx')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

// The event behind a progress line: parsed from transcript bytes [o, o+l), or the ds {text}.
function eventOf(dir, p) {
  const recs = idxRecords(dir).filter((r) => r.p === p)
  assert.equal(recs.length, 1, `exactly one idx record for progress offset ${p}`)
  const r = recs[0]
  if ('text' in r) return { text: r.text }
  const t = readFileSync(path.join(dir, 'transcript.jsonl'))
  return JSON.parse(t.subarray(r.o, r.o + r.l).toString('utf8'))
}

const BIG_OUT = 'x'.repeat(5200) + ' ğüş✓'

test('cx: every progress line has one idx record pointing at its own event (output over 5000 chars, multi-byte)', async () => {
  const dir = newDir()
  const events = [
    { type: 'thread.started', thread_id: 't1' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'npm test' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'npm test', aggregated_output: BIG_OUT, exit_code: 1 } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'ğüş✓ done' } },
  ]
  assert.equal(await run('cx-stream-parse.mjs', { CX_SESSION_DIR: dir, CX_THREAD_ID: 't1' }, events), 0)
  const lines = progressLines(dir)
  assert.deepEqual(lines.map((l) => l.text), ['$ npm test', '$ npm test (exit 1)', '· ğüş✓ done'])
  assert.equal(idxRecords(dir).length, 3)
  assert.equal(eventOf(dir, lines[0].p).item.id, 'i1')
  assert.equal(eventOf(dir, lines[0].p).type, 'item.started')
  const done = eventOf(dir, lines[1].p)
  assert.equal(done.type, 'item.completed')
  assert.equal(done.item.aggregated_output, BIG_OUT)
  assert.equal(done.item.exit_code, 1)
  assert.equal(eventOf(dir, lines[2].p).item.text, 'ğüş✓ done')
})

test('ds: the coalesced text line records its full text; tool lines point at their own events', async () => {
  const dir = newDir()
  const full = ('ğüş✓ ' + 'word '.repeat(60)).trim()
  const parts = [full.slice(0, 90), full.slice(90, 180), full.slice(180)]
  const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
  const events = [
    { type: 'system', session_id: 'cs1', model: 'm' },
    ...parts.map(delta),
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: full }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a\nb' }] } },
  ]
  assert.equal(await run('ds-stream-parse.mjs', { CLAUDE_DS_SESSION_DIR: dir }, events), 0)
  const lines = progressLines(dir)
  assert.equal(lines.length, 3)
  assert.ok(lines[0].text.startsWith('· ') && lines[0].text.endsWith('…'), 'the line itself is still clipped to 200')
  assert.deepEqual(eventOf(dir, lines[0].p), { text: full })
  assert.equal(eventOf(dir, lines[1].p).message.content[1].id, 'tu1')
  assert.equal(lines[1].text, '▸ Bash ls')
  assert.equal(eventOf(dir, lines[2].p).message.content[0].tool_use_id, 'tu1')
  assert.equal(lines[2].text, '  ✓ (3b)')
})

test('cp: each progress line points at its own event', async () => {
  const dir = newDir()
  const events = [
    { type: 'tool.execution_complete', data: { toolCallId: 'c1', toolName: 'edit', arguments: { path: 'a.txt' }, success: true } },
    { type: 'assistant.message', data: { content: 'The final report ğüş✓.' } },
  ]
  assert.equal(await run('cp-stream-parse.mjs', { CP_SESSION_DIR: dir, CP_THREAD_ID: 't' }, events), 0)
  const lines = progressLines(dir)
  assert.equal(lines.length, 2)
  assert.equal(eventOf(dir, lines[0].p).type, 'tool.execution_complete')
  assert.equal(eventOf(dir, lines[1].p).data.content, 'The final report ğüş✓.')
})

test('oc: each progress line points at its own event', async () => {
  const dir = newDir()
  const events = [
    { type: 'tool_use', sessionID: 's', part: { type: 'tool', tool: 'write', callID: 'w1', state: { status: 'completed', input: { filePath: 'test.txt' } } } },
    { type: 'text', sessionID: 's', part: { type: 'text', text: 'all done ğüş✓' } },
  ]
  assert.equal(await run('oc-stream-parse.mjs', { OC_SESSION_DIR: dir }, events), 0)
  const lines = progressLines(dir)
  assert.deepEqual(lines.map((l) => l.text), ['✎ write test.txt', '· all done ğüş✓'])
  assert.equal(eventOf(dir, lines[0].p).part.callID, 'w1')
  assert.equal(eventOf(dir, lines[1].p).part.text, 'all done ğüş✓')
})

test('ag: one PLANNER_RESPONSE with two tool calls gives three lines, all pointing at that one event', async () => {
  const dir = newDir()
  mkdirSync(dir, { recursive: true })
  const transcript = path.join(dir, 'transcript_full.jsonl')
  const done = path.join(dir, 'done.sentinel')
  const proc = spawn('node', [script('ag-transcript-parse.mjs')], {
    env: { ...process.env, AG_SESSION_DIR: dir, AG_TRANSCRIPT: transcript, AG_DONEFILE: done, AG_CONV_ID: 'c1' },
  })
  const closed = new Promise((resolve) => proc.on('close', resolve))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await sleep(500)
  const planner = {
    source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'plan ğüş✓',
    tool_calls: [{ name: 'view_file', args: { toolSummary: 'read a' } }, { name: 'run_command', args: { toolSummary: 'run b' } }],
  }
  writeFileSync(transcript, JSON.stringify(planner) + '\n')
  await sleep(700)
  writeFileSync(done, '0')
  assert.equal(await closed, 0)
  const lines = progressLines(dir)
  assert.deepEqual(lines.map((l) => l.text), ['▸ view_file read a', '▸ run_command run b', '· plan ğüş✓'])
  for (const l of lines) assert.equal(eventOf(dir, l.p).content, 'plan ğüş✓')
  const recs = idxRecords(dir)
  assert.equal(new Set(recs.map((r) => r.o)).size, 1)
})

test('resume: the second turn points past the first turn bytes, and the marker has no record', async () => {
  const dir = newDir()
  const turn = (id, text) => [{ type: 'item.completed', item: { id, type: 'agent_message', text } }]
  await run('cx-stream-parse.mjs', { CX_SESSION_DIR: dir, CX_THREAD_ID: 't' }, turn('a', 'first ğüş✓'))
  const firstSize = readFileSync(path.join(dir, 'transcript.jsonl')).length
  await run('cx-stream-parse.mjs', { CX_SESSION_DIR: dir, CX_THREAD_ID: 't', CX_RESUME: '1' }, turn('b', 'second ✓'))
  const lines = progressLines(dir)
  assert.deepEqual(lines.map((l) => l.text), ['· first ğüş✓', '· second ✓'])
  assert.match(readFileSync(path.join(dir, 'progress.log'), 'utf8'), /--- resume @ /)
  const recs = idxRecords(dir)
  assert.equal(recs.length, 2, 'the resume marker has no record')
  assert.ok(recs[1].o >= firstSize)
  assert.equal(eventOf(dir, lines[0].p).item.text, 'first ğüş✓')
  assert.equal(eventOf(dir, lines[1].p).item.text, 'second ✓')
  assert.ok(recs[1].p > recs[0].p)
})

test('progress.log is byte-for-byte the golden content (the idx changes no format)', async () => {
  const dir = newDir()
  const events = [
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls -la' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls -la', aggregated_output: 'ok', exit_code: 0 } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'ok done' } },
  ]
  await run('cx-stream-parse.mjs', { CX_SESSION_DIR: dir, CX_THREAD_ID: 't' }, events)
  assert.equal(readFileSync(path.join(dir, 'progress.log'), 'utf8'), '$ ls -la\n$ ls -la (exit 0)\n· ok done\n')

  const dsDir = newDir()
  const ds = [
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a/b' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'abc' }] } },
  ]
  await run('ds-stream-parse.mjs', { CLAUDE_DS_SESSION_DIR: dsDir }, ds)
  assert.equal(readFileSync(path.join(dsDir, 'progress.log'), 'utf8'), '· hello\n▸ Read /a/b\n  ✓ (3b)\n')
})

test.after(() => rmSync(root, { recursive: true, force: true }))
