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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

export function buildPolicyContext(policyJson) {
  if (!policyJson || policyJson.enabled !== true) return null

  // Don't trust an unknown future schema. schemaVersion absent or 1 is fine.
  if (typeof policyJson.schemaVersion === 'number' && policyJson.schemaVersion > 1) return null

  const issueReminder = policyJson.issueReminder !== false

  const parts = []
  parts.push(
    `Route delegations by shape, not reflex. Mechanical work with a machine-checkable check -> the deterministic runner: /cli-dispatch:run <backend> "<task>" --verify '<cmd>' spends ZERO LLM babysitter tokens. Trivial single-file surgical fixes stay inline.`
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

    const ctx = buildPolicyContext(json)
    if (ctx) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: ctx,
          },
        })
      )
    }
  } catch {
    // swallow — a hook must never break session start
  }
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
