#!/usr/bin/env node
// dashboard-server.mjs — cli-dispatch dashboard.
// A self-contained local web dashboard over data that already lives on disk:
//   • active Claude Code CLI sessions → their flow → the subagents they spawned → each subagent's flow
//   • cli-dispatch worker delegations (DeepSeek / Antigravity / Codex / OpenCode / Copilot)
// Stdlib only (node:http/fs/path/os/crypto) — no npm deps, matching the existing parsers.
// Binds 127.0.0.1 ONLY. Never reads config/secrets. All :id params are path-sanitised.
// Read-only by default. An opt-in human-takeover capability, if explicitly installed,
// exposes a narrowly-scoped, authenticated write path to already-owned worker sessions
// only (no general shell, no arbitrary command) — supported for the codex, deepseek,
// antigravity, opencode, and copilot backends (see .specs/dev/sdd/human-takeover.md;
// ADR-0001/ADR-0002, both Accepted).
//
// The Claude Code on-disk formats (~/.claude/sessions, ~/.claude/projects/**) are internal
// and may change across Claude Code versions — the mappers degrade gracefully on unknown shapes.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { spawnSync, execSync } from 'node:child_process'
// NOTE: pty-host.mjs / takeover-cmd.mjs are deliberately NOT imported statically here.
// They are only needed for the opt-in human-takeover write path and install.sh does not
// ship them in every configuration — a static top-level import would ERR_MODULE_NOT_FOUND
// at module load and crash EVERY installed dashboard (takeover users or not). Instead they
// are loaded LAZILY, on first takeover, inside handleTakeover (see loadTakeoverModules).
import { PAGE } from './public-page.mjs'
import {
  FLOW_CAP, readHead, readTail, lines, clip, contentText,
  sumUsageFromEvents, mapFlow, collectProcTree
} from './dashboard-utils.mjs'
import { readJsonFile, markTakeoverActive, touchTakeoverHeartbeat, clearTakeoverState, NON_TERMINAL_STATES } from './parse-utils.mjs'

// Directory this file lives in, regardless of whether it's run in-repo or from its
// installed location (install.sh copies it + its sibling .mjs modules together) — used to
// resolve the vendored xterm.js static assets next to it (./vendor/*).
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = path.join(SELF_DIR, 'vendor')

const HOME = os.homedir()
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects')
const parentIndexCache = new Map() // keyed by CC session id -> { mtime, workerIds: string[] }
const subagentCache = new Map() // keyed by subagent file path -> { mtime, matchedWorkerIds: string[], usage: { inTok: number, outTok: number } | null }
const sessionTailCache = new Map() // keyed by CC session .jsonl path -> { mtime, head, tail, model, foundTail } — the readHead/readTail/parse result, invalidated by mtime
const CC_SESSIONS_DIR = path.join(HOME, '.claude', 'sessions')
const CACHE = process.env.XDG_CACHE_HOME || path.join(HOME, '.cache')
const WORKERS_ROOT = process.env.CLI_DISPATCH_SESSIONS_DIR || process.env.CLAUDE_DS_SESSIONS_DIR ||
  (fs.existsSync(path.join(CACHE, 'cli-dispatch', 'sessions')) || !fs.existsSync(path.join(CACHE, 'claude-ds', 'sessions'))
    ? path.join(CACHE, 'cli-dispatch', 'sessions') : path.join(CACHE, 'claude-ds', 'sessions'))

const ID_RE = /^[A-Za-z0-9._-]+$/

// ---- args ----
const argv = process.argv.slice(2)
let PORT = 7878, OPEN = true
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') PORT = parseInt(argv[++i], 10) || PORT
  else if (argv[i] === '--no-open') OPEN = false
}

// The takeover auth middleware needs the ACTUAL bound port (PORT above is only the
// requested starting port — listen() may hop forward on EADDRINUSE). Set once, in the
// listen() success callback below.
let ACTUAL_PORT = null

// ---- small fs helpers ----
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const safeStat = (p) => { try { return fs.statSync(p) } catch { return null } }
const isDir = (p) => { const s = safeStat(p); return s && s.isDirectory() }

// readHead, readTail, lines, clip — imported from dashboard-utils.mjs
const firstJSON = (txt) => { for (const l of lines(txt)) { try { return JSON.parse(l) } catch {} } return null }

function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null
  let inTok = undefined
  let outTok = undefined
  let costUsd = undefined
  if (u.tokens && typeof u.tokens === 'object') {
    inTok = u.tokens.input ?? u.tokens.prompt_tokens ?? u.tokens.promptTokens ?? u.tokens.input_tokens ?? u.tokens.inputTokens
    outTok = u.tokens.output ?? u.tokens.completion_tokens ?? u.tokens.completionTokens ?? u.tokens.output_tokens ?? u.tokens.outputTokens
  }
  if (inTok === undefined) {
    inTok = u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokens ?? u.input
  }
  if (outTok === undefined) {
    outTok = u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.completionTokens ?? u.output
  }
  costUsd = u.cost ?? u.costUsd ?? u.cost_usd ?? u.total_cost_usd
  if (inTok === undefined && outTok === undefined && costUsd === undefined) {
    return null
  }
  if (inTok !== undefined && inTok !== null) inTok = Number(inTok)
  if (outTok !== undefined && outTok !== null) outTok = Number(outTok)
  if (costUsd !== undefined && costUsd !== null) costUsd = Number(costUsd)
  return { inTok, outTok, costUsd }
}

// contentText — imported from dashboard-utils.mjs

// ---- Claude Code sessions ----
// Map sessionId -> {pid, status} from ~/.claude/sessions/<pid>.json
function liveStatusMap() {
  const m = {}
  if (!isDir(CC_SESSIONS_DIR)) return m
  for (const f of fs.readdirSync(CC_SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue
    const j = readJSON(path.join(CC_SESSIONS_DIR, f))
    if (j && j.sessionId) m[j.sessionId] = { pid: j.pid, status: j.status, updatedAt: j.updatedAt, cwd: j.cwd }
  }
  return m
}

// Locate the transcript jsonl + project dir for a session id (scan all projects).
function findSession(id) {
  if (!isDir(PROJECTS_DIR)) return null
  for (const proj of fs.readdirSync(PROJECTS_DIR)) {
    const file = path.join(PROJECTS_DIR, proj, id + '.jsonl')
    if (fs.existsSync(file)) return { id, project: proj, file, dir: path.join(PROJECTS_DIR, proj, id) }
  }
  return null
}

function subagentDir(sess) { return path.join(sess.dir, 'subagents') }
function countSubagents(sess) {
  const d = subagentDir(sess); if (!isDir(d)) return 0
  return fs.readdirSync(d).filter((f) => f.endsWith('.meta.json')).length
}

function listSessions() {
  const live = liveStatusMap()
  const out = []
  if (isDir(PROJECTS_DIR)) {
    for (const proj of fs.readdirSync(PROJECTS_DIR)) {
      const pdir = path.join(PROJECTS_DIR, proj)
      if (!isDir(pdir)) continue
      for (const f of fs.readdirSync(pdir)) {
        if (!f.endsWith('.jsonl')) continue
        const id = f.slice(0, -6)
        const file = path.join(pdir, f)
        const st = safeStat(file); if (!st) continue
        // mtime-cache the expensive per-file work (readHead + readTail + tail parse, incl. model
        // extraction) — same pattern as buildWorkerParentIndex's parentIndexCache. Reuse the prior
        // result while the file's mtime is unchanged; st.size/st.mtimeMs and live status (lv) below
        // stay fresh on every call (they're already cheap).
        let derived = sessionTailCache.get(file)
        if (!derived || derived.mtime !== st.mtimeMs) {
          const head = firstJSON(readHead(file)) || {}
          const tailTxt = readTail(file)
          const tailLines = lines(tailTxt)
          let tail = {}
          let model = null
          let foundTail = false
          for (let i = tailLines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(tailLines[i])
              if (!foundTail) {
                tail = parsed
                foundTail = true
              }
              if (parsed && parsed.type === 'assistant' && parsed.message && parsed.message.model) {
                model = parsed.message.model
                break
              }
            } catch {}
          }
          derived = { mtime: st.mtimeMs, head, tail, model }
          sessionTailCache.set(file, derived)
        }
        const { head, tail, model } = derived
        const lv = live[id]
        const sess = { id, project: proj, dir: path.join(pdir, id), file }
        out.push({
          id,
          project: proj,
          cwd: (head.cwd) || (lv && lv.cwd) || '',
          status: lv ? (lv.status || 'idle') : 'closed',
          startedAt: head.timestamp || null,
          lastActivityAt: tail.timestamp || new Date(st.mtimeMs).toISOString(),
          mtime: st.mtimeMs,
          firstPrompt: clip(contentText(head.message && head.message.content), 80),
          subagentCount: countSubagents(sess),
          sizeKB: Math.round(st.size / 1024),
          model,
        })
      }
    }
  }
  const rank = (s) => (s.status === 'busy' ? 0 : s.status === 'idle' ? 1 : 2)
  out.sort((a, b) => rank(a) - rank(b) || (b.mtime - a.mtime))
  return out
}

