#!/usr/bin/env node
// policy-inject.mjs — SessionStart hook that injects the cli-dispatch delegation policy as
// additionalContext. Two layers: a pure core (buildPolicyContext) that turns a parsed
// policy.json object into the context string (or null), and a thin I/O main() that resolves
// + reads the policy file and emits the SessionStart hook payload. main() runs only when the
// script is invoked directly, so tests can import the core without triggering I/O.
//
// Note: policy.json files written by installs <= 3.44.x carry a `runners` array (the retired
// LLM babysitter subagents, removed in 4.0.0 — issue #114). The field is ignored for
// back-compat; no value from it is ever interpolated into the context.

import { accessSync, constants, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/
const CORE_WRAPPER_BINARIES = [
  'cli-dispatch-run',
  'cli-dispatch-wait',
  'cli-dispatch-clean',
  'cli-dispatch-gain',
  'cli-dispatch-dashboard',
]
const PATH_PROBE_EXTENSIONS = ['', '.ps1', '.cmd', '.exe']

// Numeric triple comparison. Returns -1 / 0 / 1, or null when either side is not a plain
// X.Y.Z string — callers treat null as "cannot compare, stay silent". Mirrors
// version-check.sh's cli_dispatch_semver_is_older; keep the two in sync.
export function compareSemver(a, b) {
  const ma = SEMVER_RE.exec(String(a || '').trim())
  const mb = SEMVER_RE.exec(String(b || '').trim())
  if (!ma || !mb) return null
  for (let i = 1; i <= 3; i++) {
    const x = Number(ma[i])
    const y = Number(mb[i])
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

// Issue #150: a plugin upgrade refreshes ONLY the versioned cache dir — it never re-runs
// install.sh, so ~/.local/bin keeps whatever wrappers the last setup installed. Binaries
// introduced by the newer version (cli-dispatch-run was exactly this case) are then simply
// absent from PATH, and the documented zero-token runner flow dies with `command not found`
// for a reason nothing on screen explains. This notice is deliberately NOT gated on
// policy.json: the drift is a broken install, not a preference, and someone who never wrote
// a policy file is the most likely person to hit it.
export function buildStalenessNotice(installedVersion, availableVersion, missingBinaries = []) {
  const cmp = compareSemver(installedVersion, availableVersion)
  if (cmp === null || cmp >= 0) return null
  const missing = Array.isArray(missingBinaries)
    ? missingBinaries.map((name) => String(name || '').trim()).filter(Boolean)
    : []
  const staleCause = missing.length
    ? `reinstalls the wrappers, and these required wrapper binaries are missing from PATH: ${missing.join(', ')}.`
    : `reinstalls the wrappers, so the wrappers in PATH may be older than the active plugin.`
  return (
    `[cli-dispatch] Installed CLIs in ~/.local/bin are STALE: ${String(installedVersion).trim()} installed, ` +
    `${String(availableVersion).trim()} available. A plugin upgrade refreshes the plugin cache only — it never ` +
    `${staleCause} Re-run /cli-dispatch:setup to re-sync ~/.local/bin.`
  )
}

function readInstalledVersion() {
  const file =
    process.env.CLI_DISPATCH_INSTALLED_VERSION_FILE ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'cli-dispatch',
      '.installed-version'
    )
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

function readNewestCachedVersion() {
  const dir =
    process.env.CLI_DISPATCH_PLUGIN_CACHE_DIR ||
    path.join(os.homedir(), '.claude', 'plugins', 'cache', 'cli-dispatch', 'cli-dispatch')
  let newest = ''
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SEMVER_RE.test(entry.name)) continue
      if (!newest || compareSemver(newest, entry.name) === -1) newest = entry.name
    }
  } catch {
    return ''
  }
  return newest
}

function executableExists(file) {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.F_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

function commandExistsOnPath(binary, pathValue) {
  try {
    for (const rawDir of String(pathValue || '').split(path.delimiter)) {
      const dir = rawDir || '.'
      for (const ext of PATH_PROBE_EXTENSIONS) {
        if (executableExists(path.join(dir, binary + ext))) return true
      }
    }
  } catch {
    return false
  }
  return false
}

function findMissingCoreWrapperBinaries() {
  try {
    return CORE_WRAPPER_BINARIES.filter((binary) => !commandExistsOnPath(binary, process.env.PATH))
  } catch {
    return []
  }
}

export function buildPolicyContext(policyJson) {
  if (!policyJson || policyJson.enabled !== true) return null

  // Don't trust an unknown future schema. schemaVersion absent or 1 is fine.
  if (typeof policyJson.schemaVersion === 'number' && policyJson.schemaVersion > 1) return null

  const issueReminder = policyJson.issueReminder !== false

  const parts = []
  parts.push(
    `Route delegations by auditability, not reflex. Work with a machine-checkable check belongs on the deterministic runner — including exploratory work, as long as behavior-changing decisions stay in the orchestrator's brief. /cli-dispatch:run <backend> "<task>" --verify '<cmd>' spends ZERO LLM babysitter tokens. Trivial single-file surgical fixes stay inline.`
  )
  // Sessions have vetoed the runner by quoting the first half of the
  // never-delegate-verification rule and dropping the remedy: "--verify only says
  // the tests pass" became a reason not to delegate at all. Say the remedy in the
  // same breath as the caveat, so the caveat cannot be spent as a veto.
  parts.push(
    `--verify proving less than you need is a reason to re-measure after, never a reason to keep the work inline. Send it, then verify it yourself: re-run the old code, diff output and exit code, read the test diff.`
  )
  parts.push(
    `No verify command, or verify failed? Escalate yourself: read the verdict + diff directly and follow up with /cli-dispatch:resume — never spawn an LLM babysitter subagent to watch a worker (the *-runner subagents were retired in 4.0.0; babysitting measured ~9x the worker's own output in Anthropic tokens).`
  )
  if (issueReminder) {
    parts.push(
      `Hit a friction point or bug in cli-dispatch itself? File an issue at https://github.com/rbinar/cli-dispatch/issues.`
    )
  }

  return `[cli-dispatch policy] ` + parts.join(' ')
}

function main() {
  try {
    const policyPath = process.env.CLI_DISPATCH_POLICY_FILE
      ? process.env.CLI_DISPATCH_POLICY_FILE
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
          'cli-dispatch',
          'policy.json'
        )

    let json = null
    try {
      json = JSON.parse(readFileSync(policyPath, 'utf8'))
    } catch {
      json = null
    }

    const stale = buildStalenessNotice(
      readInstalledVersion(),
      readNewestCachedVersion(),
      findMissingCoreWrapperBinaries()
    )
    const ctx = buildPolicyContext(json)
    const combined = [stale, ctx].filter(Boolean).join('\n\n')
    if (combined) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: combined,
          },
        })
      )
    }
  } catch {
    // swallow — a hook must never break session start
  }
  process.exit(0)
}

const entryPath = process.argv[1]
let entryRealPath = entryPath
try { entryRealPath = realpathSync(entryPath) } catch {}
if (entryPath && import.meta.url === pathToFileURL(entryRealPath).href) main()
