// parse-utils.mjs — shared helpers for JSONL stream parsers.
//
// Imported by ag-transcript-parse.mjs, ds-stream-parse.mjs, cx-stream-parse.mjs.
// Provides throttled status.json writing, session file fd management, and small
// formatting utilities that were duplicated across the three backends.

import {
  writeFileSync, readFileSync, openSync, writeSync, closeSync, mkdirSync, renameSync, unlinkSync,
  readdirSync, statSync, copyFileSync, rmSync,
} from 'node:fs'
import { basename, join } from 'node:path'

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
// status.json.state is a 4-value enum: 'running' | 'done' | 'error' | 'killed'. This is the
// first place a formal enum exists for it — consumers (cli-dispatch-clean.mjs, ...)
// should import these instead of hardcoding string checks.
export const TERMINAL_STATES = new Set(['done', 'error', 'killed'])
export const NON_TERMINAL_STATES = new Set(['running'])

export function isNonTerminalState(state) {
  return NON_TERMINAL_STATES.has(state)
}

// Shared here because verdict-writer already depends on parse-utils, while standalone
// gain-report can import this small helper without pulling in the verdict writer's git and
// worker-report machinery. Both engines are installed beside parse-utils.mjs.
export function isTrivialDiffstat(diffstat) {
  if (typeof diffstat !== 'string' || !diffstat) return false
  let total = 0
  const insertions = diffstat.match(/(\d+) insertion/)
  const deletions = diffstat.match(/(\d+) deletion/)
  if (insertions) total += parseInt(insertions[1], 10)
  if (deletions) total += parseInt(deletions[1], 10)
  return total > 0 && total < 50
}

// ---- passive session-root pruning ----
//
// Session dirs accumulate forever unless someone runs /cli-dispatch:clean or installs the
// scheduled job, and most people do neither — a machine with no schedule was found holding
// 41 sessions / 54 MB. This prunes at WRITE time instead: every parser calls it once, right
// after creating its own session dir, so the floor is enforced by ordinary use with no
// scheduler and no user action.
//
// It is deliberately NOT a replacement for cli-dispatch-clean. Clean detects stale/dead
// sessions and offers an age-based sweep; this only caps how many
// FINISHED sessions pile up. Rules:
//   - a non-terminal session ('running') is NEVER removed, no matter how
//     far down the list it sorts — a live worker must survive its own sibling's prune
//   - the caller's own dir is never removed (keepDir)
//   - verdict.json / verdict-diff.patch are archived first, same layout clean.mjs uses, so
//     the only record of a deterministic run is not lost to a passive cap
//   - best-effort throughout: pruning must never break the run that triggered it
//
// CLI_DISPATCH_MAX_SESSIONS overrides the cap; 0 (or a negative/NaN value) disables pruning.
export const DEFAULT_MAX_SESSIONS = 100

export function resolveMaxSessions(env = process.env) {
  const raw = env.CLI_DISPATCH_MAX_SESSIONS
  if (raw === undefined || raw === '') return DEFAULT_MAX_SESSIONS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

export function pruneSessionRoot(root, { max = resolveMaxSessions(), keepDir = null } = {}) {
  const result = { scanned: 0, removed: [], archived: 0, kept: 0, skipped: null }
  if (!max) { result.skipped = 'disabled'; return result }

  let entries
  try { entries = readdirSync(root) } catch { result.skipped = 'unreadable-root'; return result }

  const keepName = keepDir ? basename(keepDir) : null
  const candidates = []
  for (const name of entries) {
    if (name === 'verdict-archive' || name.startsWith('.')) continue
    if (keepName && name === keepName) continue
    const dir = join(root, name)
    let st
    try { st = statSync(dir) } catch { continue }
    if (!st.isDirectory()) continue
    result.scanned++
    const status = readJsonFile(join(dir, 'status.json'))
    const meta = readJsonFile(join(dir, 'meta.json'))
    const state = status.state || meta.state || '?'
    // A session with no state at all is NOT assumed finished: a parser that died before its
    // first status write looks identical to one that never started. Leave those to
    // cli-dispatch-clean, which has the idle-time evidence to judge them.
    if (state === '?' || isNonTerminalState(state)) { result.kept++; continue }
    const startedMs = Date.parse(meta.startedAt || status.startedAt || '')
    candidates.push({ name, dir, sort: Number.isFinite(startedMs) ? startedMs : st.mtimeMs })
  }

  // Newest first; everything past the cap is surplus. The cap counts prunable (finished)
  // sessions only — live ones are kept on top of it rather than displacing history.
  candidates.sort((a, b) => b.sort - a.sort)
  const surplus = candidates.slice(max)
  if (!surplus.length) { result.kept += candidates.length; return result }
  result.kept += candidates.length - surplus.length

  const archiveRoot = join(root, 'verdict-archive')
  for (const { name, dir } of surplus) {
    let copied = false
    for (const [file, ext] of [['verdict.json', 'json'], ['verdict-diff.patch', 'patch']]) {
      const src = join(dir, file)
      try {
        if (!statSync(src).isFile()) continue
        mkdirSync(archiveRoot, { recursive: true })
        copyFileSync(src, join(archiveRoot, `${name}.${ext}`))
        copied = true
      } catch { /* nothing to archive, or the archive is unwritable — removal still proceeds */ }
    }
    if (copied) result.archived++
    try { rmSync(dir, { recursive: true, force: true }); result.removed.push(name) }
    catch { /* best-effort: a dir we cannot remove is left for cli-dispatch-clean */ }
  }
  return result
}

// ---- backend name normalization ----

// Two spellings of the same five backends coexist on disk: the stream parsers write the LONG
// name into status.json/meta.json ("codex"), while cli-dispatch-run and verdict.json use the
// SHORT form ("cx"). Any consumer that reads both files needs the mapping, so it lives here in
// the shared-contract module rather than in verdict-writer.mjs (which re-exports it for
// compatibility).
// Returns null for an unrecognised value; callers decide whether that is fatal.
const VALID_BACKENDS = new Set(['ds', 'ag', 'cx', 'oc', 'cp'])
const BACKEND_ALIASES = { deepseek: 'ds', antigravity: 'ag', codex: 'cx', opencode: 'oc', copilot: 'cp' }
export function normalizeBackend(value) {
  const b = String(value ?? '').toLowerCase()
  if (VALID_BACKENDS.has(b)) return b
  return BACKEND_ALIASES[b] ?? null
}

// ---- throttled status writer ----

// Factory: returns { flush, write } bound to `status` (mutated in-place by the
// caller) and `statusFile`. Writes are throttled to ~throttleMs to avoid hitting
// disk on every event in a burst.
export function createStatusWriter(statusFile, status, { throttleMs = 200 } = {}) {
  let lastWrite = 0
  let timer = null
  let warned = false

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    lastWrite = Date.now()
    try {
      atomicWriteFileSync(statusFile, JSON.stringify(status, null, 2) + '\n')
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
// session whose original writer process has already exited.

// Read + parse a JSON file. Best-effort: any read/parse failure yields {} (matches
// writeMetaFile's own best-effort try/catch style).
export function readJsonFile(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }
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
