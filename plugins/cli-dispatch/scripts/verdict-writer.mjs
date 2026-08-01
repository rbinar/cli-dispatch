import { execSync } from 'node:child_process'
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { NON_TERMINAL_STATES, TERMINAL_STATES, normalizeBackend } from './parse-utils.mjs'

// Moved to parse-utils.mjs (the shared session-dir contract) in 4.3.0 so the dashboard can
// read it without importing this module. Re-exported here so existing importers keep working.
export { normalizeBackend }

function toLines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').split('\n')
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function getBranch(worktree) {
  if (!worktree) return ''
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: worktree,
      encoding: 'utf8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim()
  } catch {
    return ''
  }
}

function hasStrandedChanges(worktree) {
  if (!worktree) return false
  try {
    const status = execSync('git status --short --untracked-files=all', {
      cwd: worktree,
      encoding: 'utf8',
      timeout: 10000,
      stdio: 'pipe',
    })
    return String(status ?? '').trim().length > 0
  } catch {
    return false
  }
}

function tailText(value, tailLines) {
  const lines = toLines(value)
  const keep = Math.max(0, Number(tailLines) || 40)
  const start = Math.max(0, lines.length - keep)
  return lines.slice(start).join('\n')
}

export function runVerify(commands, { cwd, timeoutMs = 600000, tailLines = 40 }) {
  const normalized = Array.isArray(commands) ? commands.map((value) => String(value)) : []
  let exitCode = 0
  let failedAt = null
  let lastOutput = ''

  for (let i = 0; i < normalized.length; i += 1) {
    const cmd = normalized[i]

    try {
      lastOutput = String(
        execSync(cmd, {
          cwd,
          shell: '/bin/sh',
          timeout: Number(timeoutMs),
          stdio: 'pipe',
          encoding: 'utf8',
        }),
      )
    } catch (error) {
      failedAt = i
      if (typeof error?.status === 'number' && Number.isFinite(error.status)) {
        exitCode = error.status
      } else if (error?.code === 'ETIMEDOUT') {
        exitCode = 124
      } else {
        exitCode = 1
      }

      if (error?.stdout !== undefined || error?.stderr !== undefined) {
        lastOutput = `${String(error?.stdout || '')}${String(error?.stderr || '')}`
      } else if (error?.message) {
        lastOutput = String(error.message)
      }

      break
    }
  }

  return {
    commands: normalized,
    exitCode,
    failedAt,
    tail: tailText(lastOutput, tailLines),
  }
}

function mapExitCode({ state, verify, timeoutExpired }) {
  if (timeoutExpired) return 3
  if (state === 'human-controlled') return 4
  if (TERMINAL_STATES.has(state)) {
    if (state === 'done') {
      const verifyExitCode = Number(verify?.exitCode ?? 0)
      return verifyExitCode !== 0 ? 1 : 0
    }
    return 2
  }
  // Non-terminal (running) or unknown — either way there is no verdict to map yet.
  throw new Error(`invalid state "${state}" — session has not reached a terminal state`)
}

// ---- worker evidence record ----
//
// What this is FOR, and what it is not for.
//
// verdict.json already answers "did it pass" deterministically. What it never carried is
// WHICH claims the worker checked and how. Across three delegated runs the worker was asked
// to prove output equivalence, did prove it, and the proof reached the orchestrator only as
// a 300-character clipped preview — so the orchestrator re-derived all of it by hand.
//
// This is a SELF-REPORT. It is not evidence that anything is true, and it must never be read
// as a reason to skip verification: the same three runs are precisely why self-report is not
// trusted here. Its only job is to turn "re-check everything" into a specific, cheap list of
// what to re-check. Treat every claim as unverified until the orchestrator runs it.
//
// The worker writes worker-report.json into its session dir. A malformed or absent report is
// recorded as such rather than dropped — silence and "the worker claimed nothing" must not
// look identical.
export const WORKER_REPORT_FILE = 'worker-report.json'
const MAX_REPORT_ITEMS = 50
const MAX_FIELD_CHARS = 2000

