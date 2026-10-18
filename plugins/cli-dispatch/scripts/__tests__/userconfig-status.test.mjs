// A key set only in the plugin's userConfig reaches the dispatch tool and nothing else: Bash
// paths (doctor, balance, claude-ds, claude-ds-stream) cannot see it. The SessionStart hook records
// which keys are set as flags in userconfig-status.json; these tests pin that every such path
// reports "set in the plugin config" from the flags, never prints a value, and falls back to a
// message that names /plugin configure when the flags file is absent.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ROOT = path.join(SCRIPTS, '..')
const DECOY = 'DECOY-VALUE-SHOULD-NEVER-PRINT'
const PWSH = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0

function home({ status = true } = {}) {
  const h = mkdtempSync(path.join(tmpdir(), 'uc-status-'))
  const cfgDir = path.join(h, '.config', 'cli-dispatch')
  mkdirSync(cfgDir, { recursive: true })
  writeFileSync(path.join(cfgDir, 'config'), 'DEEPSEEK_API_KEY=""\nOPENROUTER_API_KEY=""\nDS_MODEL="m"\n')
  if (status) {
    writeFileSync(path.join(cfgDir, 'userconfig-status.json'), JSON.stringify({ schemaVersion: 1, decoy: DECOY, keys: { DEEPSEEK_API_KEY: true, OPENROUTER_API_KEY: true, GEMINI_API_KEY: false, CODEX_API_KEY: false, COPILOT_GITHUB_TOKEN: false } }, null, 2))
  }
  return { h, cfg: path.join(cfgDir, 'config'), cleanup: () => rmSync(h, { recursive: true, force: true }) }
}

