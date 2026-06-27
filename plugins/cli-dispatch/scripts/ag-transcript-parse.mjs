#!/usr/bin/env node
// ag-transcript-parse.mjs — Antigravity (agy) transcript tailer.
//
// agy has no reliable stdout stream (no --output-format json; non-TTY silent-drop),
// but it persists a JSONL transcript to disk. This parser TAIL-FOLLOWS that file
// (poll + byte-offset) instead of reading stdin, and writes the SAME session-dir
// layout claude-ds uses so /cli-dispatch:watch / sessions work for both
// backends uniformly:
//
//   transcript.jsonl — a copy of the agy lines we ingested (audit; not polled)
//   progress.log     — terse human-readable stream (tool_calls + truncated text)
//   status.json      — compact rolling summary (the ONLY file the orchestrator polls)
//   meta.json        — prompt preview, cwd, branch, model, backend, convId, start/end, exit
//
// The final answer (last MODEL/PLANNER_RESPONSE with non-empty content) is also
// printed to stdout → the caller still gets the answer.
//
// Config via env (set by ag-stream):
//   AG_SESSION_DIR   (required) — session directory
//   AG_TRANSCRIPT    (required) — path to transcript_full.jsonl (may not exist yet; we wait)
//   AG_DONEFILE      (required) — sentinel: once present, drain remaining lines then finalize
//   AG_PROMPT_PREVIEW, AG_CWD, AG_BRANCH, AG_MODEL, AG_CONV_ID
//   AG_RESUME        ("1" → append to transcript/progress, keep existing meta)
//   AG_PROGRESS_STDERR ("1" → mirror each progress line to stderr too, for ag-agent)

