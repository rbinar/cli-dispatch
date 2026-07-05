#!/usr/bin/env node
// cp-stream-parse.mjs — GitHub Copilot JSONL event parser.
//
// Reads a `copilot -p ... --output-format json` JSONL stream from stdin, mirrors
// cx-stream-parse.mjs / ds-stream-parse.mjs / ag-transcript-parse.mjs, and writes the SAME
// session-dir layout the other backends use so /cli-dispatch:watch / sessions work for all
// backends uniformly:
//
//   transcript.jsonl — raw JSONL (full fidelity; for resume/audit, NOT read while polling)
//   progress.log     — terse human-readable stream (tool calls + truncated text)
//   status.json      — compact rolling summary (the ONLY file the orchestrator polls)
//   meta.json        — prompt preview, cwd, branch, model, backend, threadId, start/end, exit
//
// Unlike codex, GitHub Copilot has NO `-o <file>` clean-output flag — this parser's captured
// finalText, printed to stdout as its own last action, is cp-stream's ONLY source of the
// final answer.
//
// Config comes via env (set by cp-stream):
//   CP_SESSION_DIR   (required) — session directory
//   CP_PROMPT_PREVIEW, CP_CWD, CP_BRANCH, CP_MODEL, CP_THREAD_ID
//   CP_RESUME        ("1" → append to transcript/progress, keep existing meta)
//   CP_PROGRESS_STDERR ("1" → mirror each progress line to stderr too, for cp-agent)
//
// Copilot's JSONL event schema is not documented. This parser is deliberately defensive:
// unknown event types are ignored, malformed lines are skipped, and raw U+2028/U+2029 are
// stripped from the copy passed to JSON.parse.

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeMetaFile, createStatusWriter, openSessionFiles, clip } from './parse-utils.mjs'

