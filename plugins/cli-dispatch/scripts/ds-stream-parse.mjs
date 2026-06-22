#!/usr/bin/env node
// ds-stream-parse.mjs — claude-ds stream-json parser.
//
// Reads a `claude --output-format stream-json` JSONL stream from stdin, mirrors
// octo-ai's claude-runner.ts event switch, and writes to a session directory:
//
//   transcript.jsonl — raw JSONL (full fidelity; for resume/audit, NOT read while polling)
//   progress.log     — terse human-readable stream (tool_use/result + truncated text)
//   status.json      — compact rolling summary (the ONLY file the orchestrator polls)
//   meta.json        — prompt preview, cwd, branch, model, start/end, exit
//
// The final `result` text is also printed to stdout → the caller still gets the answer.
//
// Config comes via env (set by the wrapper):
//   CLAUDE_DS_SESSION_DIR   (required) — session directory
//   CLAUDE_DS_PROMPT_PREVIEW, CLAUDE_DS_CWD, CLAUDE_DS_BRANCH, CLAUDE_DS_MODEL
//   CLAUDE_DS_RESUME        ("1" → append to transcript/progress, keep existing meta)

import { writeFileSync, readFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.CLAUDE_DS_SESSION_DIR
if (!dir) {
  process.stderr.write('ds-stream-parse: CLAUDE_DS_SESSION_DIR not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

const isResume = process.env.CLAUDE_DS_RESUME === '1'
const transcriptFile = path.join(dir, 'transcript.jsonl')
const progressFile = path.join(dir, 'progress.log')
const statusFile = path.join(dir, 'status.json')
const metaFile = path.join(dir, 'meta.json')

// ---- meta.json: static fields (on resume, preserve existing meta) ----
let meta = {}
if (isResume && existsSync(metaFile)) {
  try { meta = JSON.parse(readFileSync(metaFile, 'utf8')) } catch { /* rebuild */ }
}
meta = {
  ...meta,
  sessionId: path.basename(dir),
  promptPreview: process.env.CLAUDE_DS_PROMPT_PREVIEW ?? meta.promptPreview ?? '',
  cwd: process.env.CLAUDE_DS_CWD ?? meta.cwd ?? '',
  branch: process.env.CLAUDE_DS_BRANCH ?? meta.branch ?? '',
  model: process.env.CLAUDE_DS_MODEL ?? meta.model ?? '',
  startedAt: isResume && meta.startedAt ? meta.startedAt : new Date().toISOString(),
  lastResumedAt: isResume ? new Date().toISOString() : undefined,
  endedAt: null,
  exitCode: null,
  // Clear any stale error from a prior (failed) run; the wrapper re-sets it on
  // this run only if claude exits nonzero again. (undefined → omitted by JSON.stringify)
  error: undefined,
}
const writeMeta = () => { try { writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n') } catch { /* ignore */ } }
writeMeta()

// Hold ONE append fd each for the transcript and the progress log. appendFileSync re-opens
// and closes the file on every call (~3 syscalls), which dominates runtime on large or
// tool-heavy streams. writeSync to a held fd still updates mtime, so the idle-timeout
// watchdog (which keys off transcript.jsonl) keeps working.
let transcriptFd = -1, progressFd = -1
try { transcriptFd = openSync(transcriptFile, isResume ? 'a' : 'w') } catch { /* ignore */ }
try { progressFd = openSync(progressFile, isResume ? 'a' : 'w') } catch { /* ignore */ }
const writeTranscript = (s) => { if (transcriptFd >= 0) { try { writeSync(transcriptFd, s) } catch { /* ignore */ } } }
if (isResume && progressFd >= 0) {
  try { writeSync(progressFd, `\n--- resume @ ${new Date().toISOString()} ---\n`) } catch { /* ignore */ }
}

// ---- rolling state ----
const status = {
  sessionId: path.basename(dir),
  state: 'running', // running | done | error
  lastTool: null,
  toolCounts: {},
  events: 0,
  startedAt: meta.startedAt,
  lastActivityAt: new Date().toISOString(),
  finalResultPreview: '',
}
// status.json is a polled snapshot — it needn't hit disk on every event. Throttle the
// full-file rewrites to ~200ms (coalescing bursts of tool events); finalize forces a final
// write. Idle detection keys off transcript.jsonl, not this file, so throttling is safe.
const STATUS_THROTTLE_MS = 200
let lastStatusWrite = 0
let statusTimer = null
const flushStatus = () => {
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null }
  lastStatusWrite = Date.now()
  try { writeFileSync(statusFile, JSON.stringify(status, null, 2) + '\n') } catch { /* ignore */ }
}
const writeStatus = () => {
  const since = Date.now() - lastStatusWrite
  if (since >= STATUS_THROTTLE_MS) { flushStatus(); return }
  if (!statusTimer) {
    statusTimer = setTimeout(flushStatus, STATUS_THROTTLE_MS - since)
    statusTimer.unref?.()
  }
}
flushStatus() // initial snapshot, written immediately

const emittedToolUseIds = new Set()
const emittedToolResultIds = new Set()
let finalText = ''
let streamedText = ''
let pendingText = '' // coalesced streamed text; flushed as a single terse progress line

// When CLAUDE_DS_PROGRESS_STDERR=1, mirror each progress line to stderr too — lets a
// synchronous caller (ds-agent) show live tool activity while the worker runs, without
// touching stdout (which carries only the final answer).
const progressToStderr = process.env.CLAUDE_DS_PROGRESS_STDERR === '1'
const appendProgress = (line) => {
  if (progressFd >= 0) { try { writeSync(progressFd, line + '\n') } catch { /* ignore */ } }
  if (progressToStderr) { try { process.stderr.write(line + '\n') } catch { /* ignore */ } }
}

// Flush streamed text to progress.log as a single truncated line (cost-conscious).
const flushPending = () => {
  const t = pendingText.trim()
  pendingText = ''
  if (!t) return
  const oneLine = t.replace(/\s+/g, ' ')
  const clipped = oneLine.length > 200 ? oneLine.slice(0, 200) + '…' : oneLine
  appendProgress(`· ${clipped}`)
}

// Derive a short, readable summary from a tool's input.
const inputPreview = (input) => {
  if (input && typeof input === 'object') {
    const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.query
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v
  }
  try {
    const s = JSON.stringify(input)
    return s && s.length > 80 ? s.slice(0, 80) + '…' : (s ?? '')
  } catch { return '' }
}

const humanSize = (n) => {
  if (n < 1024) return `${n}b`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`
  return `${(n / 1024 / 1024).toFixed(1)}mb`
}

const touch = () => { status.lastActivityAt = new Date().toISOString(); status.events++ }

function handleEvent(ev) {
  // Init/system event: confirm session_id.
  if (ev.type === 'system' && typeof ev.session_id === 'string') {
    meta.sessionId = ev.session_id
    status.sessionId = ev.session_id
    writeMeta()
  }

  if (ev.type === 'stream_event') {
    const inner = ev.event
    if (inner?.type === 'content_block_delta') {
      const delta = inner.delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        streamedText += delta.text
        pendingText += delta.text
        touch()
      }
    }
    return
  }

  if (ev.type === 'assistant') {
    const content = ev.message?.content
    for (const block of content ?? []) {
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        if (!emittedToolUseIds.has(block.id)) {
          emittedToolUseIds.add(block.id)
          flushPending()
          appendProgress(`▸ ${block.name} ${inputPreview(block.input)}`)
          status.lastTool = block.name
          status.toolCounts[block.name] = (status.toolCounts[block.name] ?? 0) + 1
          touch()
          writeStatus()
        }
      } else if (block.type === 'text' && typeof block.text === 'string' && !streamedText) {
        finalText += block.text
        pendingText += block.text
        touch()
      }
    }
    return
  }

  if (ev.type === 'user') {
    const content = ev.message?.content
    for (const block of content ?? []) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        if (!emittedToolResultIds.has(block.tool_use_id)) {
          emittedToolResultIds.add(block.tool_use_id)
          let text = ''
          if (typeof block.content === 'string') text = block.content
          else if (Array.isArray(block.content)) {
            text = block.content.map((c) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('\n')
          }
          // Do NOT write the body — only ok/err + size (cost-conscious).
          if (block.is_error) {
            const firstLine = text.split('\n').find((l) => l.trim()) ?? ''
            appendProgress(`  ✗ ${firstLine.slice(0, 120)} (${humanSize(text.length)})`)
          } else {
            appendProgress(`  ✓ (${humanSize(text.length)})`)
          }
          touch()
          writeStatus()
        }
      }
    }
    return
  }

  if (ev.type === 'result' && typeof ev.result === 'string') {
    finalText = ev.result
  }
}

// ---- read stdin line by line (the lineBuf logic from claude-runner.ts) ----
let lineBuf = ''
process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk) => {
  lineBuf += chunk
  const lines = lineBuf.split('\n')
  lineBuf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    writeTranscript(line + '\n')
    try { handleEvent(JSON.parse(line)) } catch { /* not JSON — ignore */ }
  }
})

function finalize(code) {
  if (lineBuf.trim()) {
    writeTranscript(lineBuf + '\n')
    try { handleEvent(JSON.parse(lineBuf)) } catch { /* ignore */ }
    lineBuf = ''
  }
  if (transcriptFd >= 0) { try { closeSync(transcriptFd) } catch { /* ignore */ } transcriptFd = -1 }
  flushPending()
  if (progressFd >= 0) { try { closeSync(progressFd) } catch { /* ignore */ } progressFd = -1 }
  const out = finalText || streamedText
  status.state = out ? 'done' : (code === 0 ? 'done' : 'error')
  status.finalResultPreview = (out || '').replace(/\s+/g, ' ').slice(0, 300)
  status.lastActivityAt = new Date().toISOString()
  flushStatus() // force the final snapshot (cancels any pending throttled write)
  meta.endedAt = new Date().toISOString()
  meta.exitCode = code ?? 0
  meta.state = status.state
  writeMeta()
  // Print the final text to stdout — the caller (background task) gets the answer here.
  if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n')
}

process.stdin.on('end', () => finalize(0))
process.stdin.on('error', () => finalize(1))