// sumUsageFromEvents, mapFlow — imported from dashboard-utils.mjs

// ---- subagents ----
function listSubagents(sess) {
  const d = subagentDir(sess); const out = []
  if (!isDir(d)) return out
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.meta.json')) continue
    const aid = f.replace(/^agent-/, '').replace(/\.meta\.json$/, '')
    const meta = readJSON(path.join(d, f)) || {}
    const jl = path.join(d, 'agent-' + aid + '.jsonl')
    const st = safeStat(jl)
    let model = ''
    if (st) {
      const tailTxt = readTail(jl)
      const tailLines = lines(tailTxt)
      for (let i = tailLines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(tailLines[i])
          if (parsed && parsed.type === 'assistant' && parsed.message && parsed.message.model) {
            model = parsed.message.model
            break
          }
        } catch {}
      }
    }
    out.push({
      agentId: aid,
      agentType: meta.agentType || '?',
      description: meta.description || '',
      spawnDepth: meta.spawnDepth || 1,
      startedAt: st ? new Date(st.birthtimeMs || st.mtimeMs).toISOString() : null,
      sizeKB: st ? Math.round(st.size / 1024) : 0,
      // "active" = its transcript was written very recently (still streaming).
      active: st ? (Date.now() - st.mtimeMs < 45000) : false,
      lastActivityMs: st ? st.mtimeMs : 0,
      model: model || '',
    })
  }
  return out
}

// ---- cli-dispatch workers ----
function listWorkers(skipParentIndex = false) {
  const out = []
  if (!isDir(WORKERS_ROOT)) return out
  for (const d of fs.readdirSync(WORKERS_ROOT)) {
    const dir = path.join(WORKERS_ROOT, d); if (!isDir(dir)) continue
    const m = readJSON(path.join(dir, 'meta.json')) || {}
    const s = readJSON(path.join(dir, 'status.json')) || {}
    // A worker interrupted before finalize (Ctrl-C, killed CLI, crash) leaves status.json
    // stuck at state:"running" forever. Detect that with the file's own mtime: if nothing has
    // been written for a while, the worker is no longer live — surface it as "stale" so the UI
    // doesn't show it green. (Same liveness heuristic as subagents; threshold is generous so a
    // genuinely-running-but-quiet turn isn't misflagged.) Workers write status.json on every
    // event, so a >90s gap reliably means dead.
    let mtime = 0
    try { mtime = fs.statSync(path.join(dir, 'status.json')).mtimeMs } catch {}
    const rawState = s.state || m.state || '?'
    // NB: this check is scoped to rawState === 'running' on purpose — a 'human-controlled'
    // session (a human quietly reading PTY output) has its own heartbeat-based staleness
    // concept (status.json.takeover.lastHeartbeat, reaped elsewhere), not this headless-
    // worker mtime heuristic, so it can never be misflagged stale by this line.
    const stale = rawState === 'running' && mtime > 0 && (Date.now() - mtime > 90000)
    out.push({
      id: d,
      backend: s.backend || m.backend || 'deepseek',
      state: rawState,
      stale,
      mtime,
      started: m.startedAt || '',
      cwd: m.cwd || '',
      model: m.model || '',
      prompt: clip(m.promptPreview, 80),
      lastTool: s.lastTool || null,
      events: s.events || 0,
      toolCounts: s.toolCounts || {},
      usage: normalizeUsage(s.usage),
      finalResultPreview: clip(s.finalResultPreview, 200),
    })
  }
  if (!skipParentIndex) {
    const parentIndex = buildWorkerParentIndex()
    for (const w of out) {
      w.parentSession = parentIndex.get(w.id) || null
    }
  }
  out.sort((a, b) => String(b.started).localeCompare(String(a.started)))
  return out
}

function workerUsageAggregate() {
  const out = {}
  for (const w of listWorkers(true)) {
    const backend = w.backend || 'deepseek'
    const row = out[backend] || { inputTokens: 0, outputTokens: 0, sessions: 0, noDataSessions: 0 }
    row.sessions++
    const inTok = w.usage && typeof w.usage.inTok === 'number' && Number.isFinite(w.usage.inTok) ? w.usage.inTok : null
    const outTok = w.usage && typeof w.usage.outTok === 'number' && Number.isFinite(w.usage.outTok) ? w.usage.outTok : null
    if (inTok === null && outTok === null) {
      row.noDataSessions++
    } else {
      if (inTok !== null) row.inputTokens += inTok
      if (outTok !== null) row.outputTokens += outTok
    }
    out[backend] = row
  }
  return out
}

function findStaleSessions(staleSecs) {
  const now = Date.now()
  const items = []
  if (!isDir(WORKERS_ROOT)) return items
  for (const d of fs.readdirSync(WORKERS_ROOT)) {
    const dir = path.join(WORKERS_ROOT, d)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    const st = readJSON(path.join(dir, 'status.json')) || {}
    const m = readJSON(path.join(dir, 'meta.json')) || {}
    const state = st.state || m.state || '?'
    let mtime = 0
    try { mtime = fs.statSync(path.join(dir, 'status.json')).mtimeMs } catch {}
    if (NON_TERMINAL_STATES.has(state) && mtime && (now - mtime > staleSecs * 1000)) {
      items.push({ id: d, backend: st.backend || m.backend || '?', state, idleMs: now - mtime })
    }
  }
  return items
}

function workerFlow(id) {
  const dir = path.join(WORKERS_ROOT, id)
  const steps = []
  const log = path.join(dir, 'progress.log')
  if (fs.existsSync(log)) {
    for (const l of lines(readTail(log, 256 * 1024)).slice(-FLOW_CAP)) steps.push({ kind: 'log', text: clip(l, 300) })
  }
  const s = readJSON(path.join(dir, 'status.json')) || {}
  const m = readJSON(path.join(dir, 'meta.json')) || {}
  let prompt = m.promptPreview || ''
  try { const pf = path.join(dir, 'prompt.txt'); if (fs.existsSync(pf)) { const full = fs.readFileSync(pf, 'utf8'); if (full.trim()) prompt = full } } catch {}
  return { steps, state: s.state || '?', prompt, model: m.model || '', cwd: m.cwd || '', startedAt: m.startedAt || '', finalResultPreview: clip(s.finalResultPreview, 600), usage: normalizeUsage(s.usage) }
}

// ---- routing ----
// Heuristic link: a Claude Code subagent/session that delegated to a cli-dispatch worker
// prints the worker's session id to stderr (e.g. "dir: …/sessions/<id>"), which lands in the
// transcript. Scan the transcript for any known worker id → linkable ds/ag/cx/oc worker sessions.
function linkedWorkers(file) {
  let txt = ''; try { txt = readTail(file, 2 * 1024 * 1024) } catch { return [] }
  if (!txt) return []
  const out = [], seen = new Set()
  for (const w of listWorkers()) {
    if (w.id && !seen.has(w.id) && txt.includes(w.id)) { seen.add(w.id); out.push({ id: w.id, backend: w.backend, state: w.state, stale: w.stale, model: w.model, prompt: w.prompt }) }
  }
  return out
}

