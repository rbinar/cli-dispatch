import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Several read-only commands moved their shell out of the command markdown and
// into a script invoked through the command's `!` pre-execution line (4.9.0 for
// status, 4.10.0 for the rest). The saving only holds while each markdown stays
// thin AND keeps pointing at a script that actually exists — these tests guard
// that pair, one table row per converted command.

const here = path.dirname(fileURLToPath(import.meta.url))
const scriptsDir = path.resolve(here, '..')
const commandsDir = path.resolve(scriptsDir, '..', 'commands')

const read = (p) => readFileSync(p, 'utf8')

const COMMANDS = [
  {
    name: 'status',
    script: 'cli-dispatch-status.sh',
    ps1: 'cli-dispatch-status.ps1',
    // Was 7615 bytes before extraction. Generous ceilings throughout — these
    // catch a markdown creeping back toward its old size, not wording edits.
    maxBytes: 1600,
    forbidden: [/```bash/, /command -v claude-ds/],
  },
  {
    name: 'ds-status',
    script: 'cli-dispatch-status.sh',
    maxBytes: 1000,
    forbidden: [/```bash/, /command -v claude-ds/],
  },
  {
    name: 'ag-status',
    script: 'cli-dispatch-status.sh',
    maxBytes: 1000,
    forbidden: [/```bash/, /command -v ag-agent/],
  },
  {
    name: 'cx-status',
    script: 'cli-dispatch-status.sh',
    maxBytes: 1000,
    forbidden: [/```bash/, /command -v cx-agent/],
  },
  {
    name: 'oc-status',
    script: 'cli-dispatch-status.sh',
    maxBytes: 1000,
    forbidden: [/```bash/, /command -v oc-agent/],
  },
  {
    name: 'cp-status',
    script: 'cli-dispatch-status.sh',
    maxBytes: 1000,
    forbidden: [/```bash/, /command -v cp-agent/],
  },
  {
    name: 'doctor',
    script: 'cli-dispatch-doctor.sh',
    maxBytes: 1200, // was 9135
    forbidden: [/```bash/, /command -v cx-agent/, /codex login status/],
  },
  {
    name: 'balance',
    script: 'cli-dispatch-balance.sh',
    maxBytes: 2000, // was 6410
    forbidden: [/```bash/, /api\.deepseek\.com/, /openrouter\.ai\/api/],
  },
  {
    name: 'sessions',
    script: 'cli-dispatch-sessions.sh',
    maxBytes: 1200,
    forbidden: [/```bash/, /CLI_DISPATCH_BACKEND_FILTER/],
  },
  {
    name: 'ds-sessions',
    script: 'cli-dispatch-sessions.sh',
    maxBytes: 1200,
    forbidden: [/```bash/, /CLI_DISPATCH_BACKEND_FILTER/],
  },
  {
    name: 'ag-sessions',
    script: 'cli-dispatch-sessions.sh',
    maxBytes: 1200,
    forbidden: [/```bash/, /CLI_DISPATCH_BACKEND_FILTER/],
  },
  {
    name: 'cx-sessions',
    script: 'cli-dispatch-sessions.sh',
    maxBytes: 1200,
    forbidden: [/```bash/, /CLI_DISPATCH_BACKEND_FILTER/],
  },
  {
    name: 'oc-sessions',
    script: 'cli-dispatch-sessions.sh',
    maxBytes: 1200,
    forbidden: [/```bash/, /CLI_DISPATCH_BACKEND_FILTER/],
  },
  {
    name: 'cp-sessions',
    script: 'cli-dispatch-sessions.sh',
    maxBytes: 1200,
    forbidden: [/```bash/, /CLI_DISPATCH_BACKEND_FILTER/],
  },
  {
    name: 'help',
    script: 'cli-dispatch-help.sh',
    maxBytes: 600, // was 3501 — almost all of it was the reference box itself
    forbidden: [/```bash/, /cat <<'HELP'/, /┌─ cli-dispatch/],
  },
  {
    name: 'clean-schedule',
    script: 'cli-dispatch-clean-schedule.sh',
    // Keeps a ```bash forwarding line (install/uninstall are deliberate, not
    // pre-executed) and the native-Windows Scheduled Tasks block, so it lands
    // higher than the others. Was 5827.
    maxBytes: 3500,
    // Match the scheduler CALLS, not the words — the prose deliberately explains
    // that a bare run must never rewrite a crontab.
    forbidden: [/launchctl (load|unload|list)/, /crontab -/, /<\?xml/],
  },
]

for (const cmd of COMMANDS) {
  const commandPath = path.join(commandsDir, `${cmd.name}.md`)
  const scriptPath = path.join(scriptsDir, cmd.script)
  const markdown = read(commandPath)

  test(`${cmd.name}.md pre-executes its extracted script`, () => {
    const preExec = markdown.match(/^!`([^`]+)`/m)
    assert.ok(preExec, `${cmd.name}.md must open with a \`!\`-prefixed pre-execution line`)
    assert.match(preExec[1], new RegExp(cmd.script.replace('.', '\\.')))
    assert.match(
      preExec[1],
      /\$\{CLAUDE_PLUGIN_ROOT\}/,
      'must run from the plugin cache, not ~/.local/bin',
    )
  })

  test(`${cmd.name}.md no longer embeds the extracted shell`, () => {
    // The whole point of the extraction: the model must never pay to re-emit
    // this. A single stray probe means the shell leaked back into the markdown.
    for (const pattern of cmd.forbidden) {
      assert.doesNotMatch(markdown, pattern, `${pattern} is back in ${cmd.name}.md`)
    }
  })

  test(`${cmd.name}.md stays small enough to be worth the extraction`, () => {
    const bytes = Buffer.byteLength(markdown)
    assert.ok(
      bytes < cmd.maxBytes,
      `${cmd.name}.md grew to ${bytes} bytes (ceiling ${cmd.maxBytes}) — the shell may have leaked back in`,
    )
  })

  test(`${cmd.script} exists and is valid bash`, () => {
    assert.ok(existsSync(scriptPath), `${cmd.script} is missing`)
    execFileSync('bash', ['-n', scriptPath])
  })

  if (cmd.ps1) {
    test(`${cmd.name} keeps its PowerShell twin`, () => {
      assert.ok(existsSync(path.join(scriptsDir, cmd.ps1)), `${cmd.ps1} is missing`)
    })
  }
}

