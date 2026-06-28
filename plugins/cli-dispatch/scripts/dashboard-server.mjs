#!/usr/bin/env node
// dashboard-server.mjs — cli-dispatch dashboard.
// A self-contained, read-only local web dashboard over data that already lives on disk:
//   • active Claude Code CLI sessions → their flow → the subagents they spawned → each subagent's flow
//   • cli-dispatch worker delegations (DeepSeek / Antigravity / Codex)
// Stdlib only (node:http/fs/path/os) — no npm deps, matching the existing parsers.
// Binds 127.0.0.1 ONLY. Never reads config/secrets. All :id params are path-sanitised.
//
// The Claude Code on-disk formats (~/.claude/sessions, ~/.claude/projects/**) are internal
// and may change across Claude Code versions — the mappers degrade gracefully on unknown shapes.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const HOME = os.homedir()
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects')
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
        const tail = lastJSON(readTail(file)) || {}
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
        })
      }
    }
  }
  const rank = (s) => (s.status === 'busy' ? 0 : s.status === 'idle' ? 1 : 2)
  out.sort((a, b) => rank(a) - rank(b) || (b.mtime - a.mtime))
  return out
}

// ---- flow mapper (shared by session + subagent transcripts) ----
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
  return { steps, total, truncated: total > slice.length }
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
function listWorkers() {
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
      usage: s.usage || null,
      finalResultPreview: clip(s.finalResultPreview, 200),
    })
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
  return { steps, state: s.state || '?', prompt, model: m.model || '', cwd: m.cwd || '', startedAt: m.startedAt || '', finalResultPreview: clip(s.finalResultPreview, 600) }
}

// ---- routing ----
// Heuristic link: a Claude Code subagent/session that delegated to a cli-dispatch worker
// prints the worker's session id to stderr (e.g. "dir: …/sessions/<id>"), which lands in the
// transcript. Scan the transcript for any known worker id → linkable ds/ag/cx worker sessions.
function linkedWorkers(file) {
  let txt = ''; try { txt = readTail(file, 2 * 1024 * 1024) } catch { return [] }
  if (!txt) return []
  const out = [], seen = new Set()
  for (const w of listWorkers()) {
    if (w.id && !seen.has(w.id) && txt.includes(w.id)) { seen.add(w.id); out.push({ id: w.id, backend: w.backend, state: w.state, prompt: w.prompt }) }
  }
  return out
}

function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}
const okId = (id) => typeof id === 'string' && ID_RE.test(id)

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

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = u.pathname
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return
    }
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return }
    if (p === '/api/stream') return sse(req, res, u.searchParams.get('watch') || 'sessions')
    if (p === '/api/sessions') return send(res, 200, listSessions())
    if (p === '/api/workers') return send(res, 200, listWorkers())

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
    send(res, 404, { error: 'no route' })
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) })
  }
})

function listen(port, tries = 12) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) { listen(port + 1, tries - 1) }
    else { console.error('dashboard: ' + e.message); process.exit(1) }
  })
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port
    console.error('cli-dispatch dashboard → ' + url + '  (read-only; Ctrl-C to stop)')
    if (OPEN) {
      const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'explorer.exe' : 'xdg-open')
      try { spawnSync(cmd, [url], { stdio: 'ignore' }) } catch {}
    }
  })
}
listen(PORT)

