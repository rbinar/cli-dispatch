#!/usr/bin/env node
// policy-inject.mjs — SessionStart hook that injects the cli-dispatch delegation policy as
// additionalContext. Two layers: a pure core (buildPolicyContext) that turns a parsed
// policy.json object into the context string (or null), and a thin I/O main() that resolves
// + reads the policy file and emits the SessionStart hook payload. main() runs only when the
// script is invoked directly, so tests can import the core without triggering I/O.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const KNOWN_RUNNERS = ['ds-runner', 'ag-runner', 'cx-runner', 'oc-runner', 'cp-runner']

const RUNNER_DESCRIPTORS = {
  'ds-runner': 'ds-runner (medium/hard: explore/scan/research)',
  'ag-runner': 'ag-runner (medium/hard)',
  'cx-runner': 'cx-runner (medium/hard)',
  'oc-runner': 'oc-runner (medium)',
  'cp-runner': 'cp-runner (medium/hard)',
}

export function buildPolicyContext(policyJson) {
  if (!policyJson || policyJson.enabled !== true) return null

  // Don't trust an unknown future schema. schemaVersion absent or 1 is fine.
  if (typeof policyJson.schemaVersion === 'number' && policyJson.schemaVersion > 1) return null

  // Whitelist: preserve order, silently drop unknown values — a raw runner string is never
  // interpolated into the context.
  const runners = (Array.isArray(policyJson.runners) ? policyJson.runners : []).filter((r) =>
    KNOWN_RUNNERS.includes(r)
  )

  const issueReminder = policyJson.issueReminder !== false

  const descriptor = (r) => RUNNER_DESCRIPTORS[r]

  const parts = []
  parts.push(
    `Route delegations by shape, not reflex. Mechanical work with a machine-checkable check -> the deterministic runner: /cli-dispatch:run <backend> "<task>" --verify '<cmd>' spends ZERO LLM babysitter tokens. Trivial single-file surgical fixes stay inline.`
  )
  if (runners.length > 0) {
    parts.push(
      `Reserve the LLM *-runner subagents for judgment-heavy work (ambiguous scope, or output no command can verify): ${runners
        .map(descriptor)
        .join(', ')}.`
    )
  }
  parts.push(
    `Name each delegated subagent with its assigned model in parentheses, e.g. "Fix contract bug (opus)".`
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