const cleanString = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_FIELD_CHARS) : '')
const cleanList = (v) => (Array.isArray(v) ? v.map(cleanString).filter(Boolean).slice(0, MAX_REPORT_ITEMS) : [])

export function normalizeWorkerReport(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'not-an-object', claims: [], notDone: [], assumptions: [] }
  }
  const claims = (Array.isArray(raw.claims) ? raw.claims : [])
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({
      claim: cleanString(c.claim),
      howVerified: cleanString(c.howVerified),
      command: cleanString(c.command),
      result: cleanString(c.result),
    }))
    .filter((c) => c.claim)
    .slice(0, MAX_REPORT_ITEMS)

  const report = {
    valid: true,
    claims,
    notDone: cleanList(raw.notDone),
    assumptions: cleanList(raw.assumptions),
  }
  // A claim with no command behind it is an assertion, not evidence. Surfacing the count
  // keeps the distinction visible at a glance instead of buried in the array.
  report.unevidencedClaims = claims.filter((c) => !c.command).length
  if (!claims.length && !report.notDone.length && !report.assumptions.length) {
    return { valid: false, reason: 'empty', claims: [], notDone: [], assumptions: [], unevidencedClaims: 0 }
  }
  return report
}

export function readWorkerReport(sessionDir) {
  const file = path.join(sessionDir, WORKER_REPORT_FILE)
  let text
  try { text = readFileSync(file, 'utf8') } catch { return null }
  let parsed
  try { parsed = JSON.parse(text) } catch {
    return { valid: false, reason: 'invalid-json', claims: [], notDone: [], assumptions: [], unevidencedClaims: 0 }
  }
  return normalizeWorkerReport(parsed)
}

export function buildVerdict({ statusJson, metaJson, changedFilesJson, verifyResults, worktreeInfo = {} }) {
  const status = statusJson || {}
  const meta = metaJson || {}
  const changedFiles = changedFilesJson || {}
  const backend = normalizeBackend(meta.backend ?? status.backend)

  if (!backend) {
    throw new Error(`unknown backend "${meta.backend ?? status.backend}"`)
  }

  const state = status.state
  if (!TERMINAL_STATES.has(state) && !NON_TERMINAL_STATES.has(state)) {
    throw new Error(`invalid state "${state}"`)
  }

  const sessionDir = worktreeInfo.sessionDir
  if (!sessionDir) throw new Error('missing worktreeInfo.sessionDir')

  const files = Array.isArray(changedFiles.files)
    ? changedFiles.files.map((file) => (file && typeof file === 'object' ? file.path : file)).filter((file) => typeof file === 'string')
    : []

  const verify = verifyResults
    ? {
      commands: Array.isArray(verifyResults.commands) ? verifyResults.commands : [],
      exitCode: Number.isFinite(Number(verifyResults.exitCode)) ? Number(verifyResults.exitCode) : 0,
      failedAt: verifyResults.failedAt ?? null,
      tail: verifyResults.tail || '',
    }
    : null

  const worktree = worktreeInfo.worktree || meta.cwd || ''
  const exitCode = mapExitCode({
    state,
    verify,
    timeoutExpired: Boolean(worktreeInfo.timeoutExpired),
  })

  const verdict = {
    schemaVersion: 1,
    sessionId: status.sessionId || meta.sessionId,
    backend,
    model: meta.model || 'unknown',
    state,
    completedVia: status.completedVia || 'autonomous',
    exitCode,
    worktree,
    branch: getBranch(worktree),
    baseRef: meta.baseRef || 'origin/main',
    diffstat: changedFiles.diffstat || '',
    changedFiles: files,
    diffPatchPath: path.join(sessionDir, 'verdict-diff.patch'),
    verify,
    // Self-report, not evidence — see normalizeWorkerReport's header. null when the worker
    // wrote nothing; {valid:false, reason} when it wrote something unusable.
    workerReport: readWorkerReport(worktree) ?? readWorkerReport(sessionDir),
    stranded: Boolean(hasStrandedChanges(worktree)),
    worktreeRemoved: false,
    startedAt: meta.startedAt,
    endedAt: new Date().toISOString(),
  }

  return { verdict, exitCode }
}

