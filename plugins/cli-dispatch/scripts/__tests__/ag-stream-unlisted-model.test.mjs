// Issue #165: an explicitly requested model that `agy models` does not list used to launch agy
// anyway, which then created no conversation and died with a confusing discovery error.
// ag-stream must now fail fast, before launching agy, unless AG_ALLOW_UNLISTED_MODEL=1.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const AG_STREAM = path.join(HERE, '..', 'ag-stream')

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'ag-unlisted-'))
  const bin = path.join(root, 'bin')
  const home = path.join(root, 'home')
  const sessions = path.join(root, 'sessions')
  const calls = path.join(root, 'calls.log')
  mkdirSync(bin); mkdirSync(home); mkdirSync(sessions)
  // Two-column listing; any subcommand other than `models` is a launch/preflight attempt.
  writeFileSync(path.join(bin, 'agy'), `#!/bin/bash
if [ "$1" = "models" ]; then
  printf 'gemini-3.8-flash-high\\tGemini 3.8 Flash (High)\\ngemini-3.8-pro-high\\tGemini 3.8 Pro (High)\\n'
  exit 0
fi
echo "$*" >> "${calls}"
exit 1
`)
  chmodSync(path.join(bin, 'agy'), 0o755)
  return { root, bin, home, sessions, calls }
}

function run(env, extra = {}) {
  const e = setup()
  const r = spawnSync('bash', [AG_STREAM, '-p', 'do a thing', '--cwd', e.root], {
    env: {
      PATH: `${e.bin}:${process.env.PATH}`, HOME: e.home,
      CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: e.sessions,
      ...env, ...extra,
    },
    encoding: 'utf8', timeout: 60000,
  })
  const launched = existsSync(e.calls) ? readFileSync(e.calls, 'utf8') : ''
  return { ...e, r, launched }
}

test('ag-stream: unlisted explicit model fails fast without launching agy', () => {
  const x = run({ AG_MODEL: 'unknown-model' })
  try {
    assert.notEqual(x.r.status, 0, `expected non-zero exit; stderr: ${x.r.stderr}`)
    assert.match(x.r.stderr, /unknown-model/)
    assert.match(x.r.stderr, /gemini-3\.8-flash-high/)
    assert.equal(x.launched, '', 'agy must not be launched for an unlisted model')
    const dirs = readdirSync(x.sessions)
    assert.equal(dirs.length, 1, 'an error session must be written')
    const status = JSON.parse(readFileSync(path.join(x.sessions, dirs[0], 'status.json'), 'utf8'))
    assert.equal(status.state, 'error')
    assert.equal(status.errorKind, 'model')
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('ag-stream: AG_ALLOW_UNLISTED_MODEL=1 keeps warn-and-continue', () => {
  const x = run({ AG_MODEL: 'unknown-model', AG_ALLOW_UNLISTED_MODEL: '1' })
  try {
    assert.match(x.r.stderr, /warning/)
    assert.notEqual(x.launched, '', 'agy must be reached when the check is waived')
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('ag-stream: a listed model is not stopped by the check', () => {
  const x = run({ AG_MODEL: 'gemini-3.8-pro-high' })
  try {
    assert.doesNotMatch(x.r.stderr, /not listed/)
    assert.notEqual(x.launched, '')
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})