function buildWorkerParentIndex() {
  const reverseMap = new Map()
  if (!isDir(PROJECTS_DIR)) return reverseMap

  const workers = listWorkers(true)
  const workerIds = workers.map(w => w.id).filter(Boolean)
  if (workerIds.length === 0) return reverseMap

  const sessions = []
  for (const proj of fs.readdirSync(PROJECTS_DIR)) {
    const pdir = path.join(PROJECTS_DIR, proj)
    if (!isDir(pdir)) continue
    for (const f of fs.readdirSync(pdir)) {
      if (!f.endsWith('.jsonl')) continue
      const sessionId = f.slice(0, -6)
      const file = path.join(pdir, f)
      try {
        const st = fs.statSync(file)
        sessions.push({ sessionId, project: proj, file, mtime: st.mtimeMs })
      } catch {}
    }
  }

  for (const s of sessions) {
    const currentMtime = s.mtime
    let workerIdsInSession = []
    const cached = parentIndexCache.get(s.sessionId)
    if (cached && cached.mtime === currentMtime) {
      workerIdsInSession = cached.workerIds
    } else {
      let txt = ''
      try { txt = readTail(s.file, 2 * 1024 * 1024) } catch {}
      if (txt) {
        for (const wid of workerIds) {
          if (txt.includes(wid)) {
            workerIdsInSession.push(wid)
          }
        }
      }
      parentIndexCache.set(s.sessionId, { mtime: currentMtime, workerIds: workerIdsInSession })
    }

    const subagentMatchesForSession = new Map()
    if (workerIdsInSession.length > 0) {
      const sDir = path.join(PROJECTS_DIR, s.project, s.sessionId)
      const subDir = path.join(sDir, 'subagents')
      if (isDir(subDir)) {
        let subagentFiles = []
        try {
          subagentFiles = fs.readdirSync(subDir)
            .filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'))
            .map(f => {
              const filePath = path.join(subDir, f)
              const agentId = f.slice(6, -6)
              let mtime = 0
              try { mtime = fs.statSync(filePath).mtimeMs } catch {}
              return { agentId, filePath, mtime }
            })
            .sort((a, b) => b.mtime - a.mtime)
        } catch {}

        for (const subFile of subagentFiles) {
          const filePath = subFile.filePath
          const currentSubMtime = subFile.mtime
          let cachedSub = subagentCache.get(filePath)

          if (!cachedSub || cachedSub.mtime !== currentSubMtime) {
            let txt = ''
            try { txt = readTail(filePath, 2 * 1024 * 1024) } catch {}
            const matchedWorkerIds = []
            let usage = null

            if (txt) {
              for (const wid of workerIdsInSession) {
                if (txt.includes(wid)) {
                  matchedWorkerIds.push(wid)
                }
              }
              if (matchedWorkerIds.length > 0) {
                const all = lines(readTail(filePath, 4 * 1024 * 1024))
                const evs = []
                for (const l of all) { try { evs.push(JSON.parse(l)) } catch {} }
                const sumRes = sumUsageFromEvents(evs)
                usage = sumRes.haveUsage ? { inTok: sumRes.inTok, outTok: sumRes.outTok } : null
              }
            }
            cachedSub = { mtime: currentSubMtime, matchedWorkerIds, usage }
            subagentCache.set(filePath, cachedSub)
          }

          for (const wid of cachedSub.matchedWorkerIds) {
            if (!subagentMatchesForSession.has(wid)) {
              subagentMatchesForSession.set(wid, {
                subagentId: subFile.agentId,
                babysitterUsage: cachedSub.usage
              })
            }
          }
        }
      }
    }

    for (const wid of workerIdsInSession) {
      const existing = reverseMap.get(wid)
      const subMatch = subagentMatchesForSession.get(wid) || { subagentId: null, babysitterUsage: null }
      // Prefer a resolved subagent-level match over a bare transcript-only match,
      // regardless of session iteration order. Once we have a resolved subagentId,
      // no later bare match can displace it (first-wins among resolved matches).
      const shouldSet =
        !existing ||
        (existing.subagentId === null && subMatch.subagentId !== null)
      if (shouldSet) {
        reverseMap.set(wid, {
          id: s.sessionId,
          project: s.project,
          subagentId: subMatch.subagentId,
          babysitterUsage: subMatch.babysitterUsage
        })
      }
    }
  }

  return reverseMap
}

function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}
const okId = (id) => typeof id === 'string' && ID_RE.test(id)

// ---- static vendor assets (xterm.js UI for human-takeover) ----
// This server has no general static-file serving — deliberately so (see the file banner:
// "no config/secret access"). This is a small, FIXED allowlist of the handful of vendored
// xterm.js files (see vendor/LICENSE-xterm.txt for provenance); the request path is looked
// up in this exact map, never used to build a filesystem path itself, so there is no
// path-traversal surface even though these files live in a real directory.
const VENDOR_FILES = {
  '/vendor/xterm.js': { file: 'xterm.js', type: 'application/javascript; charset=utf-8' },
  '/vendor/xterm.css': { file: 'xterm.css', type: 'text/css; charset=utf-8' },
  '/vendor/xterm-addon-fit.js': { file: 'xterm-addon-fit.js', type: 'application/javascript; charset=utf-8' },
}
function serveVendorAsset(pathname, res) {
  const entry = VENDOR_FILES[pathname]
  if (!entry) return send(res, 404, { error: 'not found' })
  let body
  try { body = fs.readFileSync(path.join(VENDOR_DIR, entry.file)) } catch { return send(res, 404, { error: 'not found' }) }
  res.writeHead(200, { 'Content-Type': entry.type, 'Cache-Control': 'public, max-age=31536000, immutable' })
  res.end(body)
}

// ==== human-takeover (Phase 1, Codex-only) ====================================
// See .specs/dev/sdd/human-takeover.md ("API Sözleşmeleri") and ADR-0001 (Accepted) for
// the full contract. Everything in this section is additive to the otherwise read-only
// dashboard; it is only reachable if a caller passes the shared auth checks below.

// In-memory-only registry of active takeovers, keyed by worker session id. NEVER
// persisted to disk — the single-use token lives here and nowhere else (status.json's
// `takeover` sub-object intentionally omits it; see parse-utils.mjs markTakeoverActive).
//   id -> { token, ptyHandle, host, wsSocket, wsDisconnectedAt, statusFile, progressLog, heartbeatTimer }
const takeoverRegistry = new Map()

// FIX 8: grace period, after a takeover's WebSocket disconnects (tab closed) with no
// explicit POST /handback, before dashboard-server itself reaps the still-running PTY.
// Overridable via env (read ONCE, here at module load) purely so tests can shrink it; a
// non-positive/absent value falls back to the 3-minute default (review suggested 2–5 min).
const TAKEOVER_ABANDON_MS = (() => {
  const v = parseInt(process.env.CLI_DISPATCH_TAKEOVER_ABANDON_MS || '', 10)
  return v > 0 ? v : 3 * 60 * 1000
})()

// FIX 2: lazy loader for the takeover-only sibling modules (pty-host.mjs / takeover-cmd.mjs).
// These are import()'d on first takeover and cached here so subsequent calls don't re-pay the
// dynamic-import cost. If the files are missing (dashboard installed without the takeover
// bits), the import() rejects and handleTakeover degrades to a 501 instead of crashing.
let _takeoverModules = null
async function loadTakeoverModules() {
  if (_takeoverModules) return _takeoverModules
  const [ptyHostMod, takeoverCmdMod] = await Promise.all([
    import('./pty-host.mjs'),
    import('./takeover-cmd.mjs'),
  ])
  _takeoverModules = { spawnPtyHost: ptyHostMod.spawnPtyHost, buildTakeoverCommand: takeoverCmdMod.buildTakeoverCommand }
  return _takeoverModules
}

