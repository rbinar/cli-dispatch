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
import { fileURLToPath } from 'node:url'
import { spawnSync, execSync } from 'node:child_process'
// NOTE: pty-host.mjs / takeover-cmd.mjs are deliberately NOT imported statically here.
// They are only needed for the opt-in human-takeover write path and install.sh does not
// ship them in every configuration — a static top-level import would ERR_MODULE_NOT_FOUND
// at module load and crash EVERY installed dashboard (takeover users or not). Instead they
// are loaded LAZILY, on first takeover, inside handleTakeover (see loadTakeoverModules).
import { readJsonFile, markTakeoverActive, touchTakeoverHeartbeat, clearTakeoverState } from './parse-utils.mjs'

// Directory this file lives in, regardless of whether it's run in-repo or from its
// installed location (install.sh copies it + its sibling .mjs modules together) — used to
// resolve the vendored xterm.js static assets next to it (./vendor/*).
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = path.join(SELF_DIR, 'vendor')

const HOME = os.homedir()
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects')
const parentIndexCache = new Map() // keyed by CC session id -> { mtime, workerIds: string[] }
const subagentCache = new Map() // keyed by subagent file path -> { mtime, matchedWorkerIds: string[], usage: { inTok: number, outTok: number } | null }
const CC_SESSIONS_DIR = path.join(HOME, '.claude', 'sessions')
const CACHE = process.env.XDG_CACHE_HOME || path.join(HOME, '.cache')
const WORKERS_ROOT = process.env.CLI_DISPATCH_SESSIONS_DIR || process.env.CLAUDE_DS_SESSIONS_DIR ||
  (fs.existsSync(path.join(CACHE, 'cli-dispatch', 'sessions')) || !fs.existsSync(path.join(CACHE, 'claude-ds', 'sessions'))
    ? path.join(CACHE, 'cli-dispatch', 'sessions') : path.join(CACHE, 'claude-ds', 'sessions'))

const FLOW_CAP = 400          // max events returned per flow request
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

// Read first ~maxBytes of a file (for the opening user prompt).
function readHead(file, maxBytes = 16384) {
  try {
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(maxBytes)
    const n = fs.readSync(fd, buf, 0, maxBytes, 0); fs.closeSync(fd)
    return buf.toString('utf8', 0, n)
  } catch { return '' }
}
// Read last ~maxBytes of a file (for the latest event / activity).
function readTail(file, maxBytes = 65536) {
  try {
    const st = fs.statSync(file); const start = Math.max(0, st.size - maxBytes)
    const fd = fs.openSync(file, 'r'); const len = st.size - start; const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, start); fs.closeSync(fd)
    return buf.toString('utf8', 0, n)
  } catch { return '' }
}
const lines = (s) => s.split('\n').filter((l) => l.trim())
const firstJSON = (txt) => { for (const l of lines(txt)) { try { return JSON.parse(l) } catch {} } return null }
const lastJSON = (txt) => { const ls = lines(txt); for (let i = ls.length - 1; i >= 0; i--) { try { return JSON.parse(ls[i]) } catch {} } return null }
const clip = (s, n = 140) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }

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

// Pull a readable preview out of a message.content that may be string or block array.
function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === 'text' && b.text) return b.text
      if (typeof b === 'string') return b
    }
  }
  return ''
}

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

