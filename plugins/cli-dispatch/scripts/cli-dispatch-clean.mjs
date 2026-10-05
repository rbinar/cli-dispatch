#!/usr/bin/env node
// cli-dispatch-clean.mjs — the standalone cleanup engine shared by /cli-dispatch:clean and the
// scheduled (cron/launchd/Scheduled-Task) auto-clean. Removes stale worker session dirs: a
// worker killed before finalize leaves status.json stuck at state:"running" forever. Detection
// is by status.json mtime (running + idle > stale-secs ⇒ dead). Read-only/no-network; only
// touches dirs under the sessions root.
//
//   node cli-dispatch-clean.mjs [--remove] [--stale-secs N] [--older-than DAYS]
//                                [--preserve-verdicts|--no-preserve-verdicts]
//                                [--quiet]
//
// Default is a DRY-RUN (lists only). --remove deletes. --older-than also prunes finished
// (done/error) sessions older than DAYS. A genuinely-running worker (recent write) is never
// touched.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readJsonFile, TERMINAL_STATES } from './parse-utils.mjs'

const argv = process.argv.slice(2)
let remove = false, staleSecs = 600, olderDays = 0, quiet = false, preserveVerdicts = true
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--remove') remove = true
  else if (a === '--quiet') quiet = true
  else if (a === '--preserve-verdicts') preserveVerdicts = true
  else if (a === '--no-preserve-verdicts') preserveVerdicts = false
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
const fmtAge = (s) => s == null ? '?' : (s > 86400 ? (s / 86400).toFixed(1) + 'd' : (s / 3600).toFixed(1) + 'h')
const hasVerdictPatch = (dir) => {
  try { return fs.statSync(path.join(dir, 'verdict-diff.patch')).size > 0 } catch { return false }
}
const hasVerdictJson = (dir) => {
  try { return fs.statSync(path.join(dir, 'verdict.json')).isFile() } catch { return false }
}
const archiveRoot = path.join(root, 'verdict-archive')

const stale = [], old = []
let kept = 0
let patchCandidates = 0
for (const d of fs.readdirSync(root)) {
  if (d === 'verdict-archive') continue
  const dir = path.join(root, d)
  try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
  const statusFile = path.join(dir, 'status.json')
  const st = readJsonFile(statusFile), m = readJsonFile(path.join(dir, 'meta.json'))
  const state = st.state || m.state || '?'
  const verdictPatch = hasVerdictPatch(dir)
  const verdictJson = hasVerdictJson(dir)
  const verdictMarker = verdictPatch ? '  ⚠ has verdict patch' : ''

  let mtime = 0; try { mtime = fs.statSync(statusFile).mtimeMs } catch {}
  // No status.json at all: the worker died before the parser ever finalized (state '?').
  // Without this bucket such dirs are kept forever — fall back to the dir's own mtime.
  if (!mtime && state === '?') {
    let dirMtime = 0; try { dirMtime = fs.statSync(dir).mtimeMs } catch {}
    if (dirMtime && (now - dirMtime > staleSecs * 1000)) {
      stale.push({ d, backend: st.backend || m.backend || '?', idle: Math.round((now - dirMtime) / 1000), verdictPatch, verdictJson, verdictMarker: verdictMarker + '  (no status.json)' })
      if (verdictPatch) patchCandidates++
      continue
    }
  }
  // A pre-5.0.0 dir can still say 'human-controlled' (legacy takeover state, never written
  // now). Nothing will finish it, so age it out like a dead running session.
  if ((state === 'running' || state === 'human-controlled') && mtime && (now - mtime > staleSecs * 1000)) { // legacy state
    stale.push({ d, backend: st.backend || m.backend || '?', idle: Math.round((now - mtime) / 1000), verdictPatch, verdictJson, verdictMarker })
    if (verdictPatch) patchCandidates++
    continue
  }
  if (olderDays > 0 && TERMINAL_STATES.has(state)) {
    const started = Date.parse(m.startedAt || '') || 0
    if (started && (now - started > olderDays * 86400 * 1000)) {
      old.push({ d, backend: st.backend || m.backend || '?', state, started: m.startedAt, verdictPatch, verdictJson, verdictMarker })
      if (verdictPatch) patchCandidates++
      continue
    }
  }
  kept++
}

log(`root: ${root}`)
log(`stale (running but dead, idle > ${staleSecs}s): ${stale.length}`)
for (const x of stale) log(`  ${String(x.backend).padEnd(11)} ${x.d}  idle ${fmtAge(x.idle)}${x.verdictMarker}`)
if (olderDays > 0) {
  log(`old finished (done/error, started > ${olderDays}d ago): ${old.length}`)
  for (const x of old) log(`  ${String(x.backend).padEnd(11)} ${String(x.state).padEnd(6)} ${x.d}  ${x.started}${x.verdictMarker}`)
}

const targets = [...stale, ...old]
if (!targets.length) { log('nothing to clean.'); process.exit(0) }
if (remove) {
  let n = 0
  let archived = 0
  for (const x of targets) {
    if (preserveVerdicts && (x.verdictPatch || x.verdictJson)) {
      let copied = false
      try {
        fs.mkdirSync(archiveRoot, { recursive: true })
        if (x.verdictPatch) {
          fs.copyFileSync(path.join(root, x.d, 'verdict-diff.patch'), path.join(archiveRoot, `${x.d}.patch`))
          copied = true
        }
        if (x.verdictJson) {
          fs.copyFileSync(path.join(root, x.d, 'verdict.json'), path.join(archiveRoot, `${x.d}.json`))
          copied = true
        }
      } catch (e) {
        log(`  note: archive failed for ${x.d}: ${e.message}`)
      }
      if (copied) archived++
    }
    try { fs.rmSync(path.join(root, x.d), { recursive: true, force: true }); n++ }
    catch (e) { log(`  FAILED ${x.d}: ${e.message}`) }
  }
  const archiveSummary = preserveVerdicts
    ? `archived verdicts for ${archived} session(s).`
    : 'verdict archiving disabled.'
  log(`removed ${n}/${targets.length} dir(s). kept ${kept} live/recent. ${archiveSummary}`)
} else {
  log(`DRY-RUN — nothing deleted. Re-run with --remove to delete the ${targets.length} dir(s) above.`)
  if (patchCandidates) {
    if (preserveVerdicts) {
      log(`note: ${patchCandidates} candidate(s) carry a verdict-diff.patch (possible unapplied recovery diff) — they will be archived on removal; pass --no-preserve-verdicts to skip archiving.`)
    } else {
      log(`note: ${patchCandidates} candidate(s) carry a verdict-diff.patch (possible unapplied recovery diff) — verdict archiving is disabled by --no-preserve-verdicts.`)
    }
  }
}
