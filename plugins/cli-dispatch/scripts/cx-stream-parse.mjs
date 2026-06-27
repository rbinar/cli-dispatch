#!/usr/bin/env node
// cx-stream-parse.mjs — Codex (OpenAI Codex CLI) JSONL event parser.
//
// Reads a `codex exec --json` JSONL stream from stdin, mirrors ds-stream-parse.mjs /
// ag-transcript-parse.mjs, and writes the SAME session-dir layout claude-ds uses so
// /cli-dispatch:watch / sessions work for all backends uniformly:
//
//   transcript.jsonl — raw JSONL (full fidelity; for resume/audit, NOT read while polling)
//   progress.log     — terse human-readable stream (items + truncated text)
//   status.json      — compact rolling summary (the ONLY file the orchestrator polls)
//   meta.json        — prompt preview, cwd, branch, model, backend, threadId, start/end, exit
//
// The final agent_message text is also printed to stdout → the caller still gets the
// answer (cx-stream prefers the -o file, but falls back to this).
//
// Config comes via env (set by cx-stream):
//   CX_SESSION_DIR   (required) — session directory
//   CX_PROMPT_PREVIEW, CX_CWD, CX_BRANCH, CX_MODEL, CX_THREAD_ID
//   CX_RESUME        ("1" → append to transcript/progress, keep existing meta)
//   CX_PROGRESS_STDERR ("1" → mirror each progress line to stderr too, for cx-agent)