// Issue #128: `worktreeRemoved` was structurally always false. buildVerdict() cannot know the
// answer — the verdict is written BEFORE --cleanup-if-clean gets to act (it is the escalation
// artifact, so it has to exist even if cleanup dies), and the field's own contract
// (.specs/dev/sdd/deterministic-runner.md:217) says it must be true once cleanup did remove the
// worktree. The only truthful place to set it is here, afterwards.
//
// Fail-soft by contract, and that is the whole design: at this point the worker's work is done,
// the verify verdict is on disk and the worktree really is gone. A bookkeeping write that does
// not land must never turn that into a failed run — so every error path returns false instead
// of throwing, and the CLI wrapper exits 0 either way. It writes exactly one boolean.
export function markWorktreeRemoved(verdictPath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(verdictPath, 'utf8'))
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  // The error shape cli-dispatch-run writes when build-verdict throws ({schemaVersion, error,
  // sessionId, exitCode}) carries no state and no worktree fields. Adding a lone
  // `worktreeRemoved` there would dress a crash record up as a verdict that was never built.
  if (parsed.error !== undefined && parsed.state === undefined) return false
  if (parsed.worktreeRemoved === true) return true

  parsed.worktreeRemoved = true
  try {
    // Temp + rename, not truncate-in-place: the dashboard caches this file on (mtime, size)
    // and reads it while runs finish, so it must never observe a half-written verdict.
    const tmpPath = `${verdictPath}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(parsed)}\n`)
    renameSync(tmpPath, verdictPath)
  } catch {
    return false
  }
  return true
}

function printUsage() {
  process.stderr.write('usage: verdict-writer.mjs <run-verify|build-verdict|mark-worktree-removed>\n')
}

function parseBoolean(value) {
  if (value === undefined || value === null) return false
  if (value === '' || value === '0' || value === 'false') return false
  return value === '1' || value === 'true' || value === true
}

const entryPath = process.argv[1]
let entryRealPath = entryPath
try { entryRealPath = realpathSync(entryPath) } catch {}
if (entryPath && import.meta.url === pathToFileURL(entryRealPath).href) {
  const command = process.argv[2]

  try {
    if (command === 'run-verify') {
      const [worktree, timeoutMs, tailLines, ...commands] = process.argv.slice(3)

      if (!worktree) {
        printUsage()
        process.exit(1)
      }

      const result = runVerify(commands, {
        cwd: worktree,
        timeoutMs: Number(timeoutMs) || 600000,
        tailLines: Number(tailLines) || 40,
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      process.exit(0)
    }

    if (command === 'build-verdict') {
      const [sessionDir, statusPath, metaPath, changedFilesPath, timeoutExpired, verifyPath] = process.argv.slice(3)

      if (!sessionDir || !statusPath || !metaPath || !changedFilesPath) {
        printUsage()
        process.exit(1)
      }

      const statusJson = readJson(statusPath)
      const metaJson = readJson(metaPath)
      const changedFilesJson = readJson(changedFilesPath)
      const verifyResults = verifyPath ? readJson(verifyPath) : null

      const result = buildVerdict({
        statusJson,
        metaJson,
        changedFilesJson,
        verifyResults,
        worktreeInfo: {
          sessionDir,
          worktree: metaJson.cwd,
          timeoutExpired: parseBoolean(timeoutExpired),
        },
      })

      process.stdout.write(`${JSON.stringify(result.verdict)}\n`)
      process.exit(result.exitCode)
    }

    if (command === 'mark-worktree-removed') {
      const [verdictPath] = process.argv.slice(3)

      if (!verdictPath) {
        printUsage()
        process.exit(1)
      }

      if (!markWorktreeRemoved(verdictPath)) {
        process.stderr.write(`verdict-writer: could not record worktreeRemoved in ${verdictPath}\n`)
      }
      // Always 0 — see markWorktreeRemoved's fail-soft contract. The caller has already
      // finished a run; its exit code belongs to the run, not to this write.
      process.exit(0)
    }

    printUsage()
    process.exit(1)
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`)
    if (error?.name === 'SyntaxError' && /JSON/.test(error.message || '')) {
      process.exit(1)
    }
    process.exit(5)
  }
}
