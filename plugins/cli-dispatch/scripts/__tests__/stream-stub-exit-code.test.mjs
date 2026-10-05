// Regression guard (issue #171): cx-stream and oc-stream must still capture the worker CLI's
// exit code and let the parser finalize status.json after their process substitution was removed.
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const CX_JSONL = [
  { type: 'thread.started', thread_id: 'thr-stub-1' },
  { type: 'item.completed', item: { id: '1', type: 'agent_message', text: 'stub answer' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
]
const OC_JSONL = [
  { type: 'text', timestamp: 1, sessionID: 'ses_stub1', part: { id: 'p1', sessionID: 'ses_stub1', type: 'text', text: 'stub answer' } },
  { type: 'step_finish', timestamp: 2, sessionID: 'ses_stub1', part: { id: 'p2', sessionID: 'ses_stub1', type: 'step-finish', reason: 'stop', tokens: { input: 1, output: 1 } } },
]

function runStream(script, cliName, jsonl, rc) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'stub-stream-')))
  const bin = path.join(root, 'bin'), sessions = path.join(root, 'sessions'), cwd = path.join(root, 'repo')
  for (const d of [bin, sessions, cwd, path.join(root, 'home')]) mkdirSync(d)
  const lines = jsonl.map(e => JSON.stringify(e)).join('\n')
  writeFileSync(path.join(bin, cliName), `#!/bin/bash\ncat <<'EOF_JSONL'\n${lines}\nEOF_JSONL\nexit ${rc}\n`)
  chmodSync(path.join(bin, cliName), 0o755)
  // No ~/.codex/config.toml on purpose: a fresh codex install has none, and cx-stream used to die
  // silently reading it (sed on a missing file under set -e/pipefail).
  mkdirSync(path.join(root, 'home', '.codex'))
  const r = spawnSync('bash', [path.join(SCRIPTS, script), '-p', 'hello', '--cwd', cwd], {
    encoding: 'utf8', timeout: 90000,
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: path.join(root, 'home'), CLI_DISPATCH_CONFIG: '/dev/null',
      CLI_DISPATCH_SESSIONS_DIR: sessions, CODEX_HOME: path.join(root, 'home', '.codex'), OPENROUTER_API_KEY: 'dummy' },
  })
  const states = []
  const walk = d => { for (const e of require_fs().readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'status.json') { try { states.push(JSON.parse(readFileSync(p, 'utf8'))) } catch {} }
  } }
  walk(sessions)
  rmSync(root, { recursive: true, force: true })
  return { r, states }
}
import * as fsAll from 'node:fs'
function require_fs() { return fsAll }

for (const [script, cli, jsonl] of [['cx-stream', 'codex', CX_JSONL], ['oc-stream', 'opencode', OC_JSONL]]) {
  test(`${script}: exit 0 from the worker ends the session done`, () => {
    const { r, states } = runStream(script, cli, jsonl, 0)
    assert.equal(states.length, 1, `stderr: ${r.stderr}`)
    assert.equal(states[0].state, 'done', `stderr: ${r.stderr}`)
    assert.equal(r.status, 0, `stderr: ${r.stderr}`)
  })
  test(`${script}: non-zero worker exit ends the session error`, () => {
    const { r, states } = runStream(script, cli, jsonl, 3)
    assert.equal(states.length, 1, `stderr: ${r.stderr}`)
    assert.equal(states[0].state, 'error', `stderr: ${r.stderr}`)
    assert.notEqual(r.status, 0, `stderr: ${r.stderr}`)
  })
}