// ---- embedded single-page UI ----
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cli-dispatch dashboard</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--bd:#30363d;--fg:#e6edf3;--dim:#8b949e;--acc:#ff7a18;--g:#3fb950;--y:#d29922;--lnk:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:8px 14px;border-bottom:1px solid var(--bd);display:flex;gap:10px;align-items:center}
header b{color:var(--acc)} .grow{flex:1}
.layout{display:grid;grid-template-columns:320px 1fr;height:calc(100vh - 41px)}
.rail{border-right:1px solid var(--bd);overflow:auto}
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
.step.tool{border-color:var(--acc)}.step.prompt{border-color:var(--lnk)}.step.message{border-color:#444c56}
.step.thinking{border-color:#373e47;color:var(--dim)}.step.log{border-color:#373e47}
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
</style></head><body>
<header><b>cli-dispatch</b> <span class="muted">dashboard</span><span class="grow"></span>
<span class="small muted" id="meta"></span><span class="small muted">· read-only · localhost</span></header>
<div class="layout">
 <div class="rail">
   <div class="tabs"><div class="tab on" id="tabCC">Claude Code</div><div class="tab" id="tabW">cli-dispatch workers</div></div>
   <div id="filter" class="filter"></div>
   <div id="list"></div>
 </div>
 <div class="main"><div class="crumb" id="crumb">Select a session…</div><div id="view" class="empty">←</div></div>
</div>
<script>
let mode='cc', sel=null, flt='all'
function setFilter(k){ flt=k; loadList() }
// Live updates via Server-Sent Events. One detail stream for the open item; it
// pushes a 'change' event whenever the watched file/dir changes (fs.watch).
let detailES=null, detailSpec=null
function watchDetail(spec, fn){
  if(spec===detailSpec) return
  if(detailES){ detailES.close(); detailES=null }
  detailSpec=spec||null
  if(!spec) return
  detailES=new EventSource('/api/stream?watch='+encodeURIComponent(spec))
  detailES.addEventListener('change', fn)
}
const E=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstChild}
const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
// Minimal, XSS-safe Markdown renderer (escape-FIRST, then a whitelist of transforms; never
// passes raw HTML through). Used only for message/prompt/result text. BT avoids literal
// backticks (this whole page is a backtick template on the server side).
const BT=String.fromCharCode(96)
function mdInline(x){
  const cs=[]; const ps=x.split(BT); let r=''
  for(let i=0;i<ps.length;i++){ if(i%2===1){cs.push(ps[i]); r+=' C'+(cs.length-1)+' '} else r+=ps[i] }
  r=r.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
  r=r.replace(/\\*([^*]+)\\*/g,'<em>$1</em>')
  r=r.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,(m,tt,u)=>{const safe=/^(https?:\\/\\/|\\/)/.test(u)?u:'#';return '<a href="'+safe+'" target="_blank" rel="noopener">'+tt+'</a>'})
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
async function j(u){const r=await fetch(u);return r.json()}

async function loadList(){
  const el=document.getElementById('list'); el.innerHTML=''
  const fb=document.getElementById('filter')
  if(mode==='cc'){
    const ss=await j('/api/sessions')
    const counts={busy:0,idle:0,closed:0}; ss.forEach(s=>counts[s.status]=(counts[s.status]||0)+1)
    fb.style.display='flex'
    fb.innerHTML=[['all',ss.length],['busy',counts.busy],['idle',counts.idle],['closed',counts.closed]].map(([k,n])=>'<span class="fchip'+(flt===k?' on':'')+'" onclick="setFilter(\\''+k+'\\')">'+k+'<span class="c">'+n+'</span></span>').join('')
    document.getElementById('meta').textContent=ss.length+' sessions'
    const shown=flt==='all'?ss:ss.filter(s=>s.status===flt)
    shown.forEach(s=>{
      const it=E('<div class="item'+(sel===s.id?' sel':'')+'"><div><span class="dot '+s.status+'"></span>'+esc(s.project.replace(/^-/,'').split('-').slice(-2).join('/'))+'<span class="badge">'+s.status+'</span>'+(s.subagentCount?'<span class="badge">'+s.subagentCount+' sub</span>':'')+'</div><div class="small muted">'+esc(s.firstPrompt||s.id.slice(0,8))+'</div><div class="small muted">'+esc(fmtDT(s.lastActivityAt))+' · '+s.sizeKB+'KB</div></div>')
      it.onclick=()=>openSession(s); el.appendChild(it)
    })
  }else{
    fb.style.display='none'
    const ws=await j('/api/workers')
    document.getElementById('meta').textContent=ws.length+' workers'
    ws.forEach(w=>{
      const live=w.state==='running'&&!w.stale
      const dot=live?'busy':w.state==='done'?'closed':'idle'
      const badge=w.stale?'stale':w.state
      const it=E('<div class="item'+(sel===w.id?' sel':'')+'"><div><span class="dot '+dot+'"></span>'+esc(w.backend)+'<span class="badge">'+esc(badge)+'</span></div><div class="small muted">'+esc(w.prompt||w.id.slice(0,8))+'</div><div class="small muted">'+esc(fmtDT(w.started))+(w.lastTool?' · '+esc(w.lastTool):'')+'</div></div>')
      it.onclick=()=>openWorker(w); el.appendChild(it)
    })
  }
}
function renderFlow(steps){
  if(!steps||!steps.length) return '<div class="empty">no steps</div>'
  return steps.slice().reverse().map(s=>{
    if(s.kind==='tool'){
      const st=s.ok===true?'<span class="ok">⎿ ok</span>':s.ok===false?'<span class="err">⎿ error</span>':''
      let head='⏺ <span class="k">'+esc(s.name)+'</span> '+esc(s.summary||'')
      if(s.spawnsAgent) head='⏺ <span class="k">'+esc(s.name)+'</span> <a class="agentlink" onclick="openSub(\\''+s.spawnsAgent+'\\')">→ '+esc(s.summary||'subagent')+'</a>'
      return '<div class="step tool">'+head+(st?'<div class="small">'+st+' '+esc(s.result||'')+'</div>':'')+'</div>'
    }
    if(s.kind==='prompt') return '<div class="step prompt">▸ <span class="md">'+md(s.text)+'</span></div>'
    if(s.kind==='message') return '<div class="step message">⏺ <span class="md">'+md(s.text)+'</span></div>'
    if(s.kind==='thinking') return '<div class="step thinking">✻ '+esc(s.text)+'</div>'
    return '<div class="step log">'+esc(s.text)+'</div>'
  }).join('')
}
function workerPanelHtml(lw){ if(!lw||!lw.length) return ''
  return '<details class="panel wk"><summary>Worker sessions (ds/ag/cx) <span class="badge">'+lw.length+'</span></summary><div class="sabody">'+lw.map(w=>'<span class="sa" onclick="openWorkerById(\\''+w.id+'\\')">'+esc(w.backend)+': '+esc(w.prompt||w.id.slice(0,12))+' <span class="c">'+esc(w.stale?'stale':w.state)+'</span></span>').join('')+'</div></details>' }
function openWorkerById(id){ fetch('/api/workers').then(r=>r.json()).then(ws=>{const w=ws.find(x=>x.id===id); if(!w) return; mode='w'; document.getElementById('tabW').classList.add('on'); document.getElementById('tabCC').classList.remove('on'); openWorker(w)}) }
function chipHtml(a){const t=fmtTime(a.startedAt);return '<span class="sa'+(a.active?' act':'')+'" onclick="openSub(\\''+a.agentId+'\\','+(a.active?'true':'false')+')">'+(a.active?'● ':'')+esc(a.agentType)+': '+esc(a.description||a.agentId.slice(0,8))+(a.spawnDepth>1?' ·d'+a.spawnDepth:'')+(t?' <span class="c">'+t+'</span>':'')+'</span>'}
async function openSession(s){
  sel=s.id; mode='cc'
  document.getElementById('crumb').innerHTML='<a onclick="back()">sessions</a> › '+esc(s.id.slice(0,8))+' <span class="muted">('+esc(s.status)+')</span>'
  const prevPanel=document.querySelector('#view details.restpanel'); const subsOpen=prevPanel?prevPanel.open:false
  const v=document.getElementById('view'); v.className=''; v.innerHTML='loading…'
  const [flow,subs]=await Promise.all([j('/api/session/'+s.id+'/flow'),j('/api/session/'+s.id+'/subagents')])
  window._cur={type:'session',id:s.id}
  let h=''
  if(subs.length){
    const act=subs.filter(a=>a.active), rest=subs.filter(a=>!a.active)
    if(act.length) h+='<details class="panel act" open><summary>Active subagents <span class="badge">'+act.length+'</span></summary><div class="sabody">'+act.map(chipHtml).join('')+'</div></details>'
    if(rest.length) h+='<details class="panel restpanel"'+(subsOpen?' open':'')+'><summary>Subagents <span class="badge">'+rest.length+'</span></summary><div class="sabody">'+rest.map(chipHtml).join('')+'</div></details>'
  }
  h+=workerPanelHtml(flow.linkedWorkers)
  h+=renderFlow(flow.steps)+(flow.truncated?'<div class="small muted">(showing last '+flow.steps.length+' of '+flow.total+')</div>':'')
  v.innerHTML=h; loadList()
  watchDetail(s.status==='busy'?'session:'+s.id:null, ()=>openSession(s))
}
async function openSub(aid,active){
  const sid=window._cur&&window._cur.type==='session'?window._cur.id:(window._cur&&window._cur.sid)
  if(!sid) return;
  document.getElementById('crumb').innerHTML='<a onclick="back()">sessions</a> › <a onclick="reopen(\\''+sid+'\\')">'+esc(sid.slice(0,8))+'</a> › <span class="k">subagent '+esc(aid.slice(0,8))+'</span>'+(active?' <span class="live">● live</span>':'')
  const v=document.getElementById('view'); v.className=''; if(!v.querySelector('.step')) v.innerHTML='loading…'
  const flow=await j('/api/subagent/'+sid+'/'+aid+'/flow')
  window._cur={type:'sub',sid:sid,aid:aid}
  v.innerHTML=workerPanelHtml(flow.linkedWorkers)+renderFlow(flow.steps)+(flow.truncated?'<div class="small muted">(last '+flow.steps.length+' of '+flow.total+')</div>':'')
  watchDetail(active?'subagent:'+sid+':'+aid:null, ()=>openSub(aid,true))
}
async function openWorker(w){
  sel=w.id;
  document.getElementById('crumb').innerHTML='<a onclick="back()">workers</a> › '+esc(w.backend)+' '+esc(w.id.slice(0,12))+' <span class="muted">('+esc(w.state)+')</span>'
  const v=document.getElementById('view'); v.className=''; v.innerHTML='loading…'
  const flow=await j('/api/worker/'+w.id+'/flow')
  let h=''
  if(flow.prompt) h+='<details class="panel task"><summary>Görev / talimat</summary><div class="sabody"><div class="md">'+md(flow.prompt)+'</div></div></details>'
  h+=renderFlow(flow.steps)
  if(flow.finalResultPreview) h+='<div class="step message" style="margin-top:10px">⏺ <b>result:</b> '+esc(flow.finalResultPreview)+'</div>'
  v.innerHTML=h; loadList()
  watchDetail((w.state==='running'&&!w.stale)?'worker:'+w.id:null, ()=>openWorker(w))
}
function reopen(sid){ fetch('/api/sessions').then(r=>r.json()).then(ss=>{const s=ss.find(x=>x.id===sid); if(s) openSession(s)}) }
function back(){ watchDetail(null); sel=null; window._cur=null; document.getElementById('crumb').textContent='Select a session…'; document.getElementById('view').className='empty'; document.getElementById('view').innerHTML='←'; loadList() }
document.getElementById('tabCC').onclick=()=>{mode='cc';document.getElementById('tabCC').classList.add('on');document.getElementById('tabW').classList.remove('on');back()}
document.getElementById('tabW').onclick=()=>{mode='w';document.getElementById('tabW').classList.add('on');document.getElementById('tabCC').classList.remove('on');back()}
loadList()
// Live list: SSE pushes a change whenever sessions/workers state changes (busy/idle flips, new runs).
const listES=new EventSource('/api/stream?watch=sessions')
listES.addEventListener('change', ()=>{ if(!sel) loadList() })
</script></body></html>`
