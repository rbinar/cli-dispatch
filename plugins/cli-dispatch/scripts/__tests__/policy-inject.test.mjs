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
import { buildPolicyContext, buildStalenessNotice, compareSemver } from '../policy-inject.mjs'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const POLICY_INJECT_PATH = path.resolve(SELF_DIR, '..', 'policy-inject.mjs')
const CORE_WRAPPER_BINARIES = [
  'cli-dispatch-run',
  'cli-dispatch-wait',
  'cli-dispatch-clean',
  'cli-dispatch-gain',
  'cli-dispatch-dashboard',
]

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
  const retiredMechanicalWording = ['Mechanical work', 'with a machine-checkable check'].join(' ')
  assert.ok(!ctx.includes(retiredMechanicalWording), 'must not narrow routing to mechanical work')
  assert.ok(ctx.includes('auditability'), 'must name auditability as the routing constraint')
  assert.ok(ctx.includes('including exploratory work'), 'must allow exploratory work with a check')
  assert.ok(
    ctx.includes("behavior-changing decisions stay in the orchestrator's brief"),
    'must keep behavior-changing decisions in the orchestrator brief'
  )
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

// The staleness notice (issue #150) reads the real ~/.config stamp and ~/.claude cache by
// default, so every integration run pins both to fixture-local paths. Without the pins these
// tests would pass or fail depending on how stale the DEVELOPER's own install happens to be.
function runInject(policyFile, extraEnv = {}) {
  return execFileSync(process.execPath, [POLICY_INJECT_PATH], {
    env: {
      ...process.env,
      CLI_DISPATCH_POLICY_FILE: policyFile,
      CLI_DISPATCH_INSTALLED_VERSION_FILE: path.join(fixtureDir, 'no-such-stamp'),
      CLI_DISPATCH_PLUGIN_CACHE_DIR: path.join(fixtureDir, 'no-such-cache'),
      ...extraEnv,
    },
    encoding: 'utf8',
  })
}

function pathWithCoreWrappers(name, presentBinaries = CORE_WRAPPER_BINARIES, extension = '') {
  const bin = path.join(fixtureDir, name)
  fs.mkdirSync(bin, { recursive: true })
  for (const binary of presentBinaries) {
    const file = path.join(bin, binary + extension)
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(file, 0o755)
  }
  return bin
}