const envFor = (h) => {
  const env = { ...process.env, HOME: h }
  for (const k of ['XDG_CONFIG_HOME', 'CLI_DISPATCH_CONFIG', 'CLAUDE_DS_CONFIG', 'CLI_DISPATCH_USERCONFIG_STATUS', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']) delete env[k]
  env.CLI_DISPATCH_NO_GH_TOKEN = '1'
  return env
}
const sh = (file, args, env) => spawnSync('bash', [path.join(SCRIPTS, file), ...args], { encoding: 'utf8', env })

test('doctor: a userConfig-only key is reported as set in the plugin config', () => {
  const x = home()
  try {
    const r = sh('cli-dispatch-doctor.sh', [PLUGIN_ROOT, 'ds'], envFor(x.h))
    assert.match(r.stdout, /DEEPSEEK_API_KEY set in plugin config/)
    assert.doesNotMatch(r.stdout, /DEEPSEEK_API_KEY missing/)
    assert.ok(!r.stdout.includes(DECOY) && !r.stderr.includes(DECOY))
  } finally { x.cleanup() }
})

test('doctor: with no flags file the missing-key line points at /plugin configure', () => {
  const x = home({ status: false })
  try {
    const r = sh('cli-dispatch-doctor.sh', [PLUGIN_ROOT, 'ds'], envFor(x.h))
    assert.match(r.stdout, /DEEPSEEK_API_KEY missing/)
    assert.match(r.stdout, /\/plugin configure cli-dispatch@cli-dispatch/)
  } finally { x.cleanup() }
})

test('doctor: opencode reads the OpenRouter flag too', () => {
  const x = home()
  try {
    const r = sh('cli-dispatch-doctor.sh', [PLUGIN_ROOT, 'oc'], envFor(x.h))
    // The oc section is only probed when oc-agent is installed; either way a value is never printed.
    assert.ok(!r.stdout.includes(DECOY))
    if (/oc-agent on PATH/.test(r.stdout)) assert.match(r.stdout, /OPENROUTER_API_KEY set in plugin config/)
  } finally { x.cleanup() }
})

test('balance: a userConfig-only key says balance cannot read it', () => {
  const x = home()
  try {
    const r = sh('cli-dispatch-balance.sh', ['deepseek'], envFor(x.h))
    assert.equal(r.status, 1)
    assert.match(r.stdout, /balance cannot read/)
    assert.match(r.stdout, /DEEPSEEK_API_KEY/)
    assert.ok(!r.stdout.includes(DECOY))
  } finally { x.cleanup() }
})

test('balance: with no flags file it names /plugin configure', () => {
  const x = home({ status: false })
  try {
    const r = sh('cli-dispatch-balance.sh', ['deepseek'], envFor(x.h))
    assert.match(r.stdout, /\/plugin configure/)
  } finally { x.cleanup() }
})

for (const script of ['claude-ds', 'claude-ds-stream']) {
  test(`${script}: a userConfig-only key exits 1 and says only the dispatch tool passes it`, () => {
    const x = home()
    try {
      const r = sh(script, ['-p', 'x'], envFor(x.h))
      assert.equal(r.status, 1)
      assert.match(r.stderr, /only the dispatch tool/)
      assert.match(r.stderr, /\/cli-dispatch:setup/)
      assert.ok(!r.stderr.includes(DECOY) && !r.stdout.includes(DECOY))
    } finally { x.cleanup() }
  })

  test(`${script}: with no flags file the message names /plugin configure`, () => {
    const x = home({ status: false })
    try {
      const r = sh(script, ['-p', 'x'], envFor(x.h))
      assert.equal(r.status, 1)
      assert.match(r.stderr, /\/plugin configure/)
      assert.doesNotMatch(r.stderr, /only the dispatch tool/)
    } finally { x.cleanup() }
  })
}

// #212: the flags are checked whether or not a config file exists.
test('doctor and balance report a userConfig-only key for every backend when there is no config file', () => {
  const h = mkdtempSync(path.join(tmpdir(), 'uc-nocfg-'))
  try {
    const bin = path.join(h, 'bin')
    mkdirSync(bin)
    for (const n of ['ag-agent', 'ag-stream', 'agy', 'cx-agent', 'cx-stream', 'codex', 'oc-agent', 'oc-stream', 'opencode', 'cp-agent', 'cp-stream', 'copilot']) {
      writeFileSync(path.join(bin, n), '#!/bin/sh\necho 1.0\n', { mode: 0o755 })
    }
    const flags = path.join(h, 'flags.json')
    writeFileSync(flags, JSON.stringify({ schemaVersion: 1, keys: { DEEPSEEK_API_KEY: true, OPENROUTER_API_KEY: true, GEMINI_API_KEY: true, CODEX_API_KEY: true, COPILOT_GITHUB_TOKEN: true } }))
    const env = { ...envFor(h), PATH: `${bin}:${process.env.PATH}`, CLI_DISPATCH_USERCONFIG_STATUS: flags }
    for (const [b, key] of [['ag', 'GEMINI_API_KEY'], ['cx', 'CODEX_API_KEY'], ['oc', 'OPENROUTER_API_KEY'], ['cp', 'COPILOT_GITHUB_TOKEN']]) {
      const r = sh('cli-dispatch-doctor.sh', [PLUGIN_ROOT, b], env)
      assert.match(r.stdout, new RegExp(`${key} set in plugin config`), b)
    }
    for (const [b, key] of [['deepseek', 'DEEPSEEK_API_KEY'], ['opencode', 'OPENROUTER_API_KEY']]) {
      const r = sh('cli-dispatch-balance.sh', [b], env)
      assert.match(r.stdout, /balance cannot read/, b)
      assert.match(r.stdout, new RegExp(key), b)
      assert.doesNotMatch(r.stdout, /config: MISSING/, b)
    }
  } finally { rmSync(h, { recursive: true, force: true }) }
})

// .ps1 twins: Write-Error terminates ($ErrorActionPreference = Stop in both), so catch its message.
const pwsh = (file, env) => spawnSync('pwsh', ['-NoProfile', '-Command', `try { & '${path.join(SCRIPTS, file)}' } catch { $_.Exception.Message }`], { encoding: 'utf8', env })

for (const script of ['claude-ds.ps1', 'claude-ds-stream.ps1']) {
  test(`${script}: a userConfig-only key says only the dispatch tool passes it`, { skip: !PWSH && 'pwsh not installed' }, () => {
    const x = home()
    try {
      const r = pwsh(script, { ...envFor(x.h), CLI_DISPATCH_CONFIG: x.cfg })
      assert.match(r.stdout, /only the dispatch tool/)
      assert.match(r.stdout, /\/cli-dispatch:setup/)
      assert.ok(!r.stdout.includes(DECOY))
    } finally { x.cleanup() }
  })

  test(`${script}: with no flags file the message names /plugin configure`, { skip: !PWSH && 'pwsh not installed' }, () => {
    const x = home({ status: false })
    try {
      const r = pwsh(script, { ...envFor(x.h), CLI_DISPATCH_CONFIG: x.cfg })
      assert.match(r.stdout, /\/plugin configure/)
    } finally { x.cleanup() }
  })
}

test('cli-dispatch-status.ps1: reports a userConfig-only key from the flags', { skip: !PWSH && 'pwsh not installed' }, () => {
  const x = home()
  try {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', path.join(SCRIPTS, 'cli-dispatch-status.ps1')], { encoding: 'utf8', env: { ...envFor(x.h), CLI_DISPATCH_CONFIG: x.cfg, XDG_CONFIG_HOME: path.join(x.h, '.config') } })
    assert.match(r.stdout, /set in plugin config/)
    assert.ok(!r.stdout.includes(DECOY))
  } finally { x.cleanup() }
})

test('cli-dispatch-status.ps1: with no flags file the MISSING line names /plugin configure', { skip: !PWSH && 'pwsh not installed' }, () => {
  const x = home({ status: false })
  try {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', path.join(SCRIPTS, 'cli-dispatch-status.ps1')], { encoding: 'utf8', env: { ...envFor(x.h), CLI_DISPATCH_CONFIG: x.cfg, XDG_CONFIG_HOME: path.join(x.h, '.config') } })
    assert.match(r.stdout, /MISSING.*\/plugin configure/)
  } finally { x.cleanup() }
})
