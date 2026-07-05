#!/usr/bin/env node
// oc-stream-parse.mjs — OpenCode (via OpenRouter) JSONL event parser.
//
// Reads an `opencode run --format json` JSONL stream from stdin, mirrors
// cx-stream-parse.mjs / ds-stream-parse.mjs / ag-transcript-parse.mjs, and writes the SAME
// session-dir layout the other backends use so /cli-dispatch:watch / sessions work for all
// backends uniformly:
//
//   transcript.jsonl — raw JSONL (full fidelity; for resume/audit, NOT read while polling)
//   progress.log     — terse human-readable stream (tool calls + truncated text)
//   status.json      — compact rolling summary (the ONLY file the orchestrator polls)
//   meta.json        — prompt preview, cwd, branch, model, backend, threadId, start/end, exit
//
// Unlike codex, OpenCode has NO `-o <file>` clean-output flag — this parser's captured
// finalText, printed to stdout as its own last action, is oc-stream's ONLY source of the
// final answer.
//
// Config comes via env (set by oc-stream):
//   OC_SESSION_DIR   (required) — session directory
//   OC_PROMPT_PREVIEW, OC_CWD, OC_BRANCH, OC_MODEL, OC_THREAD_ID
//   OC_RESUME        ("1" → append to transcript/progress, keep existing meta)
//   OC_PROGRESS_STDERR ("1" → mirror each progress line to stderr too, for oc-agent)
//
// Observed --format json event shapes (confirmed hands-on, a handful of live runs — not
// exhaustive; re-verify with a live OPENROUTER_API_KEY if behavior seems off):
//   {"type":"step_start","sessionID":"...","part":{...,"type":"step-start"}}
//   {"type":"tool_use","sessionID":"...","part":{"type":"tool","tool":"write","callID":"...",
//     "state":{"status":"completed","input":{...},"output":"...", ...}}}
//   {"type":"text","sessionID":"...","part":{"type":"text","text":"...","time":{...}}}
//   {"type":"step_finish","sessionID":"...","part":{"reason":"stop"|"tool-calls",
//     "tokens":{"total":...,"input":...,"output":...},"cost":0}}
//   {"type":"error","sessionID":"...","error":{"name":"UnknownError"|"APIError",
//     "data":{"message":"...","ref":"..."}}}    <-- NOTE: error payload is at the EVENT's
//     top level (ev.error), there is NO "part" field on this event at all (unlike every
//     other event type above).
// `text` parts arrived as one complete block (not streaming deltas) in every observed run,
// so finalText is an OVERWRITE, not a concatenation. If a future run shows incremental delta
// chunks instead, this overwrite assumption would need revisiting.

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeMetaFile, createStatusWriter, openSessionFiles, clip } from './parse-utils.mjs'