import { writeFileSync, readFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync, statSync, readSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.AG_SESSION_DIR
const transcriptPath = process.env.AG_TRANSCRIPT
const doneFile = process.env.AG_DONEFILE
if (!dir || !transcriptPath || !doneFile) {
  process.stderr.write('ag-transcript-parse: AG_SESSION_DIR / AG_TRANSCRIPT / AG_DONEFILE required\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

const isResume = process.env.AG_RESUME === '1'
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
  backend: 'antigravity',
  convId: process.env.AG_CONV_ID ?? meta.convId ?? '',
  promptPreview: process.env.AG_PROMPT_PREVIEW ?? meta.promptPreview ?? '',
  cwd: process.env.AG_CWD ?? meta.cwd ?? '',
  branch: process.env.AG_BRANCH ?? meta.branch ?? '',
  model: process.env.AG_MODEL ?? meta.model ?? '',
  startedAt: isResume && meta.startedAt ? meta.startedAt : new Date().toISOString(),
  lastResumedAt: isResume ? new Date().toISOString() : undefined,
  endedAt: null,
  exitCode: null,
  error: undefined,
}
const writeMeta = () => { try { writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n') } catch { /* ignore */ } }
writeMeta()

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
  backend: 'antigravity',
  convId: meta.convId,
  state: 'running', // running | done | error
  lastTool: null,
  toolCounts: {},
  events: 0,
  startedAt: meta.startedAt,
  lastActivityAt: new Date().toISOString(),
  finalResultPreview: '',
}
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
flushStatus()

const progressToStderr = process.env.AG_PROGRESS_STDERR === '1'
const appendProgress = (line) => {
  if (progressFd >= 0) { try { writeSync(progressFd, line + '\n') } catch { /* ignore */ } }
  if (progressToStderr) { try { process.stderr.write(line + '\n') } catch { /* ignore */ } }
}

const humanSize = (n) => {
  if (n < 1024) return `${n}b`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`
  return `${(n / 1024 / 1024).toFixed(1)}mb`
}
const clip = (s, n) => { const o = String(s).replace(/\s+/g, ' ').trim(); return o.length > n ? o.slice(0, n) + '…' : o }
const touch = () => { status.lastActivityAt = new Date().toISOString(); status.events++ }

let finalText = ''        // last PLANNER_RESPONSE content (the running/final answer)
const emittedSteps = new Set()

function handleLine(o) {
  // De-dupe: agy may rewrite/append; key on step_index when present.
  const key = (o.step_index ?? '') + ':' + (o.type ?? '')
  if (o.step_index != null && emittedSteps.has(key)) return
  if (o.step_index != null) emittedSteps.add(key)

  const src = o.source, type = o.type
  if (type === 'USER_INPUT' || type === 'CONVERSATION_HISTORY' || type === 'CHECKPOINT') {
    // our own prompt / history markers / compaction summaries — not progress
    return
  }
  if (src === 'MODEL' && type === 'PLANNER_RESPONSE') {
    for (const tc of o.tool_calls ?? []) {
      const name = tc?.name ?? 'tool'
      const sum = tc?.args?.toolSummary ?? tc?.args?.toolAction ?? ''
      appendProgress(`▸ ${name}${sum ? ' ' + clip(sum, 80) : ''}`)
      status.lastTool = name
      status.toolCounts[name] = (status.toolCounts[name] ?? 0) + 1
    }
    if (typeof o.content === 'string' && o.content.trim()) {
      finalText = o.content
      appendProgress(`· ${clip(o.content, 200)}`)
    }
    touch(); writeStatus()
    return
  }
  if (src === 'MODEL' && type === 'CODE_ACTION') {
    const body = typeof o.content === 'string' ? o.content : ''
    appendProgress(`  ✓ (${humanSize(body.length)})`)
    touch(); writeStatus()
    return
  }
}

// ---- tail-follow the transcript by byte offset ----
let offset = 0
let lineBuf = ''
const BUF = Buffer.alloc(65536)

function drain() {
  if (!existsSync(transcriptPath)) return
  let size
  try { size = statSync(transcriptPath).size } catch { return }
  if (size < offset) { offset = 0; lineBuf = '' } // truncated/rotated — restart
  if (size === offset) return
  let fd = -1
  try { fd = openSync(transcriptPath, 'r') } catch { return }
  try {
    while (offset < size) {
      const want = Math.min(BUF.length, size - offset)
      const got = readSync(fd, BUF, 0, want, offset)
      if (got <= 0) break
      offset += got
      lineBuf += BUF.toString('utf8', 0, got)
    }
  } finally { try { closeSync(fd) } catch { /* ignore */ } }
  const lines = lineBuf.split('\n')
  lineBuf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    writeTranscript(line + '\n')
    try { handleLine(JSON.parse(line)) } catch { /* not JSON yet — ignore */ }
  }
}

function finalize() {
  drain() // last read
  if (transcriptFd >= 0) { try { closeSync(transcriptFd) } catch { /* ignore */ } transcriptFd = -1 }
  if (progressFd >= 0) { try { closeSync(progressFd) } catch { /* ignore */ } progressFd = -1 }
  // Done sentinel content = exit reason: "0" (ok) | "<n>" (agy exit n) | "timeout: …"
  let done = ''
  try { done = readFileSync(doneFile, 'utf8').trim() } catch { /* ignore */ }
  const isErr = done !== '0' && done !== ''
  status.state = finalText ? (isErr && !/^\d+$/.test(done) ? 'error' : 'done') : 'error'
  if (isErr && !finalText) status.error = done
  status.finalResultPreview = clip(finalText, 300)
  status.lastActivityAt = new Date().toISOString()
  flushStatus()
  meta.endedAt = new Date().toISOString()
  meta.exitCode = /^\d+$/.test(done) ? Number(done) : null
  meta.state = status.state
  if (isErr && !finalText) meta.error = done
  writeMeta()
  if (finalText) process.stdout.write(finalText.endsWith('\n') ? finalText : finalText + '\n')
  process.exit(0)
}

const POLL_MS = 300
const tick = () => {
  drain()
  if (existsSync(doneFile)) {
    // grace: one more drain on next tick already happened; finalize now.
    setTimeout(finalize, 150)
    return
  }
  setTimeout(tick, POLL_MS)
}
tick()
