import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// /cli-dispatch:status moved its shell out of the command markdown and into
// cli-dispatch-status.sh, invoked through the command's `!` pre-execution line
// (4.9.0). The saving only holds while the markdown stays thin AND keeps
// pointing at a script that actually exists — these tests guard that pair.

const here = path.dirname(fileURLToPath(import.meta.url))
const scriptsDir = path.resolve(here, '..')
const commandsDir = path.resolve(scriptsDir, '..', 'commands')

const COMMAND_PATH = path.join(commandsDir, 'status.md')
const SH_PATH = path.join(scriptsDir, 'cli-dispatch-status.sh')
const PS1_PATH = path.join(scriptsDir, 'cli-dispatch-status.ps1')

const command = readFileSync(COMMAND_PATH, 'utf8')

test('status.md pre-executes the extracted script', () => {
  const preExec = command.match(/^!`([^`]+)`/m)
  assert.ok(preExec, 'status.md must open with a `!`-prefixed pre-execution line')
  assert.match(preExec[1], /cli-dispatch-status\.sh/)
  assert.match(preExec[1], /\$\{CLAUDE_PLUGIN_ROOT\}/, 'must run from the plugin cache, not ~/.local/bin')
})

test('both platform twins exist', () => {
  assert.ok(existsSync(SH_PATH), 'cli-dispatch-status.sh is missing')
  assert.ok(existsSync(PS1_PATH), 'cli-dispatch-status.ps1 is missing')
})

test('status.md no longer embeds the bash probes', () => {
  // The whole point of the extraction: the model must never pay to re-emit
  // these. A single stray probe means the shell leaked back into the markdown.
  assert.doesNotMatch(command, /```bash/, 'bash block is back in the command markdown')
  assert.doesNotMatch(command, /command -v claude-ds/)
})

test('status.md stays small enough to be worth the extraction', () => {
  // Was 7615 bytes before extraction. Generous ceiling — this catches the
  // markdown creeping back toward the old size, not ordinary wording edits.
  assert.ok(
    Buffer.byteLength(command) < 2500,
    `status.md grew to ${Buffer.byteLength(command)} bytes — the shell may have leaked back in`,
  )
})

test('cli-dispatch-status.sh is valid bash', () => {
  execFileSync('bash', ['-n', SH_PATH])
})

test('cli-dispatch-status.sh probes every backend and never prints a key value', () => {
  const script = readFileSync(SH_PATH, 'utf8')
  for (const wrapper of ['claude-ds', 'ag-agent', 'cx-agent', 'oc-agent', 'cp-agent']) {
    assert.match(script, new RegExp(`command -v ${wrapper}\\b`), `${wrapper} probe is missing`)
  }
  // Keys are reported as set/MISSING only. An echo of the variable itself would
  // leak the secret into the transcript.
  for (const key of ['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'CODEX_API_KEY']) {
    assert.doesNotMatch(script, new RegExp(`echo[^\\n]*\\$\\{?${key}`), `${key} value is echoed`)
  }
})
