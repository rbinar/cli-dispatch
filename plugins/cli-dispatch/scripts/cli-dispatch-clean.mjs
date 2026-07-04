#!/usr/bin/env node
// cli-dispatch-clean.mjs — the standalone cleanup engine shared by /cli-dispatch:clean and the
// scheduled (cron/launchd/Scheduled-Task) auto-clean. Removes stale worker session dirs: a
// worker killed before finalize leaves status.json stuck at state:"running" forever. Detection
// is by status.json mtime (running + idle > stale-secs ⇒ dead). Read-only/no-network; only
// touches dirs under the sessions root.
//
//   node cli-dispatch-clean.mjs [--remove] [--stale-secs N] [--older-than DAYS]
//                                [--takeover-stale-mins N] [--quiet]
//
// Default is a DRY-RUN (lists only). --remove deletes. --older-than also prunes finished
// (done/error) sessions older than DAYS. A genuinely-running worker (recent write) is never
// touched.
//
// human-controlled sessions (see .specs/dev/sdd/human-takeover.md, TL11/TL18): this is a
// NON-terminal state (a human may be silently typing in a live PTY for a long time), so it is
// NEVER treated like a stale headless "running" session — the mtime/stale-secs heuristic does
// not apply. Instead, this is the SECONDARY (heartbeat-based) orphan-reap layer: if the
// session's takeover.lastHeartbeat is itself stale (dashboard-server died — SIGKILL/OOM/
// power-loss — the case the PRIMARY process-lifecycle layer in pty-host.mjs can't catch), we
// downgrade status.json.state to 'error' in place via clearTakeoverState. We never rmSync the
// directory for this case — that's reserved for the existing stale/old deletion paths.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readJsonFile, clearTakeoverState } from './parse-utils.mjs'

const argv = process.argv.slice(2)
let remove = false, staleSecs = 600, olderDays = 0, quiet = false, takeoverStaleMins = 10
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--remove') remove = true
  else if (a === '--quiet') quiet = true
  else if (a === '--stale-secs') staleSecs = parseInt(argv[++i], 10)
  else if (a === '--older-than') olderDays = parseInt(argv[++i], 10)
  else if (a === '--takeover-stale-mins') takeoverStaleMins = parseInt(argv[++i], 10)
}
if (!Number.isFinite(staleSecs) || staleSecs < 0) staleSecs = 600
if (!Number.isFinite(olderDays) || olderDays < 0) olderDays = 0
if (!Number.isFinite(takeoverStaleMins) || takeoverStaleMins <= 0) takeoverStaleMins = 10

const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
let root = process.env.CLI_DISPATCH_SESSIONS_DIR || process.env.CLAUDE_DS_SESSIONS_DIR
if (!root) {
  root = path.join(cache, 'cli-dispatch', 'sessions')
  if (!fs.existsSync(root) && fs.existsSync(path.join(cache, 'claude-ds', 'sessions'))) {
    root = path.join(cache, 'claude-ds', 'sessions')
  }
}
const log = (...m) => { if (!quiet) console.log(...m) }
if (!fs.existsSync(root)) { log(`(no sessions dir: ${root})`); process.exit(0) }

const now = Date.now()
const fmtAge = (s) => s == null ? '?' : (s > 86400 ? (s / 86400).toFixed(1) + 'd' : (s / 3600).toFixed(1) + 'h')

