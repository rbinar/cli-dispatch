// policy-inject.test.mjs — unit tests for the pure buildPolicyContext core plus an
// integration test that runs policy-inject.mjs as a real child process against a temp
// fixture (kill-flow.test.mjs pattern: tmpdir fixture, cleaned up in after()).
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/policy-inject.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildPolicyContext } from '../policy-inject.mjs'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const POLICY_INJECT_PATH = path.resolve(SELF_DIR, '..', 'policy-inject.mjs')

// ============================================================================
// buildPolicyContext — pure core
// ============================================================================

test('1. null input -> null', () => {
  assert.equal(buildPolicyContext(null), null)
})

test('2. enabled:false -> null (even with a legacy runners field)', () => {
  assert.equal(buildPolicyContext({ enabled: false, runners: ['ds-runner'] }), null)
})

// Fail-safe: an `enabled` field that is missing (or any non-true value) must NOT inject.
// The SDD once claimed the opposite ("missing -> defaults to true"); the code's fail-closed
// choice is deliberate — a malformed/partial policy file must never start injecting text
// into every session. Pinned here so nobody "fixes" the code toward the old spec wording.
test('2b. enabled missing or non-true -> null (fail closed)', () => {
  assert.equal(buildPolicyContext({}), null, 'no enabled field must not inject')
  assert.equal(buildPolicyContext({ issueReminder: true }), null, 'other fields do not imply enabled')
  assert.equal(buildPolicyContext({ enabled: 'true' }), null, 'string "true" is not true')
  assert.equal(buildPolicyContext({ enabled: 1 }), null, 'truthy non-boolean is not true')
})

test('3. enabled:true -> routing + escalation + issue sentences, starts with the label', () => {
  const ctx = buildPolicyContext({ enabled: true })
  assert.equal(typeof ctx, 'string')
  assert.ok(ctx.startsWith('[cli-dispatch policy] '), 'must start with the fixed label')
  assert.ok(ctx.includes('/cli-dispatch:run'), 'must name the deterministic runner')
  assert.ok(ctx.includes('ZERO LLM babysitter tokens'), 'must state the zero-babysitter-token routing')
  assert.ok(ctx.includes('/cli-dispatch:resume'), 'must name the escalation follow-up path')
  assert.ok(
    ctx.includes('never spawn an LLM babysitter subagent'),
    'must forbid spawning babysitter subagents'
  )
  assert.ok(
    ctx.includes('github.com/rbinar/cli-dispatch/issues'),
    'issueReminder defaults to true -> must include the issue sentence'
  )
})

test('4. legacy runners field is ignored — no runner name or tier sentence leaks into the context', () => {
  const ctx = buildPolicyContext({
    enabled: true,
    runners: ['ds-runner', 'ag-runner', 'cx-runner', 'oc-runner', 'cp-runner'],
  })
  for (const name of ['ds-runner (', 'ag-runner (', 'cx-runner (', 'oc-runner (', 'cp-runner ('])
    assert.ok(!ctx.includes(name), `retired runner descriptor must not appear: ${name}`)
  assert.ok(!ctx.includes('Reserve the LLM'), 'retired judgment-tier sentence must not appear')
})

test('5. hostile runners values are never interpolated', () => {
  const ctx = buildPolicyContext({
    enabled: true,
    runners: ['evil-runner', '../etc/passwd'],
  })
  assert.ok(!ctx.includes('evil-runner'), 'unknown runner must not be interpolated')
  assert.ok(!ctx.includes('../etc/passwd'), 'path-shaped value must not be interpolated')
})

test('6. issueReminder:false omits the issue sentence', () => {
  const ctx = buildPolicyContext({ enabled: true, issueReminder: false })
  assert.ok(!ctx.includes('github.com/rbinar/cli-dispatch/issues'), 'issue sentence must be omitted')
})

test('7. schemaVersion 2 (unknown future schema) -> null', () => {
  assert.equal(buildPolicyContext({ enabled: true, schemaVersion: 2 }), null)
})

test('8. schemaVersion 1 is accepted -> string', () => {
  const ctx = buildPolicyContext({ enabled: true, schemaVersion: 1 })
  assert.equal(typeof ctx, 'string')
})

test('9. token ceiling: a fully-populated policy stays well under the budget', () => {
  const ctx = buildPolicyContext({
    enabled: true,
    issueReminder: true,
  })
  const words = ctx.split(/\s+/).length
  assert.ok(words < 160, `expected < 160 rough words (<=200 token safety margin), got ${words}`)
})

// ============================================================================
// Integration — real child process against a tmp fixture
// ============================================================================

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-policy-'))
after(() => {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function writeFixture(name, obj) {
  const p = path.join(fixtureDir, name)
  fs.writeFileSync(p, JSON.stringify(obj))
  return p
}

function runInject(policyFile) {
  return execFileSync('node', [POLICY_INJECT_PATH], {
    env: { ...process.env, CLI_DISPATCH_POLICY_FILE: policyFile },
    encoding: 'utf8',
  })
}

test('10a. integration: valid legacy policy fixture -> well-formed SessionStart hook payload on stdout', () => {
  const file = writeFixture('valid.json', { enabled: true, runners: ['ds-runner', 'cx-runner'] })
  const out = runInject(file)
  const parsed = JSON.parse(out)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string')
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('/cli-dispatch:run'))
  assert.ok(
    !parsed.hookSpecificOutput.additionalContext.includes('ds-runner ('),
    'legacy runners field must not surface a runner descriptor'
  )
})

test('10b. integration: enabled:false fixture -> empty stdout, exit 0', () => {
  const file = writeFixture('disabled.json', { enabled: false })
  const out = runInject(file)
  assert.equal(out, '', 'disabled policy must produce no output')
})

test('10c. integration: non-existent CLI_DISPATCH_POLICY_FILE -> empty stdout, exit 0', () => {
  const missing = path.join(fixtureDir, 'does-not-exist-' + crypto.randomBytes(4).toString('hex') + '.json')
  const out = runInject(missing)
  assert.equal(out, '', 'missing policy file must produce no output (and not throw)')
})
