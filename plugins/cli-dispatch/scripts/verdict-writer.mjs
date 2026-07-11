import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { NON_TERMINAL_STATES, TERMINAL_STATES } from './parse-utils.mjs'

const VALID_BACKENDS = new Set(['ds', 'ag', 'cx', 'oc', 'cp'])
// The stream parsers write the LONG backend name into status.json/meta.json
// (e.g. "codex"), while cli-dispatch-run speaks the short form — accept both.
const BACKEND_ALIASES = { deepseek: 'ds', antigravity: 'ag', codex: 'cx', opencode: 'oc', copilot: 'cp' }
export function normalizeBackend(value) {
  const b = String(value ?? '').toLowerCase()
  if (VALID_BACKENDS.has(b)) return b
  return BACKEND_ALIASES[b] ?? null
}

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
    stranded: Boolean(hasStrandedChanges(worktree)),
    worktreeRemoved: false,
    startedAt: meta.startedAt,
    endedAt: new Date().toISOString(),
  }

  return { verdict, exitCode }
}

export { readJson }

function printUsage() {
  process.stderr.write('usage: verdict-writer.mjs <run-verify|build-verdict>\n')
}

function parseBoolean(value) {
  if (value === undefined || value === null) return false
  if (value === '' || value === '0' || value === 'false') return false
  return value === '1' || value === 'true' || value === true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
