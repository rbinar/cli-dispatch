// parse-utils.mjs — shared helpers for JSONL stream parsers.
//
// Imported by ag-transcript-parse.mjs, ds-stream-parse.mjs, cx-stream-parse.mjs.
// Provides throttled status.json writing, session file fd management, and small
// formatting utilities that were duplicated across the three backends.

import { writeFileSync, readFileSync, openSync, writeSync, closeSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// ---- atomic full-file write ----
//
// Write `data` to `file` atomically: write a sibling temp file in the SAME directory
// then rename it over the target, so a concurrent reader never observes a half-written
// JSON body (it sees either the old file or the new one, never a torn write). This is a
// stale-read guard, not a crash guard — there is no fsync and no lock.
//
// Windows caveat: renameSync can throw EPERM/EACCES when the target is open in another
// process. On ANY rename failure we fall back to a direct writeFileSync(file, ...) —
// exactly the pre-atomic behavior — so correctness never regresses; we only lose the
// atomicity guarantee for that one write. The temp file is best-effort unlinked in every
// path (rename success already consumes it, but a failed rename leaves it behind).
function atomicWriteFileSync(file, data) {
  const temp = `${file}.tmp-${process.pid}`
  try {
    writeFileSync(temp, data)
    renameSync(temp, file)
  } catch {
    // rename (or the temp write) failed — fall back to the original direct write.
    writeFileSync(file, data)
  } finally {
    try { unlinkSync(temp) } catch { /* already gone after a successful rename, or never created */ }
  }
}

// ---- state enum ----
//
// status.json.state is a 5-value enum (see .specs/dev/sdd/human-takeover.md, "Veri
// Modeli"): 'running' | 'done' | 'error' | 'killed' | 'human-controlled'. This is the
// first place a formal enum exists for it — consumers (dashboard-server.mjs,
// cli-dispatch-clean.mjs) should import these instead of hardcoding string checks.
export const TERMINAL_STATES = new Set(['done', 'error', 'killed'])
export const NON_TERMINAL_STATES = new Set(['running', 'human-controlled'])

export function isNonTerminalState(state) {
  return NON_TERMINAL_STATES.has(state)
}

// ---- dashboard transition sentinel ----

// The dashboard watches WORKERS_ROOT shallowly, so transitions inside an existing
// session directory also bump this direct child of WORKERS_ROOT. Best-effort only:
// status writing must never fail because this notification side channel failed.
export function bumpTransitionSentinel(statusFile, now = new Date().toISOString()) {
  try {
    const workersRoot = dirname(dirname(statusFile))
    const sentinelFile = join(workersRoot, '.cli-dispatch-transitions')
    atomicWriteFileSync(sentinelFile, String(now) + '\n')
  } catch {
    // best-effort notification only
  }
}

// ---- throttled status writer ----

// Factory: returns { flush, write } bound to `status` (mutated in-place by the
// caller) and `statusFile`. Writes are throttled to ~throttleMs to avoid hitting
// disk on every event in a burst.
export function createStatusWriter(statusFile, status, { throttleMs = 200 } = {}) {
  let lastWrite = 0
  let lastState = status.state
  let timer = null
  let warned = false

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    lastWrite = Date.now()
    try {
      atomicWriteFileSync(statusFile, JSON.stringify(status, null, 2) + '\n')
      if (status.state !== lastState) {
        bumpTransitionSentinel(statusFile)
        lastState = status.state
      }
    } catch (err) {
      // A swallowed write here leaves status.json stuck at "running" forever with no
      // trace (see stream-utils.sh's reconcile_session_error) — warn once per writer
      // so a full disk / permission error is at least visible on stderr, without
      // spamming on every ~200ms flush.
      if (!warned) {
        warned = true
        process.stderr.write(`createStatusWriter: cannot write ${statusFile}: ${err.message}\n`)
      }
    }
  }

  const write = () => {
    const since = Date.now() - lastWrite
    if (since >= throttleMs) { flush(); return }
    if (!timer) {
      timer = setTimeout(flush, throttleMs - since)
      timer.unref?.()
    }
  }

  return { flush, write }
}

// ---- session file fd management ----