import { writeFileSync, readFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.CX_SESSION_DIR
if (!dir) {
  process.stderr.write('cx-stream-parse: CX_SESSION_DIR not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

const isResume = process.env.CX_RESUME === '1'
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
  backend: 'codex',
  threadId: process.env.CX_THREAD_ID ?? meta.threadId ?? '',
  promptPreview: process.env.CX_PROMPT_PREVIEW ?? meta.promptPreview ?? '',
  cwd: process.env.CX_CWD ?? meta.cwd ?? '',
  branch: process.env.CX_BRANCH ?? meta.branch ?? '',
  model: process.env.CX_MODEL ?? meta.model ?? '',
  startedAt: isResume && meta.startedAt ? meta.startedAt : new Date().toISOString(),
  lastResumedAt: isResume ? new Date().toISOString() : undefined,
  endedAt: null,
  exitCode: null,
  // Clear any stale error from a prior (failed) run; re-set on this run only if
  // codex fails again. (undefined → omitted by JSON.stringify)
  error: undefined,
}
const writeMeta = () => { try { writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n') } catch { /* ignore */ } }
writeMeta()

// Hold ONE append fd each for the transcript and the progress log (avoids the per-call
// open/close cost of appendFileSync on tool-heavy streams).
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
  backend: 'codex',
  threadId: meta.threadId,
  state: 'running', // running | done | error
  lastTool: null,
  toolCounts: {},
  events: 0,
  startedAt: meta.startedAt,
  lastActivityAt: new Date().toISOString(),
  finalResultPreview: '',
  usage: null,
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
flushStatus() // initial snapshot, written immediately

const progressToStderr = process.env.CX_PROGRESS_STDERR === '1'
const appendProgress = (line) => {
  if (progressFd >= 0) { try { writeSync(progressFd, line + '\n') } catch { /* ignore */ } }
  if (progressToStderr) { try { process.stderr.write(line + '\n') } catch { /* ignore */ } }
}

const clip = (s, n) => { const o = String(s).replace(/\s+/g, ' ').trim(); return o.length > n ? o.slice(0, n) + '…' : o }
const touch = () => { status.lastActivityAt = new Date().toISOString(); status.events++ }

let finalText = ''        // last agent_message text (the running/final answer)
let errorText = ''        // surfaced error/turn.failed message
const emittedItems = new Set()

// Bump the tool counter + record lastTool for a named tool/item kind.
const countTool = (name) => {
  status.lastTool = name
  status.toolCounts[name] = (status.toolCounts[name] ?? 0) + 1
}

// One-liner for a single item (item.started / item.updated / item.completed).
// Defensive: unknown item.type → generic line; never crash on an absent field.
function renderItem(item, phase) {
  if (!item || typeof item !== 'object') return
  const t = item.type ?? 'item'
  // De-dupe on item id + phase so item.started/updated/completed each emit at most once.
  const key = (item.id ?? '') + ':' + t + ':' + phase
  if (item.id != null) { if (emittedItems.has(key)) return; emittedItems.add(key) }

  switch (t) {
    case 'agent_message': {
      const text = typeof item.text === 'string' ? item.text : ''
      if (text.trim()) {
        finalText = text
        if (phase === 'completed') appendProgress(`· ${clip(text, 200)}`)
      }
      touch(); writeStatus()
      return
    }
    case 'reasoning': {
      const text = typeof item.text === 'string' ? item.text
        : (typeof item.summary === 'string' ? item.summary : '')
      if (phase === 'completed' && text.trim()) appendProgress(`✻ ${clip(text, 120)}`)
      touch()
      return
    }
    case 'command_execution': {
      const cmd = item.command ?? item.cmd ?? ''
      const st = item.exit_code ?? item.exitCode ?? item.status
      if (phase === 'completed' || phase === 'started') {
        const suffix = (phase === 'completed' && st != null) ? ` (exit ${st})` : ''
        appendProgress(`$ ${clip(cmd, 100)}${suffix}`)
        if (phase === 'completed') countTool('command')
      }
      touch(); writeStatus()
      return
    }
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const paths = changes.map((c) => c?.path ?? c?.file ?? '').filter(Boolean)
      const label = paths.length ? clip(paths.join(', '), 100) : (item.path ?? '')
      if (phase === 'completed') {
        appendProgress(`✎ ${clip(label, 100)}`)
        countTool('file_change')
      }
      touch(); writeStatus()
      return
    }
    case 'mcp_tool_call': {
      const name = item.tool ?? item.name ?? 'mcp'
      const server = item.server ? `${item.server}/` : ''
      if (phase === 'started' || phase === 'completed') {
        appendProgress(`▸ ${server}${name}`)
        if (phase === 'completed') countTool(`mcp:${name}`)
      }
      touch(); writeStatus()
      return
    }
    case 'web_search': {
      const q = item.query ?? item.q ?? ''
      if (phase === 'completed' || phase === 'started') appendProgress(`🔎 ${clip(q, 100)}`)
      if (phase === 'completed') countTool('web_search')
      touch(); writeStatus()
      return
    }
    case 'todo_list': {
      const items = Array.isArray(item.items) ? item.items : (Array.isArray(item.todos) ? item.todos : [])
      if (phase === 'completed') appendProgress(`☑ todo (${items.length})`)
      touch()
      return
    }
    case 'error': {
      // codex sometimes reports a turn failure as a completed item of type "error" while
      // the top-level process still exits 0. Capture it so finalize() reports state=error
      // instead of falsely finalizing as "done" with empty output.
      const msg = (typeof item.message === 'string' ? item.message : '')
        || (typeof item.error?.message === 'string' ? item.error.message : '')
        || (typeof item.error === 'string' ? item.error : '')
      if (msg) { errorText = String(msg); appendProgress(`✗ ${clip(errorText, 160)}`) }
      touch(); writeStatus()
      return
    }
    default: {
      // Unknown item type — generic, never crashes.
      if (phase === 'completed') appendProgress(`▸ ${t}`)
      touch()
      return
    }
  }
}

function handleEvent(ev) {
  if (!ev || typeof ev !== 'object') return
  const t = ev.type

  if (t === 'thread.started' && typeof ev.thread_id === 'string') {
    meta.threadId = ev.thread_id
    status.threadId = ev.thread_id
    writeMeta()
    touch(); writeStatus()
    return
  }
  if (t === 'turn.started') { touch(); return }
  if (t === 'item.started') { renderItem(ev.item, 'started'); return }
  if (t === 'item.updated') { renderItem(ev.item, 'updated'); return }
  if (t === 'item.completed') { renderItem(ev.item, 'completed'); return }
  if (t === 'turn.completed') {
    if (ev.usage && typeof ev.usage === 'object') status.usage = ev.usage
    touch(); writeStatus()
    return
  }
  if (t === 'turn.failed' || t === 'error') {
    const msg = ev.error?.message ?? ev.message ?? (typeof ev.error === 'string' ? ev.error : '') ?? ''
    if (msg) { errorText = String(msg); appendProgress(`✗ ${clip(errorText, 160)}`) }
    touch(); writeStatus()
    return
  }
}

// ---- read stdin line by line ----
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
  if (progressFd >= 0) { try { closeSync(progressFd) } catch { /* ignore */ } progressFd = -1 }
  const out = finalText
  // errorText is AUTHORITATIVE: a turn-level error (turn.failed / top-level error /
  // item.type:"error") means the turn failed even if codex's process exited 0 and even
  // if a partial agent_message was emitted. Only a clean run with no errorText is "done".
  if (errorText) status.state = 'error'
  else if (out) status.state = 'done'
  else status.state = (code === 0 ? 'done' : 'error')
  if (status.state === 'error' && errorText) status.error = errorText
  status.finalResultPreview = (out || '').replace(/\s+/g, ' ').slice(0, 300)
  status.lastActivityAt = new Date().toISOString()
  flushStatus() // force the final snapshot (cancels any pending throttled write)
  meta.endedAt = new Date().toISOString()
  meta.exitCode = code ?? 0
  meta.state = status.state
  if (status.state === 'error' && errorText) meta.error = errorText
  writeMeta()
  // Print the final text to stdout — the caller gets the answer here (cx-stream prefers
  // the -o file but falls back to this).
  if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n')
}

process.stdin.on('end', () => finalize(0))
process.stdin.on('error', () => finalize(1))