const dir = process.env.CP_SESSION_DIR
if (!dir) {
  process.stderr.write('cp-stream-parse: CP_SESSION_DIR not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

const isResume = process.env.CP_RESUME === '1'
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
  backend: 'copilot',
  threadId: process.env.CP_THREAD_ID ?? meta.threadId ?? '',
  promptPreview: process.env.CP_PROMPT_PREVIEW ?? meta.promptPreview ?? '',
  cwd: process.env.CP_CWD ?? meta.cwd ?? '',
  branch: process.env.CP_BRANCH ?? meta.branch ?? '',
  model: process.env.CP_MODEL ?? meta.model ?? '',
  startedAt: isResume && meta.startedAt ? meta.startedAt : new Date().toISOString(),
  lastResumedAt: isResume ? new Date().toISOString() : undefined,
  endedAt: null,
  exitCode: null,
  // Clear any stale error from a prior (failed) run; re-set on this run only if
  // copilot fails again. (undefined → omitted by JSON.stringify)
  error: undefined,
}
const writeMeta = () => writeMetaFile(metaFile, meta)
writeMeta()

// FD management: delegated to parse-utils openSessionFiles (held append fds, resume marker).
const progressToStderr = process.env.CP_PROGRESS_STDERR === '1'
const { writeTranscript, appendProgress, closeAll } = openSessionFiles(
  transcriptFile, progressFile, isResume,
  { progressToStderr }
)

// ---- rolling state ----
const status = {
  sessionId: path.basename(dir),
  backend: 'copilot',
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

// appendProgress — from openSessionFiles above (mirrors to stderr when CP_PROGRESS_STDERR=1)
// clip — imported from parse-utils.mjs
const touch = () => { status.lastActivityAt = new Date().toISOString(); status.events++ }

let finalText = ''        // captured answer text; deltas append, complete messages overwrite
let errorText = ''        // surfaced error message, if GitHub Copilot emits one
const emittedTools = new Set()
const toolMeta = new Map() // toolCallId -> { name, args } — learned from tool.execution_start
                            // or assistant.message's nested toolRequests[], consulted by handleTool()
                            // for events (like tool.execution_complete) that omit name/args.

// Bump the tool counter + record lastTool for a named tool.
const countTool = (name) => {
  status.lastTool = name
  status.toolCounts[name] = (status.toolCounts[name] ?? 0) + 1
}

const firstString = (...xs) => xs.find((x) => typeof x === 'string' && x.trim())
const asObj = (x) => x && typeof x === 'object' ? x : {}

function learnSession(ev, body) {
  if (meta.threadId) return
  const id = firstString(
    ev.sessionID, ev.sessionId, ev.session_id, ev.threadId, ev.thread_id,
    ev.conversationId, ev.conversation_id, asObj(ev.session).id,
    body.sessionID, body.sessionId, body.session_id, body.threadId, body.conversationId
  )
  if (id) {
    meta.threadId = id
    status.threadId = id
    writeMeta()
  }
}

function learnModel(ev, body) {
  const mid = firstString(
    ev.model, ev.modelID, ev.modelId, ev.model_id,
    asObj(ev.info).modelID, asObj(ev.info).modelId,
    body.model, body.modelID, body.modelId, body.model_id,
    asObj(body.info).modelID, asObj(body.info).modelId,
    asObj(ev.payload).model, asObj(ev.data).model
  )
  if (mid && (!meta.model || meta.model === process.env.CP_MODEL)) {
    meta.model = mid
    writeMeta()
  }
}

function learnToolMeta(body) {
  if (body.toolCallId && (body.toolName || body.arguments)) {
    const prev = toolMeta.get(body.toolCallId) || {}
    toolMeta.set(body.toolCallId, {
      name: body.toolName ?? prev.name,
      args: asObj(body.arguments ?? prev.args),
    })
  }
  const reqs = Array.isArray(body.toolRequests) ? body.toolRequests : []
  for (const req of reqs) {
    const id = req && req.toolCallId
    if (!id) continue
    const prev = toolMeta.get(id) || {}
    toolMeta.set(id, {
      name: firstString(req.name, req.tool, req.toolName) ?? prev.name,
      args: asObj(req.arguments ?? req.input ?? prev.args),
    })
  }
}

function textFrom(ev, body) {
  const msg = asObj(ev.message)
  const delta = asObj(ev.delta)
  return firstString(
    ev.text, ev.content, ev.markdown, ev.answer, ev.finalText, ev.final_text, ev.message,
    body.text, body.content, body.markdown, body.answer, body.finalText, body.final_text,
    msg.text, msg.content, delta.text, delta.content
  ) || ''
}

function errorFrom(ev, body) {
  const err = asObj(ev.error)
  const data = asObj(err.data)
  return firstString(
    data.message, err.message, err.name, ev.message, ev.errorMessage, ev.error_message,
    body.error, body.message, body.errorMessage, body.error_message
  )
}

function usageFrom(ev, body) {
  const u = asObj(ev.usage)
  const tokens = ev.tokens ?? body.tokens ?? u.tokens
  if (tokens && typeof tokens === 'object') {
    const input = tokens.input ?? tokens.prompt_tokens ?? tokens.promptTokens ?? tokens.input_tokens ?? tokens.inputTokens
    const output = tokens.output ?? tokens.completion_tokens ?? tokens.completionTokens ?? tokens.output_tokens ?? tokens.outputTokens
    const total = tokens.total ?? tokens.total_tokens ?? tokens.totalTokens ?? tokens.tokenCount ?? (typeof input === 'number' && typeof output === 'number' ? input + output : undefined)
    status.usage = {
      tokens: { input, output, total },
      cost: body.cost ?? ev.cost ?? u.cost ?? 0
    }
  } else {
    const input = ev.prompt_tokens ?? ev.promptTokens ?? ev.input_tokens ?? ev.inputTokens ??
                  body.prompt_tokens ?? body.promptTokens ?? body.input_tokens ?? body.inputTokens ??
                  u.prompt_tokens ?? u.promptTokens ?? u.input_tokens ?? u.inputTokens
    const output = ev.completion_tokens ?? ev.completionTokens ?? ev.output_tokens ?? ev.outputTokens ??
                   body.completion_tokens ?? body.completionTokens ?? body.output_tokens ?? body.outputTokens ??
                   u.completion_tokens ?? u.completionTokens ?? u.output_tokens ?? u.outputTokens
    const total = ev.total_tokens ?? ev.totalTokens ?? ev.tokenCount ??
                  body.total_tokens ?? body.totalTokens ?? body.tokenCount ??
                  u.total_tokens ?? u.totalTokens ?? u.tokenCount ??
                  (typeof input === 'number' && typeof output === 'number' ? input + output : undefined)
    if (input !== undefined || output !== undefined || total !== undefined) {
      status.usage = {
        tokens: { input, output, total },
        cost: body.cost ?? ev.cost ?? u.cost ?? 0
      }
    }
  }
}

function handleTool(type, ev, body) {
  const st = asObj(body.state)
  const callID = body.toolCallId ?? body.callID ?? body.callId ?? body.id ?? ev.callID ?? ev.callId ?? ''
  const meta = callID ? toolMeta.get(callID) : undefined
  const toolName = firstString(body.tool, body.toolName, body.name, meta && meta.name, ev.tool, ev.toolName, ev.name) || 'tool'
  const statusStr = firstString(st.status, body.status, ev.status) ||
    (type === 'tool.execution_complete' ? (body.success === false ? 'error' : 'complete') :
     type === 'tool.execution_start' ? 'start' : '')
  const key = callID + ':' + statusStr
  if (callID && emittedTools.has(key)) { touch(); return }
  if (callID) emittedTools.add(key)

  if (/complete|success|done/i.test(statusStr)) {
    const input = asObj(st.input ?? body.input ?? body.arguments ?? (meta && meta.args) ?? ev.input)
    const title = input.filePath ?? input.path ?? input.command ?? input.title ?? body.command ?? body.path ?? JSON.stringify(input)
    appendProgress(`✎ ${toolName} ${clip(title, 100)}`)
    countTool(toolName)
  } else if (/error|fail/i.test(statusStr)) {
    const result = asObj(body.result)
    const msg = st.error ?? result.error ?? body.error ?? body.message ?? 'tool error'
    errorText = String(msg)
    appendProgress(`✗ ${toolName}: ${clip(errorText, 160)}`)
  } else {
    appendProgress(`▸ ${toolName}`)
  }
  touch(); writeStatus()
}

function handleText(type, ev, body) {
  const text = textFrom(ev, body)
  if (text.trim()) {
    if (/delta|chunk|append/i.test(type) || ev.delta) finalText += text
    else finalText = text
    appendProgress(`· ${clip(text, 200)}`)
  }
  touch(); writeStatus()
}

function handleEvent(ev) {
  if (!ev || typeof ev !== 'object') return
  const type = String(ev.type ?? ev.event ?? ev.kind ?? '').toLowerCase()
  const body = asObj(ev.part ?? ev.payload ?? ev.data ?? ev.message)
  learnSession(ev, body)
  learnModel(ev, body)
  learnToolMeta(body)

  if (/error|failed|failure/.test(type)) {
    errorText = String(errorFrom(ev, body) || 'unknown error')
    appendProgress(`✗ ${clip(errorText, 160)}`)
    touch(); writeStatus()
    return
  }
  if (type === 'tool.execution_start' || type === 'tool.execution_complete' || body.tool || body.toolName) {
    handleTool(type, ev, body)
    return
  }
  if (type === 'tool.execution_partial_result') {
    touch(); writeStatus()
    return
  }
  // Reasoning/ephemeral events (e.g. assistant.reasoning, assistant.reasoning_delta) must
  // NEVER reach handleText(): they're transient "thinking" fragments, not the final answer,
  // and if they arrive late/out-of-order they'd otherwise clobber finalText via the generic
  // textFrom() fallback below. ev.ephemeral === true is Copilot's authoritative signal for
  // this; the explicit type checks are belt-and-suspenders in case a future event omits it.
  if (ev.ephemeral === true || type === 'assistant.reasoning' || type === 'assistant.reasoning_delta') {
    const text = textFrom(ev, body)
    if (text.trim()) appendProgress(`✻ ${clip(text, 120)}`)
    touch(); writeStatus()
    return
  }
  if (/text|message|answer|response|content|delta/.test(type) || textFrom(ev, body)) {
    handleText(type, ev, body)
    return
  }
  if (/finish|complete|done|usage/.test(type)) {
    usageFrom(ev, body)
    touch(); writeStatus()
    return
  }
  if (/start|session/.test(type)) {
    touch(); writeStatus()
  }
}

// ---- read stdin line by line ----
// Non-JSON line leakage (banners, ANSI) into --output-format json stdout is tolerated:
// malformed lines are skipped, never crash the parser.
let lineBuf = ''
process.stdin.setEncoding('utf8')

const sanitizeLine = (line) => line.replace(/[\u2028\u2029]/g, '')

process.stdin.on('data', (chunk) => {
  lineBuf += chunk
  const lines = lineBuf.split('\n')
  lineBuf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    writeTranscript(line + '\n')
    try { handleEvent(JSON.parse(sanitizeLine(line))) } catch { /* not JSON — ignore */ }
  }
})

function finalize(code) {
  if (lineBuf.trim()) {
    writeTranscript(lineBuf + '\n')
    try { handleEvent(JSON.parse(sanitizeLine(lineBuf))) } catch { /* ignore */ }
    lineBuf = ''
  }
  closeAll()
  const out = finalText
  // errorText is AUTHORITATIVE (mirrors cx-stream-parse.mjs's finalize logic): a reported
  // tool-state error or top-level error event means the turn failed even if the copilot
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
  // Print the final text to stdout — this is cp-stream's SOLE source of the answer (GitHub Copilot
  // has no -o <file> equivalent to codex's clean-output flag).
  if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n')
}

process.stdin.on('end', () => finalize(0))
process.stdin.on('error', () => finalize(1))
