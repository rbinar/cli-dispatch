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

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeMetaFile, createStatusWriter, openSessionFiles, humanSize, clip, readJsonFile, TERMINAL_STATES, pruneSessionRoot } from './parse-utils.mjs'

const dir = process.env.CLAUDE_DS_SESSION_DIR
if (!dir) {
  process.stderr.write('ds-stream-parse: CLAUDE_DS_SESSION_DIR not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

// Passive cap on finished session dirs (see parse-utils.mjs's pruneSessionRoot). Runs once
// per session, right after this dir exists so it is never its own prune target. Live
// sessions are never touched, verdicts are archived first, and any failure is swallowed —
// a housekeeping cap must not be able to break the run that triggered it.
try { pruneSessionRoot(path.dirname(dir), { keepDir: dir }) } catch { /* never fatal */ }

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
  backend: 'deepseek',
  parentSessionId: meta.parentSessionId || process.env.CLAUDE_CODE_SESSION_ID || '',
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
const writeMeta = () => writeMetaFile(metaFile, meta)
writeMeta()

// FD management: delegated to parse-utils openSessionFiles (held append fds, resume marker).
const progressToStderr = process.env.CLAUDE_DS_PROGRESS_STDERR === '1'
const { writeTranscript, appendProgress, closeAll } = openSessionFiles(
  transcriptFile, progressFile, isResume,
  { progressToStderr }
)

// ---- rolling state ----
const status = {
  sessionId: path.basename(dir),
  backend: 'deepseek',
  state: 'running', // running | done | error
  lastTool: null,
  toolCounts: {},
  events: 0,
  startedAt: meta.startedAt,
  lastActivityAt: new Date().toISOString(),
  finalResultPreview: '',
  usage: null,
  usagePartial: false,
}
// status.json throttled writes — delegated to parse-utils createStatusWriter.
const { flush: flushStatus, write: writeStatus } = createStatusWriter(statusFile, status)
flushStatus() // initial snapshot, written immediately

const emittedToolUseIds = new Set()
const emittedToolResultIds = new Set()
const seenUsageMsgIds = new Set()
const usageAccum = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
let finalText = ''
let streamedText = ''
let pendingText = '' // coalesced streamed text; flushed as a single terse progress line

// appendProgress — from openSessionFiles above (mirrors to stderr when CLAUDE_DS_PROGRESS_STDERR=1)

// Flush streamed text to progress.log as a single truncated line (cost-conscious).
const flushPending = () => {
  const t = pendingText.trim()
  pendingText = ''
  if (!t) return
  appendProgress(`· ${clip(t, 200)}`)
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

// humanSize — imported from parse-utils.mjs

const touch = () => { status.lastActivityAt = new Date().toISOString(); status.events++ }

function handleEvent(ev) {
  // Init/system event: confirm session_id + the model the API actually reports
  // (more honest than the env echo of the requested model).
  if (ev.type === 'system' && typeof ev.session_id === 'string') {
    meta.sessionId = ev.session_id
    status.sessionId = ev.session_id
    // Don't clobber a wrapper label that already embeds the stream's model (e.g.
    // "deepseek-v4-pro (high)" from --effort); only correct a genuine mismatch.
    if (typeof ev.model === 'string' && ev.model && !(meta.model || '').startsWith(ev.model)) meta.model = ev.model
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
    const msg = ev.message
    const content = msg?.content
    const mid = msg?.id
    const u = msg?.usage
    if (u && typeof u === 'object' && (!mid || !seenUsageMsgIds.has(mid))) {
      if (mid) seenUsageMsgIds.add(mid)
      usageAccum.input_tokens += u.input_tokens || 0
      usageAccum.output_tokens += u.output_tokens || 0
      usageAccum.cache_creation_input_tokens += u.cache_creation_input_tokens || 0
      usageAccum.cache_read_input_tokens += u.cache_read_input_tokens || 0
      status.usage = { ...usageAccum }
      status.usagePartial = true
      writeStatus()
    }
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
    const u = ev.usage && typeof ev.usage === 'object' ? { ...ev.usage } : {}
    const cost = ev.cost ?? ev.cost_usd ?? ev.total_cost_usd ?? ev.usage?.cost ?? ev.usage?.cost_usd ?? ev.usage?.total_cost_usd
    if (cost !== undefined) u.cost = cost
    const input = ev.input_tokens ?? ev.prompt_tokens ?? ev.usage?.input_tokens ?? ev.usage?.prompt_tokens
    const output = ev.output_tokens ?? ev.completion_tokens ?? ev.usage?.output_tokens ?? ev.usage?.completion_tokens
    if (input !== undefined) u.input_tokens = input
    if (output !== undefined) u.output_tokens = output
    
    if (Object.keys(u).length > 0) {
      status.usage = u
      status.usagePartial = false
    }
    touch()
    writeStatus()
    return
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
  flushPending() // before closeAll — appendProgress no-ops once the fd is closed
  closeAll()
  const out = finalText || streamedText

  // Reconcile-race guard (see cp-stream-parse.mjs finalize for the full rationale). On a
  // wrapper-level kill/timeout, stream-utils.sh's reconcile_session_error() writes a TERMINAL
  // error/killed record to status.json while this parser is still alive; the parser's later
  // stdin-EOF finalize would otherwise clobber it with "done"/exitCode:0. If the on-disk record
  // is already a terminal FAILURE (error/killed, never the success state 'done'), defer to it.
  const onDiskStatus = readJsonFile(statusFile)
  const reconciledTerminal = TERMINAL_STATES.has(onDiskStatus.state) && onDiskStatus.state !== 'done'
  if (reconciledTerminal) {
    status.state = onDiskStatus.state
    if (typeof onDiskStatus.error === 'string' && onDiskStatus.error) status.error = onDiskStatus.error
  } else {
    status.state = out ? 'done' : (code === 0 ? 'done' : 'error')
  }
  status.finalResultPreview = (out || '').replace(/\s+/g, ' ').slice(0, 300)
  status.lastActivityAt = new Date().toISOString()
  flushStatus() // force the final snapshot (cancels any pending throttled write)
  meta.endedAt = new Date().toISOString()
  const onDiskMeta = reconciledTerminal ? readJsonFile(metaFile) : {}
  meta.exitCode = (reconciledTerminal && Number.isInteger(onDiskMeta.exitCode)) ? onDiskMeta.exitCode : (code ?? 0)
  meta.state = status.state
  if (status.state === 'error' && status.error) meta.error = status.error
  writeMeta()
  // Print the final text to stdout — the caller (background task) gets the answer here.
  if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n')
}

process.stdin.on('end', () => finalize(0))
process.stdin.on('error', () => finalize(1))
