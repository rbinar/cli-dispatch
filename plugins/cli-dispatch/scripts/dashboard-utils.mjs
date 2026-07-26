// dashboard-utils.mjs — pure helper functions extracted from dashboard-server.mjs.
//
// These are the file-reading / process-tree / transcript-mapping helpers that had real
// bugs fixed in the past (fd leaks in readHead/readTail, pgrep error-vs-no-children
// confusion in collectProcTree, missing model tracking in mapFlow) but had zero unit
// test coverage because they lived inline in the giant HTTP server file. Extracted here
// verbatim (same bodies, same logic) purely so they can be imported and unit-tested in
// isolation — dashboard-server.mjs imports these instead of defining them locally.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const FLOW_CAP = 400          // max events returned per flow request

// Read first ~maxBytes of a file (for the opening user prompt).
export function readHead(file, maxBytes = 16384) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(maxBytes)
    const n = fs.readSync(fd, buf, 0, maxBytes, 0)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}
// Read last ~maxBytes of a file (for the latest event / activity).
export function readTail(file, maxBytes = 65536) {
  let fd
  try {
    const st = fs.statSync(file)
    const start = Math.max(0, st.size - maxBytes)
    fd = fs.openSync(file, 'r')
    const len = st.size - start
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, start)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}
export const lines = (s) => s.split('\n').filter((l) => l.trim())
export const clip = (s, n = 140) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }

// Like clip(), but for text whose LINE STRUCTURE is the payload — a verify command's output
// tail, for instance. clip() collapses all whitespace, which would turn a failing test report
// into one unreadable line, so it must not be used for these.
//
// verdict-writer.mjs's tailText() caps the tail at 40 LINES with no byte limit, so a single
// pathological line (a minified bundle in an error message) can still be megabytes. Cap both.
export function clipLines(s, maxLines = 40, maxBytes = 8192) {
  let text = String(s == null ? '' : s).replace(/\r\n/g, '\n')
  if (!text) return ''
  const all = text.split('\n')
  let truncated = false
  if (all.length > maxLines) {
    text = all.slice(all.length - maxLines).join('\n')
    truncated = true
  }
  if (text.length > maxBytes) {
    // Keep the END of the text: for a failure tail the last lines are the informative ones.
    text = text.slice(text.length - maxBytes)
    truncated = true
  }
  return truncated ? '…\n' + text : text
}

// Pull a readable preview out of a message.content that may be string or block array.
export function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === 'text' && b.text) return b.text
      if (typeof b === 'string') return b
    }
  }
  return ''
}

// ---- flow mapper (shared by session + subagent transcripts) ----
export function sumUsageFromEvents(evs) {
  const seenMsgIds = new Set()
  let inTok = 0, outTok = 0, haveUsage = false
  for (const e of evs) {
    if (e && e.type === 'assistant') {
      const c = e.message && e.message.content
      if (Array.isArray(c)) {
        const mid = e.message && e.message.id
        const u = e.message && e.message.usage
        if (u && (!mid || !seenMsgIds.has(mid))) {
          if (mid) seenMsgIds.add(mid)
          inTok += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          outTok += (u.output_tokens || 0)
          haveUsage = true
        }
      }
    }
  }
  return { inTok, outTok, haveUsage }
}