test('status + doctor pass the plugin root as an argument, not via env', () => {
  // Claude Code interpolates ${CLAUDE_PLUGIN_ROOT} into the `!` command string
  // but does NOT export it into the subprocess. Reading only the env var left
  // status's staleness warning silently dead for the whole of 4.9.0.
  for (const name of ['status', 'doctor']) {
    const preExec = read(path.join(commandsDir, `${name}.md`)).match(/^!`([^`]+)`/m)[1]
    const args = preExec.match(/\$\{CLAUDE_PLUGIN_ROOT\}/g) || []
    assert.ok(
      args.length >= 2,
      `${name}.md must pass \${CLAUDE_PLUGIN_ROOT} as an argument as well as in the script path`,
    )
  }
  for (const script of ['cli-dispatch-status.sh', 'cli-dispatch-doctor.sh']) {
    assert.match(
      read(path.join(scriptsDir, script)),
      /\$\{1:-\$\{CLAUDE_PLUGIN_ROOT:-\}\}/,
      `${script} must fall back to $1 for the plugin root`,
    )
  }
})

test('per-backend session commands pass their backend slug as an argument', () => {
  const expected = {
    'ds-sessions': 'deepseek',
    'ag-sessions': 'antigravity',
    'cx-sessions': 'codex',
    'oc-sessions': 'opencode',
    'cp-sessions': 'copilot',
  }
  for (const [name, backend] of Object.entries(expected)) {
    const preExec = read(path.join(commandsDir, `${name}.md`)).match(/^!`([^`]+)`/m)[1]
    assert.match(
      preExec,
      new RegExp(`cli-dispatch-sessions\\.sh"?\\s+${backend}\\s*$`),
      `${name}.md must pass ${backend} to cli-dispatch-sessions.sh`,
    )
  }
})