// Bounded async sleep (unref'd) — used by killWorkerTree's poll so we NEVER block the
// event loop with a synchronous spin (this runs inside the async request handler).
const sleepMs = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.() })

// collectProcTree — imported from dashboard-utils.mjs (kill the pre-existing HEADLESS
// worker process tree before spawning the interactive takeover PTY; see FIX 1 notes there).

// Async so the brief inter-signal wait yields the event loop instead of blocking it. TERM
// the whole snapshot, poll up to ~1.5s (15 × 100ms, stopping early once all are gone), then
// KILL any survivors from the same captured list.
async function killWorkerTree(rootPid) {
  const pids = collectProcTree(rootPid)
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  for (let i = 0; i < 15; i++) {
    let anyAlive = false
    for (const pid of pids) { try { process.kill(pid, 0); anyAlive = true; break } catch { /* ESRCH */ } }
    if (!anyAlive) break
    await sleepMs(100)
  }
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
}

// ---- shared auth middleware (TL15/TL16, ADR-0001 §3) ----
//
// Pure core check, reusable for both the plain-HTTP path (POST /takeover, /handback) and
// the raw-socket WS-upgrade path (GET /pty/<id>) — those two transports need different
// rejection mechanics (JSON response vs. raw socket write + destroy), so the actual
// Origin/Host/header validation logic lives here ONCE and each transport gets a thin
// wrapper below.
function validateTakeoverRequest(req, { requireCustomHeader }) {
  if (ACTUAL_PORT == null) return { ok: false, reason: 'server not ready' }
  const origin = req.headers.origin
  const expectedOrigins = [`http://127.0.0.1:${ACTUAL_PORT}`, `http://localhost:${ACTUAL_PORT}`]
  if (!origin || !expectedOrigins.includes(origin)) return { ok: false, reason: 'bad origin' }
  // Host is checked INDEPENDENTLY of Origin (defense-in-depth, TL15) — do not skip this
  // just because Origin passed.
  const host = req.headers.host
  const expectedHosts = [`127.0.0.1:${ACTUAL_PORT}`, `localhost:${ACTUAL_PORT}`]
  if (!host || !expectedHosts.includes(host)) return { ok: false, reason: 'bad host' }
  if (requireCustomHeader) {
    // Node lowercases incoming header names in req.headers already. This header is the
    // PRIMARY CSRF-DoS defense (TL13/TL16): it is not a CORS-simple header, so a
    // cross-origin browser page is forced into a preflight (OPTIONS) first; since this
    // server never answers preflights with an Access-Control-Allow-* grant, the browser
    // never sends the real request at all — the Origin/Host checks above are secondary,
    // defense-in-depth only (they matter if the request DOES arrive, e.g. from a
    // non-browser client).
    if (req.headers['x-cli-dispatch-takeover'] !== '1') return { ok: false, reason: 'missing takeover header' }
  }
  return { ok: true }
}

// Plain-HTTP wrapper: writes a JSON rejection + ends the response, returns false. Callers
// must `return` immediately when this returns false (the response has already been sent).
function checkTakeoverAuth(req, res, { requireCustomHeader }) {
  const result = validateTakeoverRequest(req, { requireCustomHeader })
  if (!result.ok) { send(res, 403, { error: 'forbidden: ' + result.reason }); return false }
  return true
}

