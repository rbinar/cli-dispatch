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

test('2. enabled:false -> null (even with runners)', () => {
  assert.equal(buildPolicyContext({ enabled: false, runners: ['ds-runner'] }), null)
})

test('3. enabled:true, no runners -> string without a runner sentence but with name + issue sentences', () => {
  const ctx = buildPolicyContext({ enabled: true })
  assert.equal(typeof ctx, 'string')
  assert.ok(!ctx.includes('Delegate substantive work'), 'must NOT include the runner delegation sentence')
  assert.ok(ctx.includes('Name each delegated subagent'), 'must include the naming sentence')
  assert.ok(
    ctx.includes('github.com/rbinar/cli-dispatch/issues'),
    'issueReminder defaults to true -> must include the issue sentence'
  )
})

test('3b. deterministic-runner routing sentence is always present when enabled', () => {
  const withRunners = buildPolicyContext({ enabled: true, runners: ['ds-runner'] })
  const noRunners = buildPolicyContext({ enabled: true })
  for (const ctx of [withRunners, noRunners]) {
    assert.ok(ctx.includes('/cli-dispatch:run'), 'must name the deterministic runner')
    assert.ok(ctx.includes('ZERO LLM babysitter tokens'), 'must state the zero-babysitter-token routing')
  }
  assert.ok(withRunners.includes('Reserve the LLM'), 'runner sentence framed as the judgment-heavy tier')
})

test('4. enabled:true with two runners -> both descriptors, starts with the label', () => {
  const ctx = buildPolicyContext({ enabled: true, runners: ['ds-runner', 'cx-runner'] })
  assert.ok(ctx.startsWith('[cli-dispatch policy] '), 'must start with the fixed label')
  assert.ok(ctx.includes('ds-runner (medium/hard: explore/scan/research)'), 'includes ds-runner descriptor')
  assert.ok(ctx.includes('cx-runner (medium/hard)'), 'includes cx-runner descriptor')
})

test('5. unknown runners are whitelisted out, known ones survive', () => {
  const ctx = buildPolicyContext({
    enabled: true,
    runners: ['ds-runner', 'evil-runner', '../etc/passwd'],
  })
  assert.ok(!ctx.includes('evil-runner'), 'unknown runner must be dropped, not interpolated')
  assert.ok(!ctx.includes('../etc/passwd'), 'path-shaped value must be dropped, not interpolated')
  assert.ok(ctx.includes('ds-runner'), 'known runner survives the whitelist')
})

test('6. issueReminder:false omits the issue sentence', () => {
  const ctx = buildPolicyContext({ enabled: true, runners: ['ds-runner'], issueReminder: false })
  assert.ok(!ctx.includes('github.com/rbinar/cli-dispatch/issues'), 'issue sentence must be omitted')
})

test('7. schemaVersion 2 (unknown future schema) -> null', () => {
  assert.equal(buildPolicyContext({ enabled: true, schemaVersion: 2, runners: ['ds-runner'] }), null)
})

test('8. schemaVersion 1 is accepted -> string', () => {
  const ctx = buildPolicyContext({ enabled: true, schemaVersion: 1, runners: ['ds-runner'] })
  assert.equal(typeof ctx, 'string')
  assert.ok(ctx.includes('ds-runner'))
})

test('9. token ceiling: a fully-populated policy stays well under the budget', () => {
  const ctx = buildPolicyContext({
    enabled: true,
    runners: ['ds-runner', 'ag-runner', 'cx-runner', 'oc-runner', 'cp-runner'],
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

test('10a. integration: valid policy fixture -> well-formed SessionStart hook payload on stdout', () => {
  const file = writeFixture('valid.json', { enabled: true, runners: ['ds-runner', 'cx-runner'] })
  const out = runInject(file)
  const parsed = JSON.parse(out)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string')
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('ds-runner'))
})

test('10b. integration: enabled:false fixture -> empty stdout, exit 0', () => {
  const file = writeFixture('disabled.json', { enabled: false, runners: ['ds-runner'] })
  const out = runInject(file)
  assert.equal(out, '', 'disabled policy must produce no output')
})

test('10c. integration: non-existent CLI_DISPATCH_POLICY_FILE -> empty stdout, exit 0', () => {
  const missing = path.join(fixtureDir, 'does-not-exist-' + crypto.randomBytes(4).toString('hex') + '.json')
  const out = runInject(missing)
  assert.equal(out, '', 'missing policy file must produce no output (and not throw)')
})