// Open transcript + progress fds (append on resume, write on fresh runs).
// Returns { writeTranscript, appendProgress, closeAll }. Optionally mirrors
// each progress line to stderr when progressToStderr is true.
export function openSessionFiles(transcriptFile, progressFile, isResume, { progressToStderr = false } = {}) {
  let transcriptFd = -1, progressFd = -1
  try { transcriptFd = openSync(transcriptFile, isResume ? 'a' : 'w') } catch { /* ignore */ }
  try { progressFd = openSync(progressFile, isResume ? 'a' : 'w') } catch { /* ignore */ }

  const writeTranscript = (s) => { if (transcriptFd >= 0) { try { writeSync(transcriptFd, s) } catch { /* ignore */ } } }

  if (isResume && progressFd >= 0) {
    try { writeSync(progressFd, `\n--- resume @ ${new Date().toISOString()} ---\n`) } catch { /* ignore */ }
  }

  const appendProgress = (line) => {
    if (progressFd >= 0) { try { writeSync(progressFd, line + '\n') } catch { /* ignore */ } }
    if (progressToStderr) { try { process.stderr.write(line + '\n') } catch { /* ignore */ } }
  }

  const closeAll = () => {
    if (transcriptFd >= 0) { try { closeSync(transcriptFd) } catch { /* ignore */ } transcriptFd = -1 }
    if (progressFd >= 0) { try { closeSync(progressFd) } catch { /* ignore */ } progressFd = -1 }
  }

  return { writeTranscript, appendProgress, closeAll }
}

// ---- meta.json helper ----

// Write the meta object to metaFile (best-effort, ignores I/O errors).
export function writeMetaFile(metaFile, meta) {
  try {
    atomicWriteFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n')
  } catch (err) {
    process.stderr.write(`writeMetaFile: cannot write ${metaFile}: ${err.message}\n`)
  }
}

// ---- generic status.json / meta.json read-modify-write helpers ----
//
// Unlike createStatusWriter (an in-process throttled writer meant to be held open
// for the lifetime of a streaming backend CLI), these are plain synchronous
// read-modify-write helpers for callers OUTSIDE that writer's lifecycle — e.g. a
// dashboard-server endpoint mutating status.json/meta.json for a session whose
// original writer process has already exited.

// Read + parse a JSON file. Best-effort: any read/parse failure yields {} (matches
// writeMetaFile's own best-effort try/catch style).
export function readJsonFile(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }
}

// Write obj to file as pretty JSON (best-effort, ignores I/O errors — matches
// writeMetaFile's existing style exactly).
function writeJsonFile(file, obj) {
  try {
    atomicWriteFileSync(file, JSON.stringify(obj, null, 2) + '\n')
  } catch (err) {
    process.stderr.write(`writeJsonFile: cannot write ${file}: ${err.message}\n`)
  }
}

// ---- human-takeover state helpers ----
//
// Implements the status.json Veri Modeli from .specs/dev/sdd/human-takeover.md:
//   state: 'human-controlled'
//   completedVia: 'autonomous' | 'human-takeover'   (terminal states only)
//   takeover: { active, startedAt, host, lastHeartbeat, ptyPid, ptyPgid }
// The takeover TOKEN is NEVER written to disk by these (or any other) helpers — it is held
// only in the dashboard-server process's memory. ptyPid/ptyPgid, by contrast, are NOT
// secret and ARE persisted on purpose: they let the OUT-OF-PROCESS reaper
// (cli-dispatch-clean.mjs) kill an orphaned takeover PTY tree when dashboard-server itself
// has died and can no longer reap via its live in-memory ptyHandle.
export function markTakeoverActive(statusFile, { host, ptyPid, ptyPgid, now = new Date().toISOString() }) {
  const status = readJsonFile(statusFile)
  status.state = 'human-controlled'
  status.takeover = { active: true, startedAt: now, host, lastHeartbeat: now, ptyPid, ptyPgid }
  writeJsonFile(statusFile, status)
  bumpTransitionSentinel(statusFile)
  return status
}

// Refresh takeover.lastHeartbeat for an in-progress takeover. No-op (does not
// write, returns the status unchanged) if the session has no active takeover —
// callers that need a hard failure should check status.takeover?.active
// themselves before calling this.
export function touchTakeoverHeartbeat(statusFile, { now = new Date().toISOString() } = {}) {
  const status = readJsonFile(statusFile)
  // Reap-revival guard: only refresh the heartbeat if the takeover is STILL active as of
  // the read we just did. Between a caller's decision to heartbeat and this read, an
  // out-of-process reaper (cli-dispatch-clean.mjs) may have cleared a stale takeover —
  // transitioning state to a terminal value and deleting the takeover sub-object. Writing
  // our stale in-memory copy back would resurrect a dead 'human-controlled' session. Since
  // this check reads immediately before the write (no lock, minimal TOCTOU window), skip the
  // write entirely unless state is still 'human-controlled' with an active takeover. Returns
  // the status unchanged in the skip case (same no-op semantics as before).
  if (!(status.state === 'human-controlled' && status.takeover && status.takeover.active === true)) {
    process.stderr.write(`touchTakeoverHeartbeat: skipping heartbeat for ${statusFile} — takeover no longer active (state=${status.state})\n`)
    return status
  }
  status.takeover.lastHeartbeat = now
  writeJsonFile(statusFile, status)
  return status
}