export function mapFlow(file) {
  if (!fs.existsSync(file)) return { steps: [], total: 0, truncated: false, model: '' }
  const all = lines(readTail(file, 4 * 1024 * 1024))   // cap memory; big files keep their tail
  const total = all.length
  const slice = all.slice(Math.max(0, all.length - FLOW_CAP))
  const evs = []
  for (const l of slice) { try { evs.push(JSON.parse(l)) } catch {} }
  // pass 1: toolUseId -> agentId (subagent links live on the following user event)
  const agentOf = {}
  for (const e of evs) {
    const tur = e.toolUseResult
    if (tur && tur.agentId) {
      const c = e.message && e.message.content
      if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result' && b.tool_use_id) agentOf[b.tool_use_id] = tur.agentId
    }
  }
  const resultOf = {}   // tool_use_id -> {ok, text}
  for (const e of evs) {
    const c = e.message && e.message.content
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result' && b.tool_use_id)
      resultOf[b.tool_use_id] = { ok: !b.is_error, text: clip(contentText(b.content), 160) }
  }
  let model = ''
  const steps = []
  for (const e of evs) {
    const ts = e.timestamp || null
    const c = e.message && e.message.content
    if (e.type === 'user') {
      if (typeof c === 'string') { if (!e.isMeta) steps.push({ kind: 'prompt', ts, text: clip(c, 400) }) }
      // tool_result blocks are folded into their tool step below; skip standalone
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      if (e.message && e.message.model) { model = e.message.model }
      for (const b of c) {
        if (b.type === 'text' && b.text) steps.push({ kind: 'message', ts, text: clip(b.text, 400) })
        else if (b.type === 'thinking' && b.thinking) steps.push({ kind: 'thinking', ts, text: clip(b.thinking, 300) })
        else if (b.type === 'tool_use') {
          const res = resultOf[b.id]
          steps.push({
            kind: 'tool', ts, name: b.name,
            summary: toolSummary(b.name, b.input),
            ok: res ? res.ok : null,
            result: res ? res.text : '',
            spawnsAgent: (b.name === 'Agent' || b.name === 'Task') ? (agentOf[b.id] || null) : null,
          })
        }
      }
    }
  }
  const { inTok, outTok, haveUsage } = sumUsageFromEvents(evs)
  return { steps, total, truncated: total > slice.length, usage: haveUsage ? { inTok, outTok } : null, model: model || '' }
}

export function toolSummary(_name, input) {
  if (!input || typeof input !== 'object') return ''
  if (input.command) return clip(input.command, 120)
  if (input.file_path) return clip(input.file_path, 120)
  if (input.pattern) return clip(input.pattern, 120)
  if (input.description) return clip(input.description, 120)
  if (input.prompt) return clip(input.prompt, 120)
  if (input.url) return clip(input.url, 120)
  if (input.query) return clip(input.query, 120)
  const k = Object.keys(input)[0]
  return k ? clip(k + '=' + JSON.stringify(input[k]), 120) : ''
}

// FIX 1 helpers — kill the pre-existing HEADLESS worker process tree before spawning the
// interactive takeover PTY. cx-stream now writes $dir/worker.pid (the whole cx-stream
// process TREE root; see C1). We mirror stream-utils.sh's proc_tree/kill_worker: snapshot
// the full descendant set FIRST (recursive `pgrep -P`), then TERM the captured list, wait,
// then KILL survivors from that SAME captured list — so children reparented mid-kill are
// not missed.
export function collectProcTree(rootPid) {
  const all = []
  let loggedError = false
  const childPidsFromPs = (pid) => {
    const r = spawnSync('ps', ['-axo', 'ppid=,pid='], { encoding: 'utf8' })
    if (!r || r.error || r.status !== 0 || !r.stdout) {
      const msg = r && r.error ? (r.error.message || String(r.error)) : 'ps failed'
      throw new Error(msg)
    }
    const children = []
    for (const line of r.stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/)
      if (!m) continue
      if (Number(m[1]) === pid) children.push(Number(m[2]))
    }
    return children
  }
  const childPidsFromActiveHandles = (pid) => {
    if (pid !== process.pid || typeof process._getActiveHandles !== 'function') return []
    return process._getActiveHandles()
      .filter(h => h && h.constructor && h.constructor.name === 'ChildProcess')
      .map(h => h.pid)
      .filter(child => Number.isInteger(child) && child > 0)
  }
  const childPids = (pid) => {
    let r
    let spawnError = null
    try {
      r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      if (!r) {
        spawnError = 'result is undefined'
      } else if (r.error) {
        spawnError = r.error.message || String(r.error)
      } else if (r.status === null) {
        spawnError = 'status is null'
      }
    } catch (err) {
      spawnError = err.message || String(err)
    }
    if (!spawnError && r && r.status === 0 && r.stdout) {
      return r.stdout.split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(child => Number.isInteger(child) && child > 0)
    }
    if (!spawnError && r && r.status === 1 && !r.stdout && !r.stderr) return []
    try {
      return childPidsFromPs(pid)
    } catch (err) {
      spawnError = spawnError || (err.message || String(err))
    }
    const activeChildren = childPidsFromActiveHandles(pid)
    if (activeChildren.length) return activeChildren
    if (spawnError && !loggedError) {
      console.error('dashboard: pgrep/ps unavailable — process tree may be incomplete: ' + spawnError)
      loggedError = true
    }
    return []
  }
  const visit = (pid) => {
    all.push(pid)
    for (const child of childPids(pid)) visit(child)
  }
  visit(rootPid)
  return all
}