// ---- flow mapper (shared by session + subagent transcripts) ----
function sumUsageFromEvents(evs) {
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

function mapFlow(file) {
  if (!fs.existsSync(file)) return { steps: [], total: 0, truncated: false }
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
  const steps = []
  for (const e of evs) {
    const ts = e.timestamp || null
    const c = e.message && e.message.content
    if (e.type === 'user') {
      if (typeof c === 'string') { if (!e.isMeta) steps.push({ kind: 'prompt', ts, text: clip(c, 400) }) }
      // tool_result blocks are folded into their tool step below; skip standalone
    } else if (e.type === 'assistant' && Array.isArray(c)) {
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
  return { steps, total, truncated: total > slice.length, usage: haveUsage ? { inTok, outTok } : null }
}

function toolSummary(_name, input) {
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

// FIX 1 helpers — kill the pre-existing HEADLESS worker process tree before spawning the
// interactive takeover PTY. cx-stream now writes $dir/worker.pid (the whole cx-stream
// process TREE root; see C1). We mirror stream-utils.sh's proc_tree/kill_worker: snapshot
// the full descendant set FIRST (recursive `pgrep -P`), then TERM the captured list, wait,
// then KILL survivors from that SAME captured list — so children reparented mid-kill are
// not missed.
function collectProcTree(rootPid) {
  const all = []
  const visit = (pid) => {
    all.push(pid)
    let r
    try { r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }) } catch { return }
    if (!r || r.status !== 0 || !r.stdout) return   // no children (pgrep exits 1) or pgrep failed
    for (const line of r.stdout.split('\n')) {
      const child = parseInt(line.trim(), 10)
      if (Number.isInteger(child) && child > 0) visit(child)
    }
  }
  visit(rootPid)
  return all
}

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
  markTakeoverActive(statusFile, { host, ptyPid: ptyHandle.pid, ptyPgid: ptyHandle.pgid })
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
  const heartbeatTimer = setInterval(() => { touchTakeoverHeartbeat(statusFile) }, 30000)
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
  CX_MODEL: { secret: false },
  OC_MODEL: { secret: false },
  CP_MODEL: { secret: false }
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
                  result[key].set = (val !== '')
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

// ---- embedded single-page UI ----
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cli-dispatch dashboard</title>
<link rel="stylesheet" href="/vendor/xterm.css">
<script src="/vendor/xterm.js"></script>
<script src="/vendor/xterm-addon-fit.js"></script>
<style>
:root{--bg:#0d1117;--panel:#161b22;--bd:#30363d;--fg:#e6edf3;--dim:#8b949e;--acc:#ff7a18;--g:#3fb950;--y:#d29922;--lnk:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:8px 14px;border-bottom:1px solid var(--bd);display:flex;gap:10px;align-items:center}
header b{color:var(--acc)} .grow{flex:1}
.layout{display:grid;grid-template-columns:320px 1fr 320px;height:calc(100vh - 41px)}
.rail{border-right:1px solid var(--bd);overflow:auto}
.side-panel{border-left:1px solid var(--bd);overflow:auto;padding:14px}
.tabs{display:flex;border-bottom:1px solid var(--bd)} .tab{flex:1;padding:8px;text-align:center;cursor:pointer;color:var(--dim)}
.tab.on{color:var(--fg);border-bottom:2px solid var(--acc)}
.filter{display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
.fchip{padding:2px 9px;border:1px solid var(--bd);border-radius:12px;cursor:pointer;color:var(--dim);font-size:11px;user-select:none}
.fchip:hover{background:#1f2630}.fchip.on{color:var(--fg);border-color:var(--acc)}
.fchip .c{color:var(--dim);margin-left:3px}
.item{padding:8px 12px;border-bottom:1px solid var(--bd);cursor:pointer}
.item:hover{background:#1f2630}.item.sel{background:#1f2937}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.busy{background:var(--g)}.idle{background:var(--y)}.closed{background:#484f58}
.muted{color:var(--dim)}.small{font-size:11px}
.main{overflow:auto;padding:14px}
.crumb{margin-bottom:10px;color:var(--dim)}.crumb a{color:var(--lnk);cursor:pointer;text-decoration:none}
.badge{border:1px solid var(--bd);border-radius:10px;padding:1px 7px;font-size:11px;color:var(--dim);margin-left:6px}
.step{padding:6px 8px;border-left:2px solid var(--bd);margin:4px 0}
.step.tool{border-color:var(--acc)}.step.prompt{border-color:var(--lnk)}.step.message{border-color:var(--lnk)}
.step.thinking{border-color:#373e47;color:var(--dim);font-style:italic}.step.log{border-color:#373e47}
.step.errline{border-color:#f85149;color:#f85149}
.step.result{border-color:var(--bd);margin:2px 0 2px 14px;padding:2px 8px;font-size:11px;color:var(--dim)}
.step.result.ok{color:var(--g)}.step.result.err{color:#f85149}
.k{color:var(--acc)}.ok{color:var(--g)}.err{color:#f85149}
.md{display:inline}.md>div{margin:1px 0}.md-h{font-weight:700;color:var(--fg);margin:6px 0 2px}
.md-ul{margin:2px 0;padding-left:18px}.md-ul li{margin:1px 0}
.md-code{background:#1f2630;border:1px solid var(--bd);border-radius:4px;padding:0 4px;font-size:12px}
.md-pre{background:#0b0f14;border:1px solid var(--bd);border-radius:6px;padding:8px 10px;margin:4px 0;overflow:auto;white-space:pre-wrap;color:#cdd9e5}
.md a{color:var(--lnk)}.md strong{color:var(--fg)}
.panel.task .md{max-height:38vh;overflow:auto}.panel.task .sabody{padding-top:4px}
.sa{display:inline-block;margin:3px 6px 3px 0;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;cursor:pointer;color:var(--lnk)}
.sa:hover{background:#1f2630}.empty{color:var(--dim);padding:20px}
.panel{border:1px solid var(--bd);border-radius:8px;margin-bottom:10px;background:#11161d}
.panel>summary{cursor:pointer;padding:7px 10px;color:var(--fg);list-style:none;user-select:none}
.panel>summary::-webkit-details-marker{display:none}
.panel>summary::before{content:'▸ ';color:var(--dim)}
.panel[open]>summary::before{content:'▾ ';color:var(--dim)}
.panel>summary:hover{background:#1f2630;border-radius:8px}
.sabody{padding:2px 8px 8px}
.panel.act{border-color:var(--g);background:#101a12}
.panel.act>summary{color:var(--g)}
.panel.wk{border-color:var(--lnk);background:#0e1626}
.panel.wk>summary{color:var(--lnk)}
.sa.act{border-color:var(--g);color:var(--g)}
.live{color:var(--g)}
a.agentlink{color:var(--lnk);cursor:pointer}
.human{background:#a371f7}
.badge.human{border-color:#a371f7;color:#a371f7}
.badge.warn{border-color:var(--y);color:var(--y)}
#takeover{display:none;margin-bottom:10px}
.tkbar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tkbtn{background:#1f2630;border:1px solid var(--bd);color:var(--fg);border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
.tkbtn:hover{background:#2a323d;border-color:var(--acc)}
.tkbtn-off{border-color:#a371f7;color:#a371f7}
.term-wrap{border:1px solid var(--bd);border-radius:8px;padding:6px;background:#000;height:380px}
.term-flow{border:1px solid var(--bd);border-radius:8px;padding:8px 12px;background:#000;margin:10px 0}
.term-flow .step.prompt{font-weight:600}
#tkTerm{height:100%}
input.cfg-input{background:#0d1117;border:1px solid var(--bd);color:var(--fg);border-radius:6px;padding:5px 10px;font:inherit;width:100%;max-width:400px;margin-right:8px}
input.cfg-input:focus{border-color:var(--acc);outline:none}
.cfg-row{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid #21262d}
.cfg-row:last-child{border-bottom:none}
.cfg-label{font-weight:bold;display:flex;align-items:center;gap:8px}
.cfg-field{display:flex;align-items:center;margin-top:4px}
</style></head><body>
<header><b>cli-dispatch</b> <span class="muted">dashboard</span><span class="grow"></span>
<span class="small muted" id="meta"></span><span class="small muted">· read-only by default · opt-in takeover</span></header>
<div class="layout">
 <div class="rail">
   <div class="tabs"><div class="tab on" id="tabCC">Claude Code</div><div class="tab" id="tabW">cli-dispatch workers</div><div class="tab" id="tabConfig">Configuration</div></div>
   <div id="filter" class="filter"></div>
   <div id="list"></div>
 </div>
 <div class="main"><div class="crumb" id="crumb">Select a session…</div><div id="takeover"></div><div id="view" class="empty">←</div></div>
 <div class="side-panel" id="sidePanel"></div>
</div>
<script>
let mode='cc', sel=null, flt='busy', wFlt='all'
// "High overhead" heuristic: flag a worker row when its babysitter (the Claude Code runner
// that dispatched it) burned more than HIGH_OVERHEAD_RATIO times the OUTPUT tokens the worker
// itself produced on its own (usually cheaper) backend — i.e. delegation likely cost MORE
// Anthropic-native tokens than it saved. 4x is chosen as a middle point of a defensible 3-5x
// range: tolerant of normal babysitter overhead (polling/verification/reasoning) while still
// catching clear waste. When the worker's own usage was never captured (e.g. the Antigravity
// backend does not report usage), the ratio is unprovable — we deliberately do NOT flag in
// that case, to avoid crying wolf on backends that simply don't report usage.
const HIGH_OVERHEAD_RATIO = 4
function setFilter(k){ flt=k; loadList() }
function setWFilter(k){ wFlt=k; loadList() }
// Live updates via Server-Sent Events. One detail stream for the open item; it
// pushes a 'change' event whenever the watched file/dir changes (fs.watch).
let detailES=null, detailSpec=null, detailTimer=null
function watchDetail(spec, fn){
  if(spec===detailSpec) return
  if(detailES){ detailES.close(); detailES=null }
  if(detailTimer){ clearTimeout(detailTimer); detailTimer=null }
  detailSpec=spec||null
  if(!spec) return
  detailES=new EventSource('/api/stream?watch='+encodeURIComponent(spec))
  // Coalesce change bursts: at most one detail refresh per 600ms.
  detailES.addEventListener('change', ()=>{ if(detailTimer) return; detailTimer=setTimeout(()=>{ detailTimer=null; fn() },600) })
}
// Flicker-free view swap: skip the DOM write entirely when the rendered HTML is unchanged
// (fs.watch fires for plenty of writes that don't alter what we show), otherwise replace
// and restore the scroll position so a live refresh doesn't jump the reader to the top.
function setView(key,h){
  const v=document.getElementById('view'); v.className=''
  if(v._k===key&&v._h===h) return
  const sc=v.parentElement.scrollTop
  v._k=key; v._h=h; v.innerHTML=h
  v.parentElement.scrollTop=sc
}
const E=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstChild}
const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
const escAttr=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
// Minimal, XSS-safe Markdown renderer (escape-FIRST, then a whitelist of transforms; never
// passes raw HTML through). Used only for message/prompt/result text. BT avoids literal
// backticks (this whole page is a backtick template on the server side).
const BT=String.fromCharCode(96)
function mdInline(x){
  const cs=[]; const ps=x.split(BT); let r=''
  for(let i=0;i<ps.length;i++){ if(i%2===1){cs.push(ps[i]); r+=' C'+(cs.length-1)+' '} else r+=ps[i] }
  r=r.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
  r=r.replace(/\\*([^*]+)\\*/g,'<em>$1</em>')
  r=r.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,(m,tt,u)=>{const safe=/^(https?:\\/\\/|\\/)/.test(u)?u:'#';return '<a href="'+safe.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener">'+tt+'</a>'})
  r=r.replace(/ C(\\d+) /g,(m,i)=>'<code class="md-code">'+cs[+i]+'</code>')
  return r
}
function md(t){
  if(!t) return ''
  let s=esc(t)
  const blocks=[]; const parts=s.split(BT+BT+BT); s=''
  for(let i=0;i<parts.length;i++){ if(i%2===1){blocks.push(parts[i]); s+=' B'+(blocks.length-1)+' '} else s+=parts[i] }
  const lines=s.split('\\n'); const out=[]; let inList=false
  for(let ln of lines){
    if(/^ B\\d+ \\s*$/.test(ln)){ if(inList){out.push('</ul>');inList=false} out.push(ln); continue }
    let mh=ln.match(/^(#{1,4})\\s+(.*)$/)
    if(mh){ if(inList){out.push('</ul>');inList=false} out.push('<div class="md-h">'+mdInline(mh[2])+'</div>'); continue }
    let ml=ln.match(/^\\s*[-*]\\s+(.*)$/)
    if(ml){ if(!inList){out.push('<ul class="md-ul">');inList=true} out.push('<li>'+mdInline(ml[1])+'</li>'); continue }
    if(inList){out.push('</ul>');inList=false}
    if(ln.trim()==='') out.push('<br>'); else out.push('<div>'+mdInline(ln)+'</div>')
  }
  if(inList) out.push('</ul>')
  s=out.join('')
  s=s.replace(/ B(\\d+) /g,(m,i)=>'<pre class="md-pre">'+blocks[+i]+'</pre>')
  return s
}
// Times come from disk as UTC ISO; render in the viewer's local timezone.
const fmtTime=(iso)=>{const d=iso?new Date(iso):null;return d&&!isNaN(d)?d.toLocaleTimeString([],{hour12:false}):''}
const fmtDT=(iso)=>{const d=iso?new Date(iso):null;return d&&!isNaN(d)?d.toLocaleString([],{hour12:false}).replace(',',''):''}
// Worker cwd is a real filesystem path (often a throwaway worktree, e.g. /tmp/wt-603) rather
// than the CC tab's ~/.claude/projects/ dash-encoded name — last two path segments is the
// closest equivalent short label ("parent/leaf") without guessing at the origin repo.
const shortProj=(cwd)=>{if(!cwd) return '';const parts=cwd.split('/').filter(Boolean);return parts.slice(-2).join('/')}
const shortSessionProj=(project)=>project.replace(/^-/,'').split('-').slice(-2).join('/')
const fmtUsage=(u,detailed)=>{
  if(!u) return null
  const inTok=u.inTok, outTok=u.outTok, costUsd=u.costUsd
  const abbreviate=(num)=>{
    if(num===undefined||num===null||isNaN(num)) return ''
    if(detailed) return String(num).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')
    if(num>=1000) return (num/1000).toFixed(1).replace(/\\.0$/,'')+'k'
    return String(num)
  }
  const inStr=abbreviate(inTok)
  const outStr=abbreviate(outTok)
  let tokStr=''
  if(inStr&&outStr) tokStr=inStr+' in / '+outStr+' out'
  else if(inStr) tokStr=inStr+' in'
  else if(outStr) tokStr=outStr+' out'
  
  let costStr=''
  if(costUsd!==undefined&&costUsd!==null&&!isNaN(costUsd)&&costUsd!==0){
    costStr='$'+Number(costUsd.toFixed(3))
  }
  return { tokStr, costStr }
}
async function j(u){const r=await fetch(u);return r.json()}
// Single source of truth for how a worker's raw {state, stale} maps to a filter-chip/badge
// bucket. 'human-controlled' gets its own bucket (previously fell through the catch-all
// into 'error', which is wrong — a human quietly watching a session is not a failure).
function workerBucket(w){
  if(w.state==='human-controlled') return 'human'
  if(w.stale||w.state==='error') return 'error'
  if(w.state==='running') return 'running'
  if(w.state==='done') return 'done'
  return 'error'
}
function isHighOverhead(w){
  return !!(w.parentSession && w.parentSession.babysitterUsage &&
    w.parentSession.babysitterUsage.outTok != null && w.usage && w.usage.outTok != null &&
    w.parentSession.babysitterUsage.outTok > HIGH_OVERHEAD_RATIO * w.usage.outTok)
}

async function loadList(){
  const el=document.getElementById('list')
  const fb=document.getElementById('filter')
  // Build first, swap once at the end — never blank the rail while the fetch is in flight.
  const frag=document.createDocumentFragment(); const sig=[]
  if(mode==='cc'){
    const ss=await j('/api/sessions')
    const counts={busy:0,idle:0,closed:0}; ss.forEach(s=>counts[s.status]=(counts[s.status]||0)+1)
    fb.style.display='flex'
    fb.innerHTML=[['all',ss.length],['busy',counts.busy],['idle',counts.idle],['closed',counts.closed]].map(([k,n])=>'<span class="fchip'+(flt===k?' on':'')+'" onclick="setFilter(\\''+k+'\\')">'+k+'<span class="c">'+n+'</span></span>').join('')
    document.getElementById('meta').textContent=ss.length+' sessions'
    const shown=flt==='all'?ss:ss.filter(s=>s.status===flt)
    shown.forEach(s=>{
      const h='<div class="item'+(sel===s.id?' sel':'')+'"><div><span class="dot '+s.status+'"></span>'+esc(shortSessionProj(s.project))+'<span class="badge">'+s.status+'</span>'+(s.model?' <span class="badge">'+esc(s.model)+'</span>':'')+(s.subagentCount?'<span class="badge">'+s.subagentCount+' sub</span>':'')+'</div><div class="small muted">'+esc(s.firstPrompt||s.id.slice(0,8))+'</div><div class="small muted">'+esc(fmtDT(s.lastActivityAt))+' · '+s.sizeKB+'KB</div></div>'
      const it=E(h); it.onclick=()=>openSession(s); frag.appendChild(it); sig.push(h)
    })
  }else if(mode==='w'){
    const ws=await j('/api/workers')
    const wCounts={all:ws.length,running:0,human:0,done:0,error:0}
    ws.forEach(w=>{ const k=workerBucket(w); wCounts[k]=(wCounts[k]||0)+1 })
    fb.style.display='flex'
    fb.innerHTML=[['all',wCounts.all],['running',wCounts.running],['human',wCounts.human],['done',wCounts.done],['error',wCounts.error]].map(([k,n])=>'<span class="fchip'+(wFlt===k?' on':'')+'" onclick="setWFilter(\\''+k+'\\')">'+k+'<span class="c">'+n+'</span></span>').join('')
    document.getElementById('meta').textContent=ws.length+' workers'
    const shown=wFlt==='all'?ws:ws.filter(w=>workerBucket(w)===wFlt)
    shown.forEach(w=>{
      const bucket=workerBucket(w)
      const live=bucket==='running'
      const dot=live?'busy':bucket==='human'?'human':bucket==='done'?'closed':bucket==='error'?'idle':'idle'
      const badge=w.stale?'stale':w.state
      const badgeCls='badge'+(bucket==='human'?' human':'')
      const u=fmtUsage(w.usage)
      let usageLine=''
      if(u&&(u.tokStr||u.costStr)){
        usageLine=' · '+(u.tokStr?esc(u.tokStr):'')+(u.tokStr&&u.costStr?' · ':'')+(u.costStr?esc(u.costStr):'')
      }
      const proj=shortProj(w.cwd)
      const h='<div class="item'+(sel===w.id?' sel':'')+'"><div><span class="dot '+dot+'"></span>'+esc(w.backend)+' <span class="c">'+(w.model?esc(w.model):'default')+'</span> <span class="'+badgeCls+'">'+esc(badge)+'</span>'+(isHighOverhead(w)?' <span class="badge warn">high overhead</span>':'')+'</div>'+(proj?'<div class="small muted">'+esc(proj)+'</div>':'')+(w.parentSession?'<div class="small muted">from '+esc(shortSessionProj(w.parentSession.project))+'</div>':'')+'<div class="small muted">'+esc(w.prompt||w.id.slice(0,8))+'</div><div class="small muted">'+esc(fmtDT(w.started))+(w.lastTool?' · '+esc(w.lastTool):'')+usageLine+'</div></div>'
      const it=E(h); it.onclick=()=>openWorker(w); frag.appendChild(it); sig.push(h)
    })
  }else if(mode==='config'){
    fb.style.display='none'
    document.getElementById('meta').textContent='configuration'
    const h='<div style="padding:14px;color:var(--dim)">Configure backend API keys and model defaults.</div>'
    if(el._sig===h) return
    el._sig=h
    el.innerHTML=h
    return
  }
  // Skip the swap when nothing visible changed; otherwise keep the rail's scroll position.
  const s2=mode+'|'+sig.join('\\n')
  if(el._sig===s2) return
  el._sig=s2
  const rail=el.parentElement; const sc=rail.scrollTop
  el.replaceChildren(frag); rail.scrollTop=sc
}
// worker progress.log lines already carry a leading glyph per event type (written by
// {ag,cx,ds,oc,cp}-*-parse.mjs — see appendProgress() call sites); map that glyph to the
// same step classes native CC tool/message/thinking steps use, so workers get equal
// visual separation instead of one flat "log" bucket.
const LOG_GLYPH_KIND={'·':'message','✻':'thinking','$':'tool','✎':'tool','▸':'tool','🔎':'tool','☑':'tool','✗':'errline'}
function renderFlow(steps){
  if(!steps||!steps.length) return '<div class="empty">no steps</div>'
  return steps.slice().reverse().map(s=>{
    if(s.kind==='tool'){
      const st=s.ok===true?'<span class="ok">⎿ ok</span>':s.ok===false?'<span class="err">⎿ error</span>':''
      let head='⏺ <span class="k">'+esc(s.name)+'</span> '+esc(s.summary||'')
      if(s.spawnsAgent) head='⏺ <span class="k">'+esc(s.name)+'</span> <a class="agentlink" onclick="openSub(\\''+escAttr(s.spawnsAgent)+'\\')">→ '+esc(s.summary||'subagent')+'</a>'
      return '<div class="step tool">'+head+(st?'<div class="small">'+st+' '+esc(s.result||'')+'</div>':'')+'</div>'
    }
    if(s.kind==='prompt') return '<div class="step prompt">❯ <span class="md">'+md(s.text)+'</span></div>'
    if(s.kind==='message') return '<div class="step message">⏺ <span class="md">'+md(s.text)+'</span></div>'
    if(s.kind==='thinking') return '<div class="step thinking">✻ '+esc(s.text)+'</div>'
    if(s.kind==='log'){
      const raw=s.text||''
      const rm=raw.match(/^\s{2}(✓|✗)\s?(.*)$/)
      if(rm) return '<div class="step result '+(rm[1]==='✓'?'ok':'err')+'">⎿ '+esc(rm[2])+'</div>'
      const t=raw.replace(/^\s+/,'')
      const g=t.charAt(0), kind=LOG_GLYPH_KIND[g]
      if(kind){
        const rest=t.slice(1).trim()
        const body=kind==='message'?'<span class="md">'+md(rest)+'</span>':esc(rest).replace(/\(exit (\d+)\)$/,(mm,c)=>c==='0'?'<span class="ok">(exit 0)</span>':'<span class="err">(exit '+c+')</span>')
        return '<div class="step '+kind+'">'+esc(g)+' '+body+'</div>'
      }
      return '<div class="step log">'+esc(raw)+'</div>'
    }
    return '<div class="step log">'+esc(s.text)+'</div>'
  }).join('')
}
function usageHtml(usage){
  const u=fmtUsage(usage,true)
  if(!u||(!u.tokStr&&!u.costStr)) return ''
  const parts=[]
  if(u.tokStr) parts.push(u.tokStr)
  if(u.costStr) parts.push(u.costStr)
  return '<div class="small muted" style="margin:4px 8px 12px">Usage: '+esc(parts.join(' · '))+'</div>'
}
function babysitterUsageHtml(w, workerUsage){
  if(!w.parentSession||!w.parentSession.babysitterUsage) return ''
  const bUsage=w.parentSession.babysitterUsage
  const bFmt=fmtUsage(bUsage,true)
  if(!bFmt||!bFmt.tokStr) return ''
  const wFmt=workerUsage?fmtUsage(workerUsage,true):null
  const wHasTokens=wFmt&&wFmt.tokStr
  if(wHasTokens){
    const totalUsage={
      inTok:(bUsage.inTok||0)+(workerUsage.inTok||0),
      outTok:(bUsage.outTok||0)+(workerUsage.outTok||0)
    }
    const tFmt=fmtUsage(totalUsage,true)
    const tTokStr=tFmt?tFmt.tokStr:''
    return '<div class="small muted" style="margin:4px 8px 12px">Babysitter cost: '+esc(bFmt.tokStr)+'<br>Total: '+esc(tTokStr)+'</div>'
  }
  return '<div class="small muted" style="margin:4px 8px 12px">Babysitter cost: '+esc(bFmt.tokStr)+' (worker-side usage not captured — total unknown)</div>'
}
function workerPanelHtml(lw){ if(!lw||!lw.length) return ''
  return '<details class="panel wk"><summary>Worker sessions (ds/ag/cx/oc/cp) <span class="badge">'+lw.length+'</span></summary><div class="sabody">'+lw.map(w=>'<span class="sa" onclick="openWorkerById(\\''+escAttr(w.id)+'\\')">'+esc(w.backend)+' ('+(w.model?esc(w.model):'default')+'): '+esc(w.prompt||w.id.slice(0,12))+' <span class="c">'+esc(w.stale?'stale':w.state)+'</span></span>').join('')+'</div></details>' }
function openWorkerById(id){ fetch('/api/workers').then(r=>r.json()).then(ws=>{const w=ws.find(x=>x.id===id); if(!w) return; mode='w'; document.getElementById('tabW').classList.add('on'); document.getElementById('tabCC').classList.remove('on'); document.getElementById('tabConfig').classList.remove('on'); openWorker(w)}) }
function chipHtml(a){const t=fmtTime(a.startedAt);return '<span class="sa'+(a.active?' act':'')+'" onclick="openSub(\\''+escAttr(a.agentId)+'\\','+(a.active?'true':'false')+')">'+(a.active?'● ':'')+esc(a.agentType)+': '+esc(a.description||a.agentId.slice(0,8))+(a.spawnDepth>1?' ·d'+a.spawnDepth:'')+(t?' <span class="c">'+t+'</span>':'')+'</span>'}
async function openSession(s){
  sel=s.id; mode='cc'
  takeoverTeardown(); { const tk=document.getElementById('takeover'); tk.style.display='none'; tk.innerHTML='' }
  document.getElementById('crumb').innerHTML='<a onclick="back()">sessions</a> › '+esc(s.id.slice(0,8))+' <span class="muted">('+esc(s.status)+')</span>'
  const prevPanel=document.querySelector('#sidePanel details.restpanel'); const subsOpen=prevPanel?prevPanel.open:false
  const key='session:'+s.id
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const [flow,subs]=await Promise.all([j('/api/session/'+s.id+'/flow'),j('/api/session/'+s.id+'/subagents')])
  window._cur={type:'session',id:s.id}
  let side=''
  if(subs.length){
    const act=subs.filter(a=>a.active), rest=subs.filter(a=>!a.active)
    if(act.length) side+='<details class="panel act" open><summary>Active subagents <span class="badge">'+act.length+'</span></summary><div class="sabody">'+act.map(chipHtml).join('')+'</div></details>'
    if(rest.length) side+='<details class="panel restpanel"'+(subsOpen?' open':'')+'><summary>Subagents <span class="badge">'+rest.length+'</span></summary><div class="sabody">'+rest.map(chipHtml).join('')+'</div></details>'
  }
  side+=workerPanelHtml(flow.linkedWorkers)
  document.getElementById('sidePanel').innerHTML=side
  let h=''
  h+=usageHtml(flow.usage)
  h+='<div class="term-flow">'+renderFlow(flow.steps)+'</div>'+(flow.truncated?'<div class="small muted">(showing last '+flow.steps.length+' of '+flow.total+')</div>':'')
  setView(key,h); loadList()
  watchDetail(s.status==='busy'?'session:'+s.id:null, ()=>openSession(s))
}
async function openSub(aid,active){
  const sid=window._cur&&window._cur.type==='session'?window._cur.id:(window._cur&&window._cur.sid)
  if(!sid) return;
  document.getElementById('crumb').innerHTML='<a onclick="back()">sessions</a> › <a onclick="reopen(\\''+escAttr(sid)+'\\')">'+esc(sid.slice(0,8))+'</a> › <span class="k">subagent '+esc(aid.slice(0,8))+'</span>'+(active?' <span class="live">● live</span>':'')
  const key='sub:'+sid+':'+aid
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const flow=await j('/api/subagent/'+sid+'/'+aid+'/flow')
  window._cur={type:'sub',sid:sid,aid:aid}
  document.getElementById('sidePanel').innerHTML=workerPanelHtml(flow.linkedWorkers)
  setView(key,usageHtml(flow.usage)+'<div class="term-flow">'+renderFlow(flow.steps)+'</div>'+(flow.truncated?'<div class="small muted">(last '+flow.steps.length+' of '+flow.total+')</div>':''))
  watchDetail(active?'subagent:'+sid+':'+aid:null, ()=>openSub(aid,true))
}
// ==== human-takeover UI (codex / deepseek / antigravity / opencode / copilot) ======
// activeTakeover holds THIS tab's live view of an in-progress takeover: the open
// WebSocket + mounted xterm.js Terminal (+ its FitAddon/ResizeObserver, if the fit addon
// loaded). Never persisted anywhere — a page reload loses this tab's live terminal
// (Phase 1: no reconnect, see the SDD's non-goals). The token lives only in the WS URL
// built in takeoverMount and is never logged to the console (matches the server-side
// "never log the token" invariant).
let activeTakeover=null

function takeoverTeardown(){
  if(!activeTakeover) return
  const at=activeTakeover; activeTakeover=null
  try{ if(at.resizeObserver) at.resizeObserver.disconnect() }catch(e){}
  try{ at.ws.close() }catch(e){}
  try{ at.term.dispose() }catch(e){}
}

function takeoverStart(id,backend){
  fetch('/api/worker/'+encodeURIComponent(id)+'/takeover',{method:'POST',headers:{'X-CLI-Dispatch-Takeover':'1'}})
    .then(r=>r.json().then(body=>({ok:r.ok,body:body})))
    .then(res=>{ if(!res.ok) throw new Error((res.body&&res.body.error)||'takeover failed'); takeoverMount(id,res.body,backend) })
    .catch(e=>{ alert('Take control failed: '+e.message) })
}

// Builds the terminal DOM + opens the WS, per the SDD flow: POST takeover -> open WS
// with token -> xterm attaches. Resolved same-origin (location.protocol/host), never
// hardcoded — this server may have hopped to a different port on EADDRINUSE.
function takeoverMount(id,res,backend){
  takeoverTeardown()
  const el=document.getElementById('takeover')
  el.style.display='block'
  el.innerHTML='<div class="tkbar"><button class="tkbtn tkbtn-off" id="tkBackBtn">Hand back</button><span class="small muted">live terminal · '+esc(backend||'?')+'</span></div><div class="term-wrap"><div id="tkTerm"></div></div>'
  document.getElementById('tkBackBtn').onclick=()=>takeoverHandback(id)
  const term=new Terminal({cols:res.cols||80,rows:res.rows||24,convertEol:true,theme:{background:'#000000',foreground:'#e6edf3'}})
  let fit=null
  if(window.FitAddon&&window.FitAddon.FitAddon){ fit=new window.FitAddon.FitAddon(); term.loadAddon(fit) }
  term.open(document.getElementById('tkTerm'))
  const proto=(location.protocol==='https:'?'wss://':'ws://')
  const ws=new WebSocket(proto+location.host+res.ws+'?token='+encodeURIComponent(res.token))
  activeTakeover={id:id,ws:ws,term:term,fit:fit,resizeObserver:null}
  // Keystrokes typed before the WS handshake completes (PTY spawn + upgrade round-trip is
  // not instant) must not be silently dropped — buffer them and flush in order on 'open'.
  let pendingInput=''
  const sendResize=()=>{
    if(!fit) return
    try{ fit.fit() }catch(e){ return }
    if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({t:'r',cols:term.cols,rows:term.rows}))
  }
  ws.addEventListener('open', ()=>{
    if(pendingInput){ ws.send(JSON.stringify({t:'i',d:pendingInput})); pendingInput='' }
    sendResize()
  })
  ws.addEventListener('message', ev=>{
    let msg=null
    try{ msg=JSON.parse(ev.data) }catch(e){ return }
    if(!msg) return
    if(msg.t==='o') term.write(msg.d)
    else if(msg.t==='exit'){ term.write('\\r\\n\\r\\n[session ended, code '+msg.code+']\\r\\n'); term.options.disableStdin=true }
  })
  ws.addEventListener('close', ()=>{ term.options.disableStdin=true })
  term.onData(d=>{ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({t:'i',d:d})); else pendingInput+=d })
  if(fit){
    const wrap=document.querySelector('#takeover .term-wrap')
    const ro=new ResizeObserver(sendResize)
    ro.observe(wrap)
    activeTakeover.resizeObserver=ro
  }
}

function takeoverHandback(id){
  fetch('/api/worker/'+encodeURIComponent(id)+'/handback',{method:'POST',headers:{'X-CLI-Dispatch-Takeover':'1'}})
    .catch(()=>{})
    .then(()=>{
      takeoverTeardown()
      const el=document.getElementById('takeover'); el.style.display='none'; el.innerHTML=''
      loadList()
    })
}

// Renders the take-control/hand-back bar for the currently open worker. Called from
// openWorker() on every render, including SSE-triggered refreshes — but if THIS tab
// already holds the live terminal for this worker id, it's a deliberate no-op (leaving
// the mounted xterm.js instance + its WebSocket alone; rebuilding the DOM here on every
// refresh would tear down a live terminal mid-session).
function renderTakeoverBar(w){
  const el=document.getElementById('takeover')
  if(activeTakeover&&activeTakeover.id===w.id){ el.style.display='block'; return }
  if(activeTakeover&&activeTakeover.id!==w.id) takeoverTeardown()
  if(w.state==='running'&&['codex','deepseek','antigravity','opencode','copilot'].includes(w.backend)){
    el.style.display='block'
    el.innerHTML='<div class="tkbar"><button class="tkbtn" id="tkStartBtn" title="Take control of this session">Take control</button></div>'
    document.getElementById('tkStartBtn').onclick=()=>takeoverStart(w.id,w.backend)
    return
  }
  if(w.state==='human-controlled'){
    el.style.display='block'
    el.innerHTML='<div class="tkbar"><span class="small muted">human-controlled (attach from the tab that started it, or hand back)</span><button class="tkbtn tkbtn-off" id="tkBackBtn2">Hand back</button></div>'
    document.getElementById('tkBackBtn2').onclick=()=>takeoverHandback(w.id)
    return
  }
  el.style.display='none'; el.innerHTML=''
}
// ==== end human-takeover UI ========================================================
async function openWorker(w){
  sel=w.id;
  document.getElementById('sidePanel').innerHTML=''
  document.getElementById('crumb').innerHTML='<a onclick="back()">workers</a> › '+esc(w.backend)+' <span class="c">'+(w.model?esc(w.model):'default')+'</span> '+esc(w.id.slice(0,12))+' <span class="muted">('+esc(w.stale?'stale':w.state)+')</span>'
  renderTakeoverBar(w)
  const taskPanel=document.querySelector('#view details.panel.task'); const taskOpen=taskPanel?taskPanel.open:false
  const key='worker:'+w.id
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const flow=await j('/api/worker/'+w.id+'/flow')
  let h=''
  if(flow.prompt) h+='<details class="panel task"'+(taskOpen?' open':'')+'><summary>Görev / talimat</summary><div class="sabody"><div class="md">'+md(flow.prompt)+'</div></div></details>'
  h+=usageHtml(flow.usage)
  h+=babysitterUsageHtml(w, flow.usage)
  h+='<div class="term-flow">'+renderFlow(flow.steps)
  if(flow.finalResultPreview) h+='<div class="step message" style="margin-top:10px">⏺ <b>result:</b> '+esc(flow.finalResultPreview)+'</div>'
  h+='</div>'
  setView(key,h); loadList()
  watchDetail(((w.state==='running'&&!w.stale)||w.state==='human-controlled')?'worker:'+w.id:null, ()=>openWorker(w))
}
async function openConfigView() {
  sel = null
  window._cur = { type: 'config' }
  takeoverTeardown()
  document.getElementById('takeover').style.display = 'none'
  document.getElementById('takeover').innerHTML = ''
  document.getElementById('crumb').innerHTML = 'Configuration'
  const v = document.getElementById('view')
  v.className = ''
  v.innerHTML = 'loading…'
  loadList()
  await renderConfigEditor()
}
async function saveConfig(key, isSecret) {
  const input = document.getElementById('input_' + key)
  const errSpan = document.getElementById('err_' + key)
  if (!input || !errSpan) return
  errSpan.textContent = ''
  const val = input.value
  if (isSecret && val === '') return
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CLI-Dispatch-Takeover': '1'
      },
      body: JSON.stringify({ key, value: val })
    })
    const body = await res.json()
    if (!res.ok) {
      errSpan.textContent = body.error || 'Save failed'
      return
    }
    if (isSecret) input.value = ''
    await renderConfigEditor()
  } catch (e) {
    errSpan.textContent = e.message
  }
}
async function renderConfigEditor() {
  const v = document.getElementById('view')
  const key = 'config'
  try {
    const cfg = await j('/api/config')
    const groups = [
      { name: 'DeepSeek', keys: ['DEEPSEEK_API_KEY', 'DS_MODEL', 'DS_FLASH_MODEL'] },
      { name: 'Antigravity', keys: ['GEMINI_API_KEY', 'AG_MODEL'] },
      { name: 'Codex', keys: ['CODEX_API_KEY', 'CX_MODEL'] },
      { name: 'OpenCode', keys: ['OPENROUTER_API_KEY', 'OC_MODEL'] },
      { name: 'Copilot', keys: ['COPILOT_GITHUB_TOKEN', 'CP_MODEL'] }
    ]
    let html = '<div style="max-width:800px">'
    for (const g of groups) {
      html += '<div class="panel">'
      html += '<div style="padding:8px 12px;border-bottom:1px solid var(--bd);font-weight:bold;color:var(--acc)">' + esc(g.name) + ' Backend</div>'
      html += '<div class="sabody" style="padding:12px">'
      for (const k of g.keys) {
        const item = cfg[k]
        if (!item) continue
        html += '<div class="cfg-row">'
        html += '<div class="cfg-label">' + esc(k)
        if (item.secret) {
          if (item.set) {
            html += '<span class="badge ok">● set</span>'
          } else {
            html += '<span class="badge muted">○ not set</span>'
          }
        }
        html += '</div>'
        html += '<div class="cfg-field">'
        if (item.secret) {
          html += '<input type="password" class="cfg-input" id="input_' + escAttr(k) + '" placeholder="enter new key to update, leave blank to keep current">'
          html += '<button class="tkbtn" onclick="saveConfig(\\'' + escAttr(k) + '\\', true)">Save</button>'
        } else {
          html += '<input type="text" class="cfg-input" id="input_' + escAttr(k) + '" value="' + escAttr(item.value) + '">'
          html += '<button class="tkbtn" onclick="saveConfig(\\'' + escAttr(k) + '\\', false)">Save</button>'
        }
        html += '<span id="err_' + escAttr(k) + '" class="err" style="margin-left:8px"></span>'
        html += '</div>'
        if (!item.secret && k.endsWith('_MODEL')) {
          html += '<div class="small muted" style="margin-top:2px">Single default model, used only when no --model is passed. For multi-candidate selection (babysitter picks one), list the candidates in the task prompt instead — this field always holds exactly one value.</div>'
        }
        html += '</div>'
      }
      html += '</div></div>'
    }
    html += '</div>'
    setView(key, html)
  } catch (e) {
    setView(key, '<div class="err">Failed to load configuration: ' + esc(e.message) + '</div>')
  }
}
function reopen(sid){ fetch('/api/sessions').then(r=>r.json()).then(ss=>{const s=ss.find(x=>x.id===sid); if(s) openSession(s)}) }
function back(){ watchDetail(null); takeoverTeardown(); { const tk=document.getElementById('takeover'); tk.style.display='none'; tk.innerHTML='' } sel=null; window._cur=null; document.getElementById('crumb').textContent='Select a session…'; const v=document.getElementById('view'); v._k=null; v._h=null; v.className='empty'; v.innerHTML='←'; document.getElementById('sidePanel').innerHTML=''; loadList() }
document.getElementById('tabCC').onclick=()=>{mode='cc';document.getElementById('tabCC').classList.add('on');document.getElementById('tabW').classList.remove('on');document.getElementById('tabConfig').classList.remove('on');back()}
document.getElementById('tabW').onclick=()=>{mode='w';wFlt='all';document.getElementById('tabW').classList.add('on');document.getElementById('tabCC').classList.remove('on');document.getElementById('tabConfig').classList.remove('on');back()}
document.getElementById('tabConfig').onclick=()=>{mode='config';document.getElementById('tabConfig').classList.add('on');document.getElementById('tabCC').classList.remove('on');document.getElementById('tabW').classList.remove('on');openConfigView()}
loadList()
// Live list: SSE pushes a change whenever sessions/workers state changes (busy/idle flips, new runs).
const listES=new EventSource('/api/stream?watch=sessions')
listES.addEventListener('change', ()=>{ if(!sel) loadList() })
</script></body></html>`