// Raw-socket wrapper for the WS-upgrade path: no `res` object exists during 'upgrade', so
// rejection means writing a bare HTTP status line straight to the socket and destroying
// it — never call send()/res.end() here.
function rejectUpgrade(socket, code, text) {
  try { socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`) } catch { /* ignore */ }
  try { socket.destroy() } catch { /* ignore */ }
}

// ---- terminal-state helper (single source of truth for ending a takeover) ----
//
// Called from exactly two places: the handback handler (explicit, human-initiated) and a
// PTY's own onExit callback registered by the takeover handler (unexpected death). Both
// paths converge here so status.json is written exactly once per takeover, never twice —
// the registry deletion below doubles as the re-entrancy guard (whichever path runs
// first "wins"; the other finds the entry already gone and no-ops).
function finalizeTakeover(id, { finalState, completedVia, error } = {}) {
  const entry = takeoverRegistry.get(id)
  if (!entry) return
  takeoverRegistry.delete(id)
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
  clearTakeoverState(entry.statusFile, { finalState, completedVia, error })
  try { fs.appendFileSync(entry.progressLog, `--- handback @ ${new Date().toISOString()} ---\n`) } catch { /* ignore */ }
}

// FIX 8: dashboard-server's OWN in-process reaper for ABANDONED takeovers — a browser tab
// that connected the WS then closed it WITHOUT POSTing /handback. There, the per-connection
// heartbeat timer is cleared (bridgePty teardown) but the PTY keeps running AND
// dashboard-server is still alive+healthy, so the out-of-process backstop
// (cli-dispatch-clean.mjs) won't step in. We scan the registry every 60s and, for any entry
// whose WS disconnected more than TAKEOVER_ABANDON_MS ago, kill the REAL live ptyHandle and
// finalize. Started once here at module load. A takeover that has NEVER had a WS connect
// (wsDisconnectedAt === null, set at entry creation and only ever stamped by bridgePty's
// teardown) is NEVER reaped here — only a connected-then-disconnected one is. .unref() so
// this timer alone never keeps the process alive (matching the heartbeatTimer style).
// Scan cadence: 60s by default. It only shrinks below 60s if TAKEOVER_ABANDON_MS is
// configured shorter than that (via env, for tests) — so a short grace is honored promptly
// instead of waiting up to a full minute for the next tick, while the production default
// (3-min grace) keeps the plain 60s cadence.
const _reapScanMs = Math.min(60000, TAKEOVER_ABANDON_MS)
const _abandonReaper = setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of takeoverRegistry) {
    if (entry.wsDisconnectedAt == null) continue                       // never connected, or currently bridged
    if (now - entry.wsDisconnectedAt < TAKEOVER_ABANDON_MS) continue   // still within grace
    try { entry.ptyHandle.kill() } catch { /* ignore */ }
    finalizeTakeover(id, {
      finalState: 'error',
      completedVia: 'human-takeover',
      error: 'takeover abandoned (no reconnect within grace period after disconnect)',
    })
  }
}, _reapScanMs)
_abandonReaper.unref?.()

// ---- POST /api/worker/<id>/takeover ----
async function handleTakeover(req, res, rawId) {
  if (!checkTakeoverAuth(req, res, { requireCustomHeader: true })) return
  const id = decodeURIComponent(rawId)
  if (!okId(id)) return send(res, 400, { error: 'bad id' })
  const dir = path.resolve(path.join(WORKERS_ROOT, id))
  if (!dir.startsWith(path.resolve(WORKERS_ROOT) + path.sep) || !isDir(dir)) return send(res, 404, { error: 'not found' })

  // FIX 3: re-entrancy guard. If a takeover is already active for this session, reject the
  // duplicate POST immediately — before spawning a second PTY / kill / second registry entry.
  if (takeoverRegistry.has(id)) return send(res, 409, { error: 'takeover already active for this session' })

  const statusFile = path.join(dir, 'status.json')
  const metaFile = path.join(dir, 'meta.json')
  const progressLog = path.join(dir, 'progress.log')

  const status = readJsonFile(statusFile)
  if (status.state !== 'running') return send(res, 409, { error: 'session is not running' })

  const meta = readJsonFile(metaFile)
  // DeepSeek's stream-parser never writes a `backend` field into meta.json at all, so on
  // disk `meta.backend` is `undefined` for DeepSeek sessions — fall back the same way the
  // session-list mapper already does elsewhere in this file (see `s.backend || m.backend ||
  // 'deepseek'` in the worker-list endpoint).
  const backend = meta.backend || 'deepseek'
  const SUPPORTED_TAKEOVER_BACKENDS = ['codex', 'deepseek', 'antigravity', 'opencode', 'copilot']
  if (!SUPPORTED_TAKEOVER_BACKENDS.includes(backend)) return send(res, 409, { error: 'takeover not supported for backend "' + backend + '"' })

  // OpenCode precondition: channel-split risk between `opencode.db` and `opencode-stable.db`
  // — fail clean (before the registry reservation below) if neither session store exists.
  if (backend === 'opencode') {
    const ocDataDir = process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, 'opencode')
      : path.join(os.homedir(), '.local/share/opencode')
    const hasStore = fs.existsSync(path.join(ocDataDir, 'opencode.db')) || fs.existsSync(path.join(ocDataDir, 'opencode-stable.db'))
    if (!hasStore) return send(res, 409, { error: 'session store missing' })
  }

  // FIX 3 (cont.): RESERVE the registry slot SYNCHRONOUSLY — right here, before the first
  // `await` below. The bare `has()` check above is not enough on its own: this handler is
  // async and yields at each `await` (module load, worker-tree kill, pty spawn), so two
  // near-simultaneous POSTs would BOTH pass has()==false before either reached the old
  // `set()` (which sat after all those awaits) — a TOCTOU that spawned two PTYs. Reserving
  // the slot now (still ptyHandle-less, so the WS upgrade path — which requires
  // entry.ptyHandle — rejects until we fill it) means the second POST, which only starts
  // running once we hit the first await, sees has()==true and gets 409. wsDisconnectedAt
  // starts null (never-connected) and is only ever stamped by bridgePty's teardown, so the
  // abandoned-takeover reaper never touches this reservation while it's being set up.
  const entry = { token: null, ptyHandle: null, host: null, wsSocket: null, wsDisconnectedAt: null, statusFile, progressLog, heartbeatTimer: null }
  takeoverRegistry.set(id, entry)
  // Any early-return AFTER this point must release the reservation, or the session wedges
  // (every future POST would 409 forever). All failure exits below go through releaseAndFail.
  const releaseAndFail = (code, obj) => { takeoverRegistry.delete(id); return send(res, code, obj) }

  // FIX 2: lazily load the takeover-only modules. Do this BEFORE killing the headless worker
  // so a dashboard that never shipped the takeover bits degrades cleanly (501) without ever
  // disrupting a running worker.
  let spawnPtyHost, buildTakeoverCommand
  try {
    ({ spawnPtyHost, buildTakeoverCommand } = await loadTakeoverModules())
  } catch {
    return releaseAndFail(501, { error: 'human-takeover not installed on this dashboard (pty-host.mjs/takeover-cmd.mjs missing)' })
  }

  // FIX 1: kill the pre-existing HEADLESS worker process tree BEFORE spawning the takeover
  // PTY (correctness + speed — cx-stream also self-defends per C1, but we don't rely on the
  // race). cx-stream writes $dir/worker.pid (sibling of status.json/meta.json) — the whole
  // cx-stream process TREE root (codex + parser + wrapper). Snapshot its subtree, TERM, wait,
  // KILL (see collectProcTree/killWorkerTree above).
  const workerPidFile = path.join(dir, 'worker.pid')
  let workerPid = null
  try { workerPid = parseInt(fs.readFileSync(workerPidFile, 'utf8').trim(), 10) } catch { /* missing → handled below */ }
  if (Number.isInteger(workerPid) && workerPid > 0) {
    let alive = true
    try { process.kill(workerPid, 0) } catch { alive = false }   // ESRCH on the very first check → already dead
    if (alive) await killWorkerTree(workerPid)
    else console.error(`[takeover ${id}] worker.pid ${workerPid} already exited — proceeding without killing a prior process (older session predating this fix, or already finished)`)
  } else {
    console.error(`[takeover ${id}] no worker.pid found — proceeding without killing a prior process (older session predating this fix, or already finished)`)
  }

  // Copilot needs a GH token on the environment for `gh`-backed auth; mirror cp-stream's
  // bash helper (stream-utils.sh maybe_export_gh_token) exactly — opt-out via
  // CLI_DISPATCH_NO_GH_TOKEN, respect an already-set token, tolerate `gh` being missing or
  // failing, never throw/block the request path on failure.
  if (backend === 'copilot') {
    if (!process.env.COPILOT_GITHUB_TOKEN && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN && !process.env.CLI_DISPATCH_NO_GH_TOKEN) {
      try {
        const tok = execSync('gh auth token', { encoding: 'utf8' }).trim()
        if (tok) process.env.GH_TOKEN = tok
      } catch (e) {
        console.error(`[takeover ${id}] gh auth token fallback failed (non-fatal, proceeding without GH_TOKEN): ${String((e && e.message) || e)}`)
      }
    }
  }

  let cmd
  try {
    cmd = buildTakeoverCommand(backend, meta)
  } catch (e) {
    return releaseAndFail(500, { error: 'failed to build takeover command: ' + String((e && e.message) || e) })
  }

  let ptyHandle
  try {
    ptyHandle = await spawnPtyHost({ ...cmd, cols: 80, rows: 24 })
  } catch (e) {
    return releaseAndFail(500, { error: 'failed to spawn pty: ' + String((e && e.message) || e) })
  }

  // Fill in the reservation now that the PTY is live (entry is already in the registry).
  const token = crypto.randomBytes(32).toString('base64url')
  const host = `127.0.0.1:${ACTUAL_PORT}`
  entry.token = token
  entry.ptyHandle = ptyHandle
  entry.host = host

  // FIX 4: persist the PTY child's pid/pgid so the out-of-process reaper (cli-dispatch-
  // clean.mjs) can kill an orphaned tree if dashboard-server itself dies. Not secret (unlike
  // the token) — safe to write to disk.
  try {
    markTakeoverActive(statusFile, { host, ptyPid: ptyHandle.pid, ptyPgid: ptyHandle.pgid })
  } catch (e) {
    try { entry.ptyHandle.kill() } catch { /* ignore */ }
    return releaseAndFail(500, { error: 'failed to mark takeover active: ' + String((e && e.message) || e) })
  }
  try { fs.appendFileSync(progressLog, `--- human takeover @ ${new Date().toISOString()} ---\n`) } catch { /* ignore */ }

  // If the PTY dies on its own (crash, `exit` typed inside codex, etc.) — not via an
  // explicit POST /handback — this is the ONE place that writes the terminal status.json
  // state for that case (see finalizeTakeover's doc comment above; the WS bridge's own
  // onExit listener, registered separately in bridgePty(), only notifies the browser and
  // must never also call finalizeTakeover/clearTakeoverState — that would double-write).
  ptyHandle.onExit((code) => {
    finalizeTakeover(id, {
      finalState: code === 0 ? 'done' : 'error',
      completedVia: 'human-takeover',
      error: code === 0 ? undefined : (code === -1 ? "failed to start: worker's working directory no longer exists" : 'takeover ended abnormally'),
    })
  })

  return send(res, 200, { ws: `/pty/${id}`, token, cols: 80, rows: 24 })
}

// ---- POST /api/worker/<id>/handback ----
function handleHandback(req, res, rawId) {
  if (!checkTakeoverAuth(req, res, { requireCustomHeader: true })) return
  const id = decodeURIComponent(rawId)
  if (!okId(id)) return send(res, 400, { error: 'bad id' })
  const entry = takeoverRegistry.get(id)
  if (!entry) return send(res, 404, { error: 'no active takeover for this session' })

  // codex's interactive resume has no documented graceful "/exit" slash-command guarantee
  // (see the SDD's per-backend table) — a plain kill() is acceptable for Phase 1.
  // pty-host.mjs's kill() already does TERM-then-KILL internally (node-pty mode) or a
  // full process-group TERM-then-KILL (script-fallback mode), so this is not a bare
  // SIGKILL.
  try { entry.ptyHandle.kill() } catch { /* ignore */ }

  // The human explicitly asked to hand back, so this is by definition a clean/intentional
  // end — only a PTY that died UNEXPECTEDLY *before* handback was requested is "abnormal"
  // (that path is handleTakeover's own ptyHandle.onExit listener, above).
  finalizeTakeover(id, { finalState: 'done', completedVia: 'human-takeover' })

  return send(res, 200, { state: 'done' })
}