// ---- deterministic-runner artifacts (verdict.json / changed-files.json) ----
//
// Only `cli-dispatch-run` writes verdict.json, and only once the session has reached a terminal
// state, so its PRESENCE is the single available signal that a session came through the
// deterministic runner. That signal is positive-only: a run killed before the verdict is written
// leaves none, so "no verdict" means "no verdict was recorded", never "this was not a run".
//
// Both readers take the session DIRECTORY, build their own paths, and return null for
// missing-or-unparseable input. Neither ever reads transcript.jsonl, and neither ever follows
// verdict.diffPatchPath — that field is an absolute path read out of a file written by five
// external CLIs, so treating it as a path to open would be an arbitrary-file-read primitive.

// cli-dispatch-run's exit-code contract (.specs/dev/sdd/deterministic-runner.md).
const VERDICT_OUTCOMES = {
  0: 'pass',
  1: 'verify-failed',
  2: 'error',
  3: 'timeout',
  4: 'human-controlled',
  5: 'setup-error',
}

// 124 is verdict-writer's own timeout code; 126/127 are the shell's "not executable" / "not
// found". All three mean the CHECK never ran, which is neither a pass nor a failure of the work.
const VERIFY_HARNESS_EXITS = new Set([124, 126, 127])

function verifyStateFor(exitCode) {
  if (!Number.isFinite(exitCode)) return 'unknown'
  if (exitCode === 0) return 'pass'
  if (VERIFY_HARNESS_EXITS.has(exitCode)) return 'harness'
  return 'fail'
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// Normalizes verdict.json's `verify` and status.json's older `{cmd, exit, tail}` shape into one
// object. verdict.json wins; status.verify is a fallback for sessions that never got a verdict.
function normalizeVerify(raw, source) {
  if (!raw || typeof raw !== 'object') return null
  const commands = Array.isArray(raw.commands)
    ? raw.commands.slice(0, 20).map((c) => clip(c, 200))
    : (raw.cmd ? [clip(raw.cmd, 200)] : [])
  const exitCode = num(raw.exitCode ?? raw.exit)
  // runVerify stops at the first failure, so failedAt indexes the command that broke.
  let failedAt = num(raw.failedAt)
  if (failedAt == null && exitCode != null && exitCode !== 0) failedAt = 0
  return {
    source,
    commands,
    exitCode,
    failedAt,
    state: verifyStateFor(exitCode),
    tail: clipLines(raw.tail),
  }
}

export function readVerdict(sessionDir, { statusVerify } = {}) {
  const raw = readJsonOrNull(path.join(sessionDir, 'verdict.json'))
  if (!raw || typeof raw !== 'object') return null

  // cli-dispatch-run writes {schemaVersion, error, sessionId, exitCode} when build-verdict
  // itself threw. That file is valid JSON but carries none of the real fields, and its exitCode
  // is a node exit status rather than the 0-5 contract value — so it must never be read as one.
  // A future schema we do not understand is treated the same way: unknown, not assumed-passing.
  const schemaVersion = num(raw.schemaVersion)
  const buildError = typeof raw.error === 'string' && raw.error ? raw.error : ''
  const malformed = !!buildError || (schemaVersion != null && schemaVersion > 1) || !raw.state

  if (malformed) {
    return {
      malformed: true,
      error: buildError,
      exitCode: null,
      outcome: 'unknown',
      verify: null,
      changedFiles: [],
      stranded: false,
      branch: '',
      baseRef: '',
      worktree: '',
      backend: normalizeBackendLocal(raw.backend),
      model: typeof raw.model === 'string' ? raw.model : '',
      state: typeof raw.state === 'string' ? raw.state : '',
      completedVia: '',
      diffstat: '',
      recordedAt: typeof raw.endedAt === 'string' ? raw.endedAt : '',
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    }
  }

  const exitCode = num(raw.exitCode)
  const verify = normalizeVerify(raw.verify, 'verdict')
    || normalizeVerify(statusVerify, 'status')
  return {
    malformed: false,
    error: '',
    exitCode,
    outcome: (exitCode != null && VERDICT_OUTCOMES[exitCode]) || 'unknown',
    verify,
    changedFiles: Array.isArray(raw.changedFiles) ? raw.changedFiles.map(String) : [],
    // Recorded at run end, NOT live truth: verdict-writer's hasStrandedChanges() also returns
    // false when `git status` throws, so false conflates "clean tree" with "could not tell".
    // Only `true` carries information; callers must not render `false` as a positive claim.
    stranded: raw.stranded === true,
    branch: typeof raw.branch === 'string' ? raw.branch : '',
    baseRef: typeof raw.baseRef === 'string' ? raw.baseRef : '',
    worktree: typeof raw.worktree === 'string' ? raw.worktree : '',
    backend: normalizeBackendLocal(raw.backend),
    model: typeof raw.model === 'string' ? raw.model : '',
    state: typeof raw.state === 'string' ? raw.state : '',
    completedVia: typeof raw.completedVia === 'string' ? raw.completedVia : '',
    diffstat: clip(raw.diffstat, 120),
    recordedAt: typeof raw.endedAt === 'string' ? raw.endedAt : '',
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
  }
  // NB: worktreeRemoved is deliberately absent. verdict-writer.mjs hardcodes it to false and
  // nothing ever rewrites the file (cli-dispatch-run cleans the worktree AFTER writing it), so
  // forwarding a field that is structurally always false would only invite the UI to render it.
}

// Local copy of the mapping to keep this module import-free of parse-utils; kept tiny and in
// sync deliberately (parse-utils.normalizeBackend is the canonical one).
const BACKEND_SHORT = new Set(['ds', 'ag', 'cx', 'oc', 'cp'])
const BACKEND_LONG = { deepseek: 'ds', antigravity: 'ag', codex: 'cx', opencode: 'oc', copilot: 'cp' }
function normalizeBackendLocal(value) {
  const b = String(value ?? '').toLowerCase()
  if (BACKEND_SHORT.has(b)) return b
  return BACKEND_LONG[b] ?? null
}

const CHANGED_FILE_CAP = 500
const PREEXISTING_CAP = 100

// changed-files.json is written for EVERY worktree-mode worker, not just runs (48 of 120 session
// dirs here have one, vs 13 verdicts), and it keeps two things verdict.changedFiles drops: the
// per-file M/A/D/?? status, and preexistingDirty — paths already dirty before the worker started,
// i.e. explicitly not its work. That attribution cannot be reconstructed from anywhere else.
export function readChangedFiles(sessionDir) {
  const raw = readJsonOrNull(path.join(sessionDir, 'changed-files.json'))
  if (!raw || typeof raw !== 'object') return null
  const rawFiles = Array.isArray(raw.files) ? raw.files : []
  const files = rawFiles.slice(0, CHANGED_FILE_CAP).map((f) => ({
    path: String(f && f.path != null ? f.path : ''),
    status: String(f && f.status != null ? f.status : ''),
  }))
  const preexisting = Array.isArray(raw.preexistingDirty) ? raw.preexistingDirty : []
  return {
    source: 'changed-files.json',
    diffstat: clip(raw.diffstat, 120),
    files,
    truncated: rawFiles.length > CHANGED_FILE_CAP,
    preexistingDirty: preexisting.slice(0, PREEXISTING_CAP).map(String),
  }
}
