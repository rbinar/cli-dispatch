#!/usr/bin/env node
// cli-dispatch-clean.mjs — the standalone cleanup engine shared by /cli-dispatch:clean and the
// scheduled (cron/launchd/Scheduled-Task) auto-clean. Removes stale worker session dirs: a
// worker killed before finalize leaves status.json stuck at state:"running" forever. Detection
// is by status.json mtime (running + idle > stale-secs ⇒ dead). Read-only/no-network; only
// touches dirs under the sessions root.
//
//   node cli-dispatch-clean.mjs [--remove] [--stale-secs N] [--older-than DAYS] [--quiet]
//
// Default is a DRY-RUN (lists only). --remove deletes. --older-than also prunes finished
// (done/error) sessions older than DAYS. A genuinely-running worker (recent write) is never
// touched.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
let remove = false, staleSecs = 600, olderDays = 0, quiet = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--remove') remove = true
  else if (a === '--quiet') quiet = true
  else if (a === '--stale-secs') staleSecs = parseInt(argv[++i], 10)
  else if (a === '--older-than') olderDays = parseInt(argv[++i], 10)
}
if (!Number.isFinite(staleSecs) || staleSecs < 0) staleSecs = 600
if (!Number.isFinite(olderDays) || olderDays < 0) olderDays = 0

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
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} } }
const fmtAge = (s) => s == null ? '?' : (s > 86400 ? (s / 86400).toFixed(1) + 'd' : (s / 3600).toFixed(1) + 'h')

const stale = [], old = []
let kept = 0
for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d)
  try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
  const st = read(path.join(dir, 'status.json')), m = read(path.join(dir, 'meta.json'))
  const state = st.state || m.state || '?'
  let mtime = 0; try { mtime = fs.statSync(path.join(dir, 'status.json')).mtimeMs } catch {}
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
if (olderDays > 0) {
  log(`old finished (done/error, started > ${olderDays}d ago): ${old.length}`)
  for (const x of old) log(`  ${String(x.backend).padEnd(11)} ${String(x.state).padEnd(6)} ${x.d}  ${x.started}`)
}

const targets = [...stale, ...old]
if (!targets.length) { log('nothing to clean.'); process.exit(0) }
if (remove) {
  let n = 0
  for (const x of targets) {
    try { fs.rmSync(path.join(root, x.d), { recursive: true, force: true }); n++ }
    catch (e) { log(`  FAILED ${x.d}: ${e.message}`) }
  }
  log(`removed ${n}/${targets.length} dir(s). kept ${kept} live/recent.`)
} else {
  log(`DRY-RUN — nothing deleted. Re-run with --remove to delete the ${targets.length} dir(s) above.`)
}