const dir = process.env.OC_SESSION_DIR
if (!dir) {
  process.stderr.write('oc-stream-parse: OC_SESSION_DIR not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

const isResume = process.env.OC_RESUME === '1'
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
  backend: 'opencode',
  threadId: process.env.OC_THREAD_ID ?? meta.threadId ?? '',
  promptPreview: process.env.OC_PROMPT_PREVIEW ?? meta.promptPreview ?? '',
  cwd: process.env.OC_CWD ?? meta.cwd ?? '',
  branch: process.env.OC_BRANCH ?? meta.branch ?? '',
  model: process.env.OC_MODEL ?? meta.model ?? '',
  startedAt: isResume && meta.startedAt ? meta.startedAt : new Date().toISOString(),
  lastResumedAt: isResume ? new Date().toISOString() : undefined,
  endedAt: null,
  exitCode: null,
  // Clear any stale error from a prior (failed) run; re-set on this run only if
  // opencode fails again. (undefined → omitted by JSON.stringify)
  error: undefined,
}
const writeMeta = () => writeMetaFile(metaFile, meta)
writeMeta()

// FD management: delegated to parse-utils openSessionFiles (held append fds, resume marker).
const progressToStderr = process.env.OC_PROGRESS_STDERR === '1'
const { writeTranscript, appendProgress, closeAll } = openSessionFiles(
  transcriptFile, progressFile, isResume,
  { progressToStderr }
)

// ---- rolling state ----
const status = {
  sessionId: path.basename(dir),
  backend: 'opencode',
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
// status.json throttled writes — delegated to parse-utils createStatusWriter.
const { flush: flushStatus, write: writeStatus } = createStatusWriter(statusFile, status)
flushStatus() // initial snapshot, written immediately

// appendProgress — from openSessionFiles above (mirrors to stderr when OC_PROGRESS_STDERR=1)
// clip — imported from parse-utils.mjs
const touch = () => { status.lastActivityAt = new Date().toISOString(); status.events++ }

let finalText = ''        // last text part (the running/final answer) — OVERWRITE, not concat
let errorText = ''        // surfaced error message, if OpenCode ever emits one at top level
const emittedTools = new Set()

// Bump the tool counter + record lastTool for a named tool.
const countTool = (name) => {
  status.lastTool = name
  status.toolCounts[name] = (status.toolCounts[name] ?? 0) + 1
}

function handlePart(type, sessionID, part, topError) {
  if (typeof sessionID === 'string' && sessionID && !meta.threadId) {
    meta.threadId = sessionID
    status.threadId = sessionID
    writeMeta()
  }

  // Opportunistic: opencode's documented event shapes carry no model field, but if a
  // future version surfaces one (part.info.modelID / part.modelID), record it so the
  // dashboard can show the model actually used. No-op otherwise.
  const mid = part?.info?.modelID ?? part?.modelID
  if (typeof mid === 'string' && mid && !meta.model) { meta.model = mid; writeMeta() }

  switch (type) {
    case 'step_start': {
      // First occurrence captures sessionID (handled above); later occurrences just touch.
      touch(); writeStatus()
      return
    }
    case 'tool_use': {
      if (!part || typeof part !== 'object') { touch(); return }
      const callID = part.callID ?? ''
      const toolName = part.tool ?? 'tool'
      const st = part.state && typeof part.state === 'object' ? part.state : {}
      const statusStr = st.status ?? ''
      // De-dupe on callID + status so a completed/error state per call is only reported once.
      const key = callID + ':' + statusStr
      if (callID && emittedTools.has(key)) { touch(); return }
      if (callID) emittedTools.add(key)

      if (statusStr === 'completed') {
        const input = st.input && typeof st.input === 'object' ? st.input : {}
        const title = input.filePath ?? input.path ?? input.command ?? input.title ?? JSON.stringify(input)
        appendProgress(`✎ ${toolName} ${clip(title, 100)}`)
        countTool(toolName)
      } else if (statusStr === 'error') {
        const msg = st.error ?? st.output ?? 'tool error'
        if (st.metadata && st.metadata.interrupted === true) {
          const label = (toolName === 'unknown' && callID) ? callID : toolName
          appendProgress(`⚠ interrupted: ${label}`)
        } else {
          errorText = String(msg)
          appendProgress(`✗ ${toolName}: ${clip(errorText, 160)}`)
        }
      } else if (statusStr === 'running' || statusStr === 'pending') {
        appendProgress(`▸ ${toolName}`)
      }
      touch(); writeStatus()
      return
    }
    case 'text': {
      const text = part && typeof part.text === 'string' ? part.text : ''
      if (text.trim()) {
        // Confirmed one-shot (not streaming deltas) in every observed run — overwrite.
        finalText = text
        appendProgress(`· ${clip(text, 200)}`)
      }
      touch(); writeStatus()
      return
    }
    case 'step_finish': {
      if (part && typeof part === 'object') {
        if (part.tokens && typeof part.tokens === 'object') {
          status.usage = { tokens: part.tokens, cost: part.cost ?? 0 }
        }
      }
      touch(); writeStatus()
      return
    }
    case 'error': {
      // Confirmed 2026-07-02 against a live OPENROUTER_API_KEY: OpenCode DOES emit a
      // top-level {"type":"error","sessionID":"...","error":{"name":...,"data":{"message":
      // "...","ref":"..."}}} event on a turn failure (bad model slug, no tool-use-capable
      // endpoint, upstream 5xx, etc). Reproduced with both an invalid model slug
      // ("UnknownError" / "Unexpected server error...") and a valid model whose OpenRouter
      // endpoint didn't support tool use ("APIError" / "No endpoints found that support tool
      // use..."). Critically, the error payload lives at the EVENT's top level (ev.error),
      // NOT nested under ev.part like every other event type — `part` is undefined here, so
      // the old `part.message ?? part.error` read always missed it and fell back to the
      // generic "unknown error" string. state:"error" still got set correctly (not a false
      // success), but the useful diagnostic was lost. Read topError (ev.error) first, with
      // the old part-based read kept as a defensive fallback for any other shape.
      const err = topError && typeof topError === 'object' ? topError : {}
      const data = err.data && typeof err.data === 'object' ? err.data : {}
      const msg = (typeof data.message === 'string' && data.message)
        || (typeof err.message === 'string' && err.message)
        || (typeof err.name === 'string' && err.name)
        || (part && (part.message ?? part.error))
        || 'unknown error'
      errorText = String(msg)
      appendProgress(`✗ ${clip(errorText, 160)}`)
      touch(); writeStatus()
      return
    }
    default: {
      // Unrecognized event type — generic fallback line, never crash.
      appendProgress(`▸ ${type ?? 'event'}`)
      touch()
      return
    }
  }
}

function handleEvent(ev) {
  if (!ev || typeof ev !== 'object') return
  // ev.error is only meaningful for type:"error" events (see the confirmed shape note
  // above) — handlePart's other cases ignore the extra arg.
  handlePart(ev.type, ev.sessionID, ev.part, ev.error)
}

// ---- read stdin line by line ----
// Non-JSON line leakage (banners, ANSI) into --format json stdout is low risk per the plan —
// unparseable lines are simply skipped, never crash the parser.
let lineBuf = ''
process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk) => {
  lineBuf += chunk
  const lines = lineBuf.split('\n')
  lineBuf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    writeTranscript(line + '\n')
    try { handleEvent(JSON.parse(line)) } catch { /* not JSON — ignore, per plan's tolerance guard */ }
  }
})

function finalize(code) {
  if (lineBuf.trim()) {
    writeTranscript(lineBuf + '\n')
    try { handleEvent(JSON.parse(lineBuf)) } catch { /* ignore */ }
    lineBuf = ''
  }
  closeAll()
  const out = finalText
  // errorText is AUTHORITATIVE (mirrors cx-stream-parse.mjs's finalize logic): a reported
  // tool-state error or top-level error event means the turn failed even if the opencode
  // process exited 0. Only a clean run with no errorText is "done".
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
  // Print the final text to stdout — this is oc-stream's SOLE source of the answer (OpenCode
  // has no -o <file> equivalent to codex's clean-output flag).
  if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n')
}

process.stdin.on('end', () => finalize(0))
process.stdin.on('error', () => finalize(1))