// Writes a fixture install stamp + plugin cache dir pair and returns the env overrides that
// point policy-inject.mjs at them.
function stalenessEnv(name, installedVersion, cachedVersions) {
  const root = path.join(fixtureDir, name)
  const cache = path.join(root, 'cache')
  fs.mkdirSync(cache, { recursive: true })
  for (const v of cachedVersions) fs.mkdirSync(path.join(cache, v), { recursive: true })
  const stamp = path.join(root, '.installed-version')
  if (installedVersion === null) {
    return { CLI_DISPATCH_INSTALLED_VERSION_FILE: stamp, CLI_DISPATCH_PLUGIN_CACHE_DIR: cache }
  }
  fs.writeFileSync(stamp, installedVersion)
  return { CLI_DISPATCH_INSTALLED_VERSION_FILE: stamp, CLI_DISPATCH_PLUGIN_CACHE_DIR: cache }
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

// ============================================================================
// Staleness notice (issue #150) — installed wrappers older than the cached plugin
// ============================================================================

test('11. compareSemver orders numerically and refuses non-semver input', () => {
  assert.equal(compareSemver('4.16.0', '4.17.0'), -1)
  assert.equal(compareSemver('4.17.0', '4.16.0'), 1)
  assert.equal(compareSemver('4.17.0', '4.17.0'), 0)
  // Field-wise numeric, not lexicographic: "9" < "10" must not read as "9" > "1".
  assert.equal(compareSemver('4.9.0', '4.10.0'), -1)
  assert.equal(compareSemver('3.30.1', '4.0.0'), -1)
  for (const bad of [null, undefined, '', 'v4.17.0', '4.17', '4.17.0-beta', 'latest'])
    assert.equal(compareSemver(bad, '4.17.0'), null, `must not compare: ${String(bad)}`)
})

test('12. buildStalenessNotice fires only when installed < available', () => {
  const notice = buildStalenessNotice('4.16.0', '4.17.0', ['cli-dispatch-run'])
  assert.equal(typeof notice, 'string')
  assert.ok(notice.includes('4.16.0') && notice.includes('4.17.0'), 'must name both versions')
  assert.ok(notice.includes('cli-dispatch-run'), 'must name the command that goes missing')
  assert.ok(notice.includes('missing from PATH'), 'must say PATH is missing the named command')
  assert.ok(notice.includes('/cli-dispatch:setup'), 'must name the fix')

  assert.equal(buildStalenessNotice('4.17.0', '4.17.0'), null, 'equal versions are not stale')
  assert.equal(buildStalenessNotice('4.18.0', '4.17.0'), null, 'a newer install is not stale')
  // Fail-quiet: a missing stamp or unreadable cache must never invent a warning.
  assert.equal(buildStalenessNotice('', '4.17.0'), null, 'no stamp -> silent')
  assert.equal(buildStalenessNotice('4.16.0', ''), null, 'no cache version -> silent')
})

test('12b. buildStalenessNotice without missing binaries warns stale but invents no missing PATH claim', () => {
  const notice = buildStalenessNotice('4.16.0', '4.17.0')
  assert.equal(typeof notice, 'string')
  assert.ok(notice.includes('4.16.0') && notice.includes('4.17.0'), 'must name both versions')
  assert.ok(!notice.includes('missing from PATH'), 'must not claim a command is missing without probe data')
  assert.ok(!notice.includes('cli-dispatch-run'), 'must not cite cli-dispatch-run as an example missing binary')
  assert.ok(notice.includes('/cli-dispatch:setup'), 'must still name the fix')
})

test('12c. buildStalenessNotice names every probed missing binary', () => {
  const notice = buildStalenessNotice('4.16.0', '4.17.0', [
    'cli-dispatch-wait',
    'cli-dispatch-dashboard',
  ])
  assert.ok(notice.includes('missing from PATH'), 'must explicitly identify PATH misses')
  assert.ok(notice.includes('cli-dispatch-wait'), 'must name first missing binary')
  assert.ok(notice.includes('cli-dispatch-dashboard'), 'must name second missing binary')
  assert.ok(!notice.includes('cli-dispatch-run'), 'must not invent an unreported missing binary')
})

test('13. integration: stale install warns even when NO policy file exists', () => {
  const missing = path.join(fixtureDir, 'absent-policy.json')
  const out = runInject(missing, stalenessEnv('stale-nopolicy', '4.16.0', ['4.16.0', '4.17.0']))
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.ok(ctx.includes('STALE'), 'staleness must not be gated on policy.json')
  assert.ok(!ctx.includes('[cli-dispatch policy]'), 'no policy file -> no policy paragraph')
})

test('13c. integration: stale install with all core wrappers on PATH omits the missing-binary claim', () => {
  const missing = path.join(fixtureDir, 'absent-policy-all-wrappers.json')
  const out = runInject(missing, {
    ...stalenessEnv('stale-all-wrappers', '4.16.0', ['4.17.0']),
    PATH: pathWithCoreWrappers('all-wrappers'),
  })
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.ok(ctx.includes('STALE'), 'staleness must still warn')
  assert.ok(!ctx.includes('missing from PATH'), 'present wrappers must not be reported missing')
  assert.ok(!ctx.includes('cli-dispatch-run'), 'present cli-dispatch-run must not be cited as missing')
})

test('13d. integration: PATH probe reports only missing backend-agnostic core wrappers', () => {
  const missing = path.join(fixtureDir, 'absent-policy-some-wrappers.json')
  const out = runInject(missing, {
    ...stalenessEnv('stale-some-wrappers', '4.16.0', ['4.17.0']),
    PATH: pathWithCoreWrappers('some-wrappers', ['cli-dispatch-run']),
  })
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.ok(ctx.includes('missing from PATH'), 'must report missing core wrappers')
  assert.ok(ctx.includes('cli-dispatch-wait'), 'must name a missing core wrapper')
  assert.ok(ctx.includes('cli-dispatch-dashboard'), 'must name a missing core wrapper')
  assert.ok(!ctx.includes('ds-agent'), 'must not probe backend-specific wrappers')
  assert.ok(!ctx.includes('cx-agent'), 'must not probe backend-specific wrappers')
})

test('13e. integration: PATH probe accepts Windows wrapper extensions', () => {
  const missing = path.join(fixtureDir, 'absent-policy-cmd-wrappers.json')
  const out = runInject(missing, {
    ...stalenessEnv('stale-cmd-wrappers', '4.16.0', ['4.17.0']),
    PATH: pathWithCoreWrappers('cmd-wrappers', CORE_WRAPPER_BINARIES, '.cmd'),
  })
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.ok(ctx.includes('STALE'), 'staleness must still warn')
  assert.ok(!ctx.includes('missing from PATH'), 'extension wrappers must satisfy the PATH probe')
})

test('13b. integration: stale install warns even when the policy is disabled', () => {
  const file = writeFixture('disabled-stale.json', { enabled: false })
  const out = runInject(file, stalenessEnv('stale-disabled', '4.16.0', ['4.17.0']))
  assert.ok(JSON.parse(out).hookSpecificOutput.additionalContext.includes('STALE'))
})

test('14. integration: staleness notice precedes the policy block when both apply', () => {
  const file = writeFixture('enabled-stale.json', { enabled: true })
  const out = runInject(file, stalenessEnv('stale-both', '3.30.1', ['3.30.1', '4.16.0', '4.17.0']))
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.ok(ctx.startsWith('[cli-dispatch] '), 'the broken-install notice comes first')
  assert.ok(ctx.includes('4.17.0'), 'must compare against the NEWEST cached version, not any cached one')
  assert.ok(ctx.includes('[cli-dispatch policy] '), 'the policy block still ships')
})

test('15. integration: up-to-date install emits no staleness notice', () => {
  const file = writeFixture('enabled-fresh.json', { enabled: true })
  const out = runInject(file, stalenessEnv('fresh', '4.17.0', ['4.16.0', '4.17.0']))
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.ok(!ctx.includes('STALE'), 'matching versions must stay quiet')
  assert.ok(ctx.startsWith('[cli-dispatch policy] '))
})

test('16. integration: junk cache entries never produce a warning', () => {
  const file = writeFixture('enabled-junk.json', { enabled: true })
  const out = runInject(file, stalenessEnv('junk', '4.16.0', ['latest', 'tmp', 'v4.17.0']))
  assert.ok(!JSON.parse(out).hookSpecificOutput.additionalContext.includes('STALE'))
})