// ---- hand-rolled RFC6455 WebSocket framing (stdlib-only; ADR-0001/SDD "Teknoloji Seçimleri") ----
//
// Phase 1 simplification, documented per the SDD: only single-frame text messages are
// handled (realistic for keystroke/resize-sized control messages and PTY-output chunks);
// multi-frame fragmentation is NOT implemented.

function sendWsFrame(socket, strPayload) {
  const payload = Buffer.from(strPayload, 'utf8')
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.alloc(2); header[0] = 0x81; header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2)
  }
  try { socket.write(Buffer.concat([header, payload])) } catch { /* ignore — e.g. socket already closed */ }
}
function sendWsClose(socket, code = 1000) {
  const buf = Buffer.alloc(4); buf[0] = 0x88; buf[1] = 2; buf.writeUInt16BE(code, 2)
  try { socket.write(buf) } catch { /* ignore */ }
}
function sendWsPong(socket, payload) {
  const header = Buffer.alloc(2); header[0] = 0x8a; header[1] = payload.length
  try { socket.write(Buffer.concat([header, payload])) } catch { /* ignore */ }
}

// Parses client→server frames off `socket` (always masked per RFC6455 — unmasked here).
// `onMessage(str)` fires per complete text frame; `onClose()` fires on a close frame or
// socket-level close/error/end. NOTE the 'end' case is load-bearing (FIX 8): when a browser
// tab is closed, the client half-closes (sends a FIN) and the OS-level socket emits 'end'
// but may NOT emit 'close' for a while (the write side stays open until we end() it). Without
// wiring 'end' too, teardown — and therefore the abandoned-takeover reaper's wsDisconnectedAt
// stamp — would never fire on a closed tab. doClose is idempotent, so also-firing on the
// later 'close' is harmless.
function attachWsFrameParser(socket, onMessage, onClose) {
  let buf = Buffer.alloc(0)
  let closed = false
  const doClose = () => { if (closed) return; closed = true; onClose() }
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      const b1 = buf[1]
      const masked = !!(b1 & 0x80)
      let len = b1 & 0x7f
      let offset = 2
      if (len === 126) {
        if (buf.length < offset + 2) return
        len = buf.readUInt16BE(offset); offset += 2
      } else if (len === 127) {
        if (buf.length < offset + 8) return
        len = Number(buf.readBigUInt64BE(offset)); offset += 8
      }
      let maskKey = null
      if (masked) {
        if (buf.length < offset + 4) return
        maskKey = buf.subarray(offset, offset + 4); offset += 4
      }
      if (buf.length < offset + len) return
      let payload = buf.subarray(offset, offset + len)
      if (masked) {
        const unmasked = Buffer.alloc(len)
        for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4]
        payload = unmasked
      }
      const opcode = buf[0] & 0x0f
      buf = buf.subarray(offset + len)
      if (opcode === 0x8) { doClose(); return }               // close
      else if (opcode === 0x9) { sendWsPong(socket, payload) } // ping -> pong
      else if (opcode === 0xa) { /* pong received, ignore */ }
      else if (opcode === 0x1) { onMessage(payload.toString('utf8')) }
      // binary/continuation frames: not needed for Phase 1 (keystrokes/resize/output are
      // all single-frame text), silently ignored.
    }
  })
  socket.on('close', doClose)
  socket.on('error', doClose)
  socket.on('end', doClose)   // FIX 8: half-close (client tab closed → FIN) — see doc comment above
}

// RFC6455 handshake + bridge wiring for GET /pty/<id>, called once auth/token have
// already passed in the 'upgrade' handler below.
function performWsHandshake(req, socket, entry) {
  const key = req.headers['sec-websocket-key']
  if (!key) return rejectUpgrade(socket, 400, 'Bad Request')
  const acceptKey = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
  )
  entry.wsSocket = socket
  // FIX 8: a WS (re)connecting clears any pending abandonment timer — this entry is live again.
  entry.wsDisconnectedAt = null
  bridgePty(socket, entry)
}

function bridgePty(socket, entry) {
  const { ptyHandle, statusFile } = entry

  // Capture THIS bridge's own heartbeat timer in a local (not only entry.heartbeatTimer) so
  // teardown clears exactly the timer it created. Without this, the FIX-7 socket swap (an old
  // socket force-closed while a new one is already bridging) would let the OLD socket's async
  // teardown clear the NEW socket's heartbeat, because entry.heartbeatTimer has since been
  // reassigned to the new timer.
  // Self-stopping heartbeat: touchTakeoverHeartbeat guards against reap-revival (parse-utils.mjs)
  // — if an out-of-process reaper (cli-dispatch-clean.mjs) has already cleared this takeover to a
  // terminal state on disk, it returns the (now non-'human-controlled') status WITHOUT writing and
  // logs a stderr warning. If our teardown/finalizeTakeover never fired (socket still open), this
  // timer would otherwise keep firing every 30s forever, spamming that warning. So when the returned
  // status is no longer an active takeover, stop the timer here too (a secondary safety stop; normal
  // teardown at socket close/exit still clears it via the swap-safe path below).
  const heartbeatTimer = setInterval(() => {
    const st = touchTakeoverHeartbeat(statusFile)
    if (!(st.state === 'human-controlled' && st.takeover && st.takeover.active === true)) {
      clearInterval(heartbeatTimer)
      if (entry.heartbeatTimer === heartbeatTimer) entry.heartbeatTimer = null
    }
  }, 30000)
  heartbeatTimer.unref?.()
  entry.heartbeatTimer = heartbeatTimer

  let torn = false
  const teardown = () => {
    if (torn) return
    torn = true
    clearInterval(heartbeatTimer)
    if (entry.heartbeatTimer === heartbeatTimer) entry.heartbeatTimer = null
    // Only null the registry pointer + arm the FIX-8 abandonment clock if THIS socket is
    // still the entry's current socket (after a FIX-7 swap it won't be — the new socket owns
    // the entry and must not be disturbed by the old one's teardown).
    if (entry.wsSocket === socket) { entry.wsSocket = null; entry.wsDisconnectedAt = Date.now() }
  }

  // pty-host.mjs now hands back an already-decoded STRING chunk in BOTH modes (node-pty and
  // script-fallback; it does UTF-8 reassembly internally via persistent TextDecoders — C3),
  // so no further decoding is needed or correct here — use the chunk directly (the old
  // chunk.toString('utf8') was a redundant no-op on an already-string value).
  ptyHandle.onData((chunk) => sendWsFrame(socket, JSON.stringify({ t: 'o', d: chunk })))

  // Notifies the browser only — does NOT write status.json (see the doc comment on
  // handleTakeover's own ptyHandle.onExit listener above: that is the single writer).
  ptyHandle.onExit((code) => {
    sendWsFrame(socket, JSON.stringify({ t: 'exit', code }))
    try { socket.end() } catch { /* ignore */ }
    teardown()
  })

  attachWsFrameParser(socket, (msgStr) => {
    let msg
    try { msg = JSON.parse(msgStr) } catch { return }
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'i' && typeof msg.d === 'string') ptyHandle.write(msg.d)
    else if (msg.t === 'r' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) ptyHandle.resize(msg.cols, msg.rows)
  }, () => {
    sendWsClose(socket)
    try { socket.end() } catch { /* ignore */ }
    teardown()
  })
}
// ==== end human-takeover ========================================================