const stale = [], old = [], reapCandidates = []
let kept = 0
for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d)
  try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
  const statusFile = path.join(dir, 'status.json')
  const st = readJsonFile(statusFile), m = readJsonFile(path.join(dir, 'meta.json'))
  const state = st.state || m.state || '?'

  // Secondary (heartbeat-based) reap layer for human-controlled sessions — TL11/TL18. A
  // healthy (recent-heartbeat) human-controlled session is never touched here; only one
  // whose heartbeat itself went stale (server-death orphan) gets downgraded to 'error'.
  if (state === 'human-controlled') {
    const hbMs = Date.parse(st.takeover?.lastHeartbeat || '')
    const idleSecs = Number.isFinite(hbMs) ? Math.round((now - hbMs) / 1000) : null
    if (idleSecs == null || idleSecs > takeoverStaleMins * 60) {
      reapCandidates.push({
        d, backend: st.backend || m.backend || '?', idle: idleSecs,
        ptyPid: st.takeover?.ptyPid, ptyPgid: st.takeover?.ptyPgid
      })
    } else {
      kept++
    }
    continue
  }

  let mtime = 0; try { mtime = fs.statSync(statusFile).mtimeMs } catch {}
  if (state === 'running' && mtime && (now - mtime > staleSecs * 1000)) {
    stale.push({ d, backend: st.backend || m.backend || '?', idle: Math.round((now - mtime) / 1000) }); continue
  }
  if (olderDays > 0 && (state === 'done' || state === 'error')) {
    const started = Date.parse(m.startedAt || '') || 0
    if (started && (now - started > olderDays * 86400 * 1000)) {
      old.push({ d, backend: st.backend || m.backend || '?', state, started: m.startedAt }); continue
    }
  }
  kept++
}

log(`root: ${root}`)
log(`stale (running but dead, idle > ${staleSecs}s): ${stale.length}`)
for (const x of stale) log(`  ${String(x.backend).padEnd(11)} ${x.d}  idle ${fmtAge(x.idle)}`)
log(`human-controlled reap candidates (heartbeat stale > ${takeoverStaleMins}m): ${reapCandidates.length}`)
for (const x of reapCandidates) {
  const pidNote = Number.isFinite(x.ptyPgid) && x.ptyPgid > 0
    ? ` (would kill pty group ${x.ptyPgid})`
    : (Number.isFinite(x.ptyPid) && x.ptyPid > 0 ? ` (would kill pty ${x.ptyPid})` : '')
  log(`  ${String(x.backend).padEnd(11)} ${x.d}  heartbeat ${x.idle == null ? 'missing/unparseable' : 'idle ' + fmtAge(x.idle)}${pidNote}`)
}
if (olderDays > 0) {
  log(`old finished (done/error, started > ${olderDays}d ago): ${old.length}`)
  for (const x of old) log(`  ${String(x.backend).padEnd(11)} ${String(x.state).padEnd(6)} ${x.d}  ${x.started}`)
}

const targets = [...stale, ...old]
if (!targets.length && !reapCandidates.length) { log('nothing to clean.'); process.exit(0) }
if (remove) {
  let n = 0
  for (const x of targets) {
    try { fs.rmSync(path.join(root, x.d), { recursive: true, force: true }); n++ }
    catch (e) { log(`  FAILED ${x.d}: ${e.message}`) }
  }
  let reaped = 0
  for (const x of reapCandidates) {
    try {
      let killed = ''
      if (Number.isFinite(x.ptyPgid) && x.ptyPgid > 0) {
        try { process.kill(-x.ptyPgid, 'SIGKILL'); killed = `pgid ${x.ptyPgid}` }
        catch (e) { if (e.code !== 'ESRCH') log(`  note: kill pgid ${x.ptyPgid} for ${x.d}: ${e.message}`) }
      } else if (Number.isFinite(x.ptyPid) && x.ptyPid > 0) {
        try { process.kill(x.ptyPid, 'SIGKILL'); killed = `pid ${x.ptyPid}` }
        catch (e) { if (e.code !== 'ESRCH') log(`  note: kill pid ${x.ptyPid} for ${x.d}: ${e.message}`) }
      }
      clearTakeoverState(path.join(root, x.d, 'status.json'), {
        finalState: 'error',
        error: 'stale human-takeover session reaped (no heartbeat)'
      })
      reaped++
      log(`  reaped ${x.d}${killed ? ` (killed pty ${killed})` : ''}`)
    } catch (e) { log(`  FAILED reap ${x.d}: ${e.message}`) }
  }
  log(`removed ${n}/${targets.length} dir(s), reaped ${reaped}/${reapCandidates.length} human-controlled session(s). kept ${kept} live/recent.`)
} else {
  log(`DRY-RUN — nothing deleted/rewritten. Re-run with --remove to delete the ${targets.length} dir(s) and reap the ${reapCandidates.length} human-controlled session(s) above.`)
}
