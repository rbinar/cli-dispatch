// parse-utils.mjs — shared helpers for JSONL stream parsers.
//
// Imported by ag-transcript-parse.mjs, ds-stream-parse.mjs, cx-stream-parse.mjs.
// Provides throttled status.json writing, session file fd management, and small
// formatting utilities that were duplicated across the three backends.

import { writeFileSync, readFileSync, openSync, writeSync, closeSync } from 'node:fs'

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

// ---- throttled status writer ----

// Factory: returns { flush, write } bound to `status` (mutated in-place by the
// caller) and `statusFile`. Writes are throttled to ~throttleMs to avoid hitting
// disk on every event in a burst.
export function createStatusWriter(statusFile, status, { throttleMs = 200 } = {}) {
  let lastWrite = 0
  let timer = null

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    lastWrite = Date.now()
    try { writeFileSync(statusFile, JSON.stringify(status, null, 2) + '\n') } catch { /* ignore */ }
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
  try { writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n') } catch { /* ignore */ }
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
export function writeJsonFile(file, obj) {
  try { writeFileSync(file, JSON.stringify(obj, null, 2) + '\n') } catch { /* ignore */ }
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
  return status
}

// Refresh takeover.lastHeartbeat for an in-progress takeover. No-op (does not
// write, returns the status unchanged) if the session has no active takeover —
// callers that need a hard failure should check status.takeover?.active
// themselves before calling this.
export function touchTakeoverHeartbeat(statusFile, { now = new Date().toISOString() } = {}) {
  const status = readJsonFile(statusFile)
  if (!status.takeover) return status
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