// Resolve a `watch` spec to concrete file/dir targets for SSE fs.watch.
// Returns [{path, recursive}]. Invalid/unknown specs → [] (stream stays open, heartbeat only).
function watchTargets(spec) {
  if (spec === 'sessions') {
    // cheap, shallow: live busy/idle flips + worker churn (the list doesn't need per-keystroke fidelity)
    return [{ path: CC_SESSIONS_DIR, recursive: false }, { path: WORKERS_ROOT, recursive: false }]
  }
  let m
  if ((m = spec.match(/^session:([^:]+)$/)) && okId(m[1])) {
    const sess = findSession(m[1]); if (!sess) return []
    return [{ path: sess.file, recursive: false }, { path: subagentDir(sess), recursive: true }]
  }
  if ((m = spec.match(/^subagent:([^:]+):([^:]+)$/)) && okId(m[1]) && okId(m[2])) {
    const sess = findSession(m[1]); if (!sess) return []
    const jl = path.join(subagentDir(sess), 'agent-' + m[2] + '.jsonl')
    if (!path.resolve(jl).startsWith(path.resolve(subagentDir(sess)) + path.sep)) return []
    return fs.existsSync(jl) ? [{ path: jl, recursive: false }] : [{ path: subagentDir(sess), recursive: true }]
  }
  if ((m = spec.match(/^worker:([^:]+)$/)) && okId(m[1])) {
    const dir = path.resolve(path.join(WORKERS_ROOT, m[1]))
    if (!dir.startsWith(path.resolve(WORKERS_ROOT) + path.sep) || !isDir(dir)) return []
    return [{ path: dir, recursive: false }]
  }
  return []
}

function sse(req, res, spec) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.write(': ok\n\n')
  let t = null
  const ping = () => { clearTimeout(t); t = setTimeout(() => { try { res.write('event: change\ndata: {}\n\n') } catch {} }, 250) }
  const watchers = []
  for (const tg of watchTargets(spec)) {
    try { watchers.push(fs.watch(tg.path, { persistent: false, recursive: tg.recursive }, ping)) }
    catch { try { watchers.push(fs.watch(tg.path, { persistent: false }, ping)) } catch {} }  // recursive unsupported (Linux) → shallow
  }
  const hb = setInterval(() => { try { res.write(': hb\n\n') } catch {} }, 20000)
  req.on('close', () => { clearInterval(hb); clearTimeout(t); for (const w of watchers) { try { w.close() } catch {} } })
}

const CONFIG_KEYS = {
  DEEPSEEK_API_KEY: { secret: true },
  GEMINI_API_KEY: { secret: true },
  CODEX_API_KEY: { secret: true },
  OPENROUTER_API_KEY: { secret: true },
  COPILOT_GITHUB_TOKEN: { secret: true },
  DS_MODEL: { secret: false },
  DS_FLASH_MODEL: { secret: false },
  AG_MODEL: { secret: false },
  AG_MODELS: { secret: false },
  CX_MODEL: { secret: false },
  CX_MODELS: { secret: false },
  OC_MODEL: { secret: false },
  OC_MODELS: { secret: false },
  CP_MODEL: { secret: false },
  CP_MODELS: { secret: false }
}

function resolveConfigPath() {
  const envOverride = process.env.CLI_DISPATCH_CONFIG || process.env.CLAUDE_DS_CONFIG
  if (envOverride) return envOverride
  const primaryPath = path.join(os.homedir(), '.config', 'cli-dispatch', 'config')
  const legacyPath = path.join(os.homedir(), '.config', 'claude-ds', 'config')
  if (!fs.existsSync(primaryPath) && fs.existsSync(legacyPath)) {
    return legacyPath
  }
  return primaryPath
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 65536) {
        reject(new Error('Request body too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', err => {
      reject(err)
    })
  })
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = u.pathname
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return
    }
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return }
    if (Object.prototype.hasOwnProperty.call(VENDOR_FILES, p)) return serveVendorAsset(p, res)
    if (p === '/api/stream') return sse(req, res, u.searchParams.get('watch') || 'sessions')
    if (p === '/api/sessions') return send(res, 200, listSessions())
    if (p === '/api/workers') return send(res, 200, listWorkers())
    if (p === '/api/workers/aggregate') return send(res, 200, workerUsageAggregate())

    if (p === '/api/clean' && req.method === 'GET') {
      let staleSecs = parseInt(u.searchParams.get('staleSecs'), 10)
      if (!Number.isFinite(staleSecs) || staleSecs <= 0) staleSecs = 600
      const items = findStaleSessions(staleSecs)
      return send(res, 200, { root: WORKERS_ROOT, staleSecs, count: items.length, items })
    }

    if (p === '/api/clean' && req.method === 'POST') {
      let staleSecs = 600
      try {
        const body = await readBody(req)
        if (body && typeof body.staleSecs === 'number' && Number.isFinite(body.staleSecs) && body.staleSecs > 0) {
          staleSecs = body.staleSecs
        }
      } catch (e) {
        return send(res, 400, { error: 'invalid JSON body' })
      }
      const items = findStaleSessions(staleSecs)
      let removed = 0
      const failed = []
      for (const item of items) {
        try {
          fs.rmSync(path.join(WORKERS_ROOT, item.id), { recursive: true, force: true })
          removed++
        } catch (e) {
          failed.push({ id: item.id, error: e.message })
        }
      }
      return send(res, 200, { removed, failed, count: items.length })
    }

    if (p === '/api/config' && req.method === 'GET') {
      const configPath = resolveConfigPath()
      const result = {}
      for (const k of Object.keys(CONFIG_KEYS)) {
        if (CONFIG_KEYS[k].secret) {
          result[k] = { secret: true, set: false }
        } else {
          result[k] = { secret: false, value: "" }
        }
      }
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8')
          const lines = content.split(/\r?\n/)
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('#') || trimmed === '') continue
            const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^#\s]*))\s*$/)
            if (match) {
              const key = match[1]
              if (Object.prototype.hasOwnProperty.call(CONFIG_KEYS, key)) {
                let val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4])
                val = val.replace(/\\"/g, '"')
                if (CONFIG_KEYS[key].secret) {
                  const isSet = (val !== '')
                  result[key].set = isSet
                  if (isSet && val.length >= 12) {
                    result[key].masked = val.slice(0, 6) + '...' + val.slice(-4)
                  }
                } else {
                  result[key].value = val
                }
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }
      return send(res, 200, result)
    }

    if (p === '/api/models/opencode' && req.method === 'GET') {
      try {
        const ids = await new Promise((resolve, reject) => {
          const r = https.get('https://openrouter.ai/api/v1/models', { timeout: 5000 }, (pres) => {
            let data = ''
            pres.on('data', chunk => { data += chunk })
            pres.on('end', () => {
              try {
                const json = JSON.parse(data)
                // Return only the model id strings — never leak the full response
                resolve((json.data || []).map(m => m.id).filter(Boolean))
              } catch (e) { reject(e) }
            })
          })
          r.on('error', reject)
          r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
        })
        return send(res, 200, ids)
      } catch (e) {
        console.error('opencode models fetch error:', e.message)
        return send(res, 200, [])
      }
    }

    if (p === '/api/config' && req.method === 'POST') {
      if (!checkTakeoverAuth(req, res, { requireCustomHeader: true })) return
      let body
      try {
        body = await readBody(req)
      } catch (e) {
        return send(res, 400, { error: 'invalid JSON body' })
      }
      const { key, value } = body
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(CONFIG_KEYS, key)) {
        return send(res, 400, { error: 'invalid config key' })
      }
      if (typeof value !== 'string') {
        return send(res, 400, { error: 'value must be a string' })
      }
      if (value.includes('\n') || value.includes('\r')) {
        return send(res, 400, { error: 'value cannot contain newlines' })
      }

      const escapedValue = value.replace(/"/g, '\\"')
      const configPath = resolveConfigPath()
      try {
        const dir = path.dirname(configPath)
        fs.mkdirSync(dir, { recursive: true })

        const exists = fs.existsSync(configPath)
        let lines = []
        let existingMode = 0o600
        
        if (exists) {
          const stat = fs.statSync(configPath)
          existingMode = stat.mode & 0o777
          const content = fs.readFileSync(configPath, 'utf8')
          lines = content.split(/\r?\n/)
        }

        const keyPrefix = key + '='
        let foundIndex = -1
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(keyPrefix)) {
            foundIndex = i
            break
          }
        }

        const newLine = `${key}="${escapedValue}"`

        if (foundIndex !== -1) {
          lines[foundIndex] = newLine
        } else {
          if (!exists) {
            lines = [`# cli-dispatch config`, newLine, '']
          } else {
            let lastNonBlankIdx = -1
            for (let i = lines.length - 1; i >= 0; i--) {
              if (lines[i].trim() !== '') {
                lastNonBlankIdx = i
                break
              }
            }
            if (lastNonBlankIdx === -1) {
              lines = [`# cli-dispatch config`, newLine, '']
            } else {
              const trailingBlankCount = lines.length - 1 - lastNonBlankIdx
              const beforeLines = lines.slice(0, lastNonBlankIdx + 1)
              const prepends = Math.max(0, 2 - trailingBlankCount)
              for (let j = 0; j < prepends; j++) {
                beforeLines.push('')
              }
              beforeLines.push(newLine)
              beforeLines.push('')
              lines = beforeLines
            }
          }
        }

        const finalContent = lines.join('\n')
        
        const tempPath = configPath + '.tmp.' + crypto.randomBytes(8).toString('hex')
        try {
          fs.writeFileSync(tempPath, finalContent, { mode: existingMode })
          fs.renameSync(tempPath, configPath)
        } catch (writeErr) {
          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
          } catch {}
          throw writeErr
        }

        return send(res, 200, { ok: true })
      } catch (e) {
        return send(res, 400, { error: 'Failed to write config: ' + String(e.message || e) })
      }
    }

    let m
    if ((m = p.match(/^\/api\/session\/([^/]+)\/flow$/))) {
      const id = decodeURIComponent(m[1]); if (!okId(id)) return send(res, 400, { error: 'bad id' })
      const sess = findSession(id); if (!sess) return send(res, 404, { error: 'not found' })
      const f = mapFlow(sess.file); f.linkedWorkers = linkedWorkers(sess.file); return send(res, 200, f)
    }
    if ((m = p.match(/^\/api\/session\/([^/]+)\/subagents$/))) {
      const id = decodeURIComponent(m[1]); if (!okId(id)) return send(res, 400, { error: 'bad id' })
      const sess = findSession(id); if (!sess) return send(res, 404, { error: 'not found' })
      return send(res, 200, listSubagents(sess))
    }
    if ((m = p.match(/^\/api\/subagent\/([^/]+)\/([^/]+)\/flow$/))) {
      const sid = decodeURIComponent(m[1]), aid = decodeURIComponent(m[2])
      if (!okId(sid) || !okId(aid)) return send(res, 400, { error: 'bad id' })
      const sess = findSession(sid); if (!sess) return send(res, 404, { error: 'not found' })
      const jl = path.join(subagentDir(sess), 'agent-' + aid + '.jsonl')
      const rp = path.resolve(jl)
      if (!rp.startsWith(path.resolve(subagentDir(sess)) + path.sep)) return send(res, 400, { error: 'bad path' })
      const f = mapFlow(jl); f.linkedWorkers = linkedWorkers(jl); return send(res, 200, f)
    }
    if ((m = p.match(/^\/api\/worker\/([^/]+)\/flow$/))) {
      const id = decodeURIComponent(m[1]); if (!okId(id)) return send(res, 400, { error: 'bad id' })
      const dir = path.resolve(path.join(WORKERS_ROOT, id))
      if (!dir.startsWith(path.resolve(WORKERS_ROOT) + path.sep) || !isDir(dir)) return send(res, 404, { error: 'not found' })
      return send(res, 200, workerFlow(id))
    }
    // ---- human-takeover write endpoints (opt-in; see .specs/dev/sdd/human-takeover.md) ----
    if ((m = p.match(/^\/api\/worker\/([^/]+)\/takeover$/)) && req.method === 'POST') {
      return await handleTakeover(req, res, m[1])
    }
    if ((m = p.match(/^\/api\/worker\/([^/]+)\/handback$/)) && req.method === 'POST') {
      return handleHandback(req, res, m[1])
    }
    send(res, 404, { error: 'no route' })
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) })
  }
})