test('per-backend status commands pass their backend slug as a flag', () => {
  const expected = {
    'ds-status': 'deepseek',
    'ag-status': 'antigravity',
    'cx-status': 'codex',
    'oc-status': 'opencode',
    'cp-status': 'copilot',
  }
  for (const [name, backend] of Object.entries(expected)) {
    const preExec = read(path.join(commandsDir, `${name}.md`)).match(/^!`([^`]+)`/m)[1]
    assert.match(
      preExec,
      new RegExp(`cli-dispatch-status\\.sh"?\\s+--backend\\s+${backend}\\s+"?\\$\\{CLAUDE_PLUGIN_ROOT\\}"?\\s*$`),
      `${name}.md must pass --backend ${backend} to cli-dispatch-status.sh`,
    )
  }
})

test('clean-schedule pre-executes a read-only status probe, never an install', () => {
  // This command mutates the OS scheduler. Pre-execution runs before the model
  // sees anything, so it must never be able to write a plist or rewrite a crontab.
  const preExec = read(path.join(commandsDir, 'clean-schedule.md')).match(/^!`([^`]+)`/m)[1]
  assert.match(preExec, /cli-dispatch-clean-schedule\.sh"?\s+status\s*$/)
  assert.doesNotMatch(preExec, /install|uninstall|\$ARGUMENTS/)
})

test('cli-dispatch-clean-schedule.sh defaults to status when given no action', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cd-sched-'))
  try {
    const out = execFileSync(
      'bash',
      [path.join(scriptsDir, 'cli-dispatch-clean-schedule.sh')],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' },
    )
    assert.match(out, /action: status/)
    assert.doesNotMatch(out, /scheduled daily at/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cli-dispatch-doctor.sh probes every backend and never prints a key value', () => {
  const script = read(path.join(scriptsDir, 'cli-dispatch-doctor.sh'))
  for (const wrapper of ['claude-ds', 'ag-agent', 'cx-agent', 'oc-agent', 'cp-agent']) {
    assert.match(script, new RegExp(`\\b${wrapper}\\b`), `${wrapper} probe is missing`)
  }
  for (const key of ['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'CODEX_API_KEY', 'COPILOT_GITHUB_TOKEN']) {
    assert.doesNotMatch(script, new RegExp(`echo[^\\n]*\\$\\{?${key}`), `${key} value is echoed`)
  }
})

test('cli-dispatch-status.sh probes every backend and never prints a key value', () => {
  const script = read(path.join(scriptsDir, 'cli-dispatch-status.sh'))
  for (const wrapper of ['claude-ds', 'ag-agent', 'cx-agent', 'oc-agent', 'cp-agent']) {
    assert.match(script, new RegExp(`command -v ${wrapper}\\b`), `${wrapper} probe is missing`)
  }
  for (const key of ['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'CODEX_API_KEY']) {
    assert.doesNotMatch(script, new RegExp(`echo[^\\n]*\\$\\{?${key}`), `${key} value is echoed`)
  }
})

test('cli-dispatch-balance.sh emits all five backend sections and leaks no key', () => {
  const script = read(path.join(scriptsDir, 'cli-dispatch-balance.sh'))
  for (const section of ['DeepSeek', 'Antigravity', 'Codex', 'OpenCode', 'GitHub Copilot']) {
    assert.match(script, new RegExp(`echo "== ${section} =="`), `${section} section is missing`)
  }
  // Keys travel in curl Authorization headers only — never to stdout.
  for (const key of ['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']) {
    assert.doesNotMatch(script, new RegExp(`echo[^\\n]*\\$\\{?${key}`), `${key} value is echoed`)
  }
})