// End a takeover, transitioning to a terminal state. Sets state (caller passes
// 'done' or 'error'), optionally completedVia and error, and removes the
// takeover sub-object entirely. Returns the updated object.
export function clearTakeoverState(statusFile, { finalState, completedVia, error } = {}) {
  const status = readJsonFile(statusFile)
  status.state = finalState
  if (completedVia !== undefined) status.completedVia = completedVia
  if (error !== undefined) status.error = error
  delete status.takeover
  writeJsonFile(statusFile, status)
  bumpTransitionSentinel(statusFile)
  return status
}

// ---- formatting utilities ----

export function humanSize(n) {
  if (n < 1024) return `${n}b`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`
  return `${(n / 1024 / 1024).toFixed(1)}mb`
}

export function clip(s, n) {
  const o = String(s).replace(/\s+/g, ' ').trim()
  return o.length > n ? o.slice(0, n) + '…' : o
}

// ---- auth classification and handling ----

export function classifyAuthFailure(exitCode, output) {
  if (exitCode === 0) {
    return { isAuthFailure: false }
  }
  const lower = String(output).toLowerCase()
  const hasAuthError = lower.includes('not logged into antigravity') ||
                       lower.includes('error getting token source') ||
                       lower.includes('authentication failed or timed out')
  return { isAuthFailure: hasAuthError }
}

export function writeAuthErrorSession(dir, errorMsg, exitCode, cwd, branch, model) {
  mkdirSync(dir, { recursive: true })
  const sId = basename(dir)
  const now = new Date().toISOString()

  const status = {
    sessionId: sId,
    backend: 'antigravity',
    convId: '',
    state: 'error',
    error: errorMsg,
    errorKind: 'auth',
    lastTool: null,
    toolCounts: {},
    events: 0,
    startedAt: now,
    lastActivityAt: now,
    finalResultPreview: '',
    usage: null,
  }

  const meta = {
    sessionId: sId,
    backend: 'antigravity',
    convId: '',
    promptPreview: '',
    cwd: cwd || '',
    branch: branch || '',
    model: model || '',
    startedAt: now,
    endedAt: now,
    exitCode: exitCode,
    state: 'error',
    error: errorMsg,
    errorKind: 'auth',
  }

  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2) + '\n')
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
}

// ---- Antigravity conversation-ownership matching (E7 race fix) --------------
//
// last_conversations.json is keyed by cwd, so two ag-stream runs in the SAME cwd both
// overwrite the same key — the cwd lookup (and "newest brain dir") can hand a run the
// SIBLING run's conversation-id, hijacking the session. These pure helpers let discovery
// verify OWNERSHIP instead of trusting timing: agy embeds the submitted prompt verbatim in
// the first USER_INPUT event's content, wrapped as <USER_REQUEST>…</USER_REQUEST> (verified
// against real agy 1.0.x transcripts), so the conversation whose first user message is OUR
// prompt is unambiguously the one THIS run launched.

// Extract the text inside the first <USER_REQUEST>…</USER_REQUEST> block, or null if absent.
export function extractUserRequest(content) {
  if (typeof content !== 'string') return null
  const m = content.match(/<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/)
  return m ? m[1] : null
}

// True iff a candidate conversation's first USER_INPUT content is OUR prompt. Prefers an
// exact match on the extracted <USER_REQUEST> block (avoids substring false-positives when
// a sibling run's prompt merely CONTAINS ours); falls back to containment only when the
// wrapper is absent (older/edge transcript shape).
export function conversationMatchesPrompt(firstUserContent, prompt) {
  if (typeof firstUserContent !== 'string' || typeof prompt !== 'string') return false
  const p = prompt.trim()
  if (!p) return false
  const req = extractUserRequest(firstUserContent)
  if (req != null) return req.trim() === p
  return firstUserContent.includes(p)
}

// Return the content of the first USER_INPUT event in a raw transcript_full.jsonl string,
// or null if the file has no readable user event yet (transcript still materializing).
export function firstUserInputContent(transcriptText) {
  if (typeof transcriptText !== 'string' || !transcriptText) return null
  for (const line of transcriptText.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let o
    try { o = JSON.parse(t) } catch { continue }
    if (o && o.type === 'USER_INPUT' && typeof o.content === 'string') return o.content
  }
  return null
}

// Given our prompt and the NEW candidate conversations (each { cid, transcriptText }), return
// the cid of the one whose first user message is our prompt, or '' if none matches (yet).
// Only ever returns a prompt-verified conversation — never a sibling run's — which is what
// closes the same-cwd hijack window.
export function selectOwnedConversation(prompt, candidates) {
  if (!Array.isArray(candidates)) return ''
  for (const c of candidates) {
    if (!c || !c.cid) continue
    const content = firstUserInputContent(c.transcriptText)
    if (content == null) continue
    if (conversationMatchesPrompt(content, prompt)) return String(c.cid)
  }
  return ''
}