// GET /pty/<id>?token=<t> — WebSocket upgrade for the human-takeover terminal bridge. No
// 'upgrade' handler existed before this feature; this is the only place a WebSocket is
// ever accepted by this server.
server.on('upgrade', (req, socket) => {
  socket.on('error', () => { /* avoid an uncaught 'error' crashing the process, e.g. ECONNRESET */ })
  let u
  try { u = new URL(req.url, 'http://127.0.0.1') } catch { return rejectUpgrade(socket, 400, 'Bad Request') }
  const m = u.pathname.match(/^\/pty\/([^/]+)$/)
  if (!m) return rejectUpgrade(socket, 404, 'Not Found')
  const id = decodeURIComponent(m[1])
  if (!okId(id)) return rejectUpgrade(socket, 400, 'Bad Request')

  // Same Origin+Host fail-closed checks as the POST endpoints (custom-header check does
  // NOT apply here — GET/WS is not a preflight-eligible verb, see validateTakeoverRequest).
  const auth = validateTakeoverRequest(req, { requireCustomHeader: false })
  if (!auth.ok) return rejectUpgrade(socket, 403, 'Forbidden')

  const entry = takeoverRegistry.get(id)
  if (!entry || !entry.ptyHandle) return rejectUpgrade(socket, 404, 'Not Found')

  // Constant-time token compare. Reject immediately (without calling timingSafeEqual) on
  // a length mismatch — timingSafeEqual throws on unequal-length buffers. This length
  // check does technically leak length via timing, but the token is a fixed-length
  // (32-byte) base64url string, so this is a non-issue in practice.
  const providedToken = u.searchParams.get('token') || ''
  const expected = Buffer.from(entry.token, 'utf8')
  const provided = Buffer.from(providedToken, 'utf8')
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return rejectUpgrade(socket, 403, 'Forbidden')
  }

  // FIX 7: single-active-viewer semantics. If a previous WS is still bridged to this entry,
  // close+destroy it cleanly FIRST before bridging the new one. socket.destroy() makes the old
  // socket emit 'close', which drives its attachWsFrameParser's doClose → the bridge's onClose
  // → teardown (heartbeat timer cleared). The FIX-8/teardown guards (local heartbeat timer,
  // `entry.wsSocket === socket` check) ensure the old socket's async teardown does NOT clear
  // the new socket's heartbeat or null out the new socket. Multi-viewer is out of scope.
  if (entry.wsSocket && entry.wsSocket !== socket) {
    const old = entry.wsSocket
    sendWsClose(old)
    try { old.destroy() } catch { /* ignore */ }
  }

  // NEVER log req.url here or anywhere on this path — it carries the takeover token in
  // its query string (TL17).
  performWsHandshake(req, socket, entry)
})

// Explicit SIGTERM handler for THIS process. pty-host.mjs (imported above) registers its
// own 'SIGTERM' listener the first time a takeover is ever spawned, to kill any live
// hosted PTYs — but adding a 'SIGTERM' listener in Node SUPPRESSES the default
// terminate-on-SIGTERM behavior for the WHOLE process, not just that listener's own
// concern. Without an explicit handler here that actually calls process.exit(), this
// server would become unkillable via SIGTERM once a takeover has occurred, breaking the
// `kill <pid>` shutdown instructions in dashboard.md. Registered unconditionally (not
// only once a takeover has fired) so shutdown behavior never depends on whether a
// takeover has happened yet.
process.on('SIGTERM', () => { process.exit(0) })

function listen(port, tries = 12) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) { listen(port + 1, tries - 1) }
    else { console.error('dashboard: ' + e.message); process.exit(1) }
  })
  server.listen(port, '127.0.0.1', () => {
    ACTUAL_PORT = server.address().port
    const url = 'http://127.0.0.1:' + ACTUAL_PORT
    console.error('cli-dispatch dashboard → ' + url + '  (read-only by default; Ctrl-C to stop)')
    if (OPEN) {
      const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'explorer.exe' : 'xdg-open')
      try { spawnSync(cmd, [url], { stdio: 'ignore' }) } catch {}
    }
  })
}
listen(PORT)
