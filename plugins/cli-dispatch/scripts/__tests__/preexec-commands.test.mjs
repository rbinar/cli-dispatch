import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, chmodSync, readdirSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Several read-only commands moved their shell out of the command markdown and
// into a script invoked through the command's `!` pre-execution line (4.9.0 for
// doctor, 4.10.0 for the rest). The saving only holds while each markdown stays
// thin AND keeps pointing at a script that actually exists — these tests guard
// that pair, one table row per converted command.

const here = path.dirname(fileURLToPath(import.meta.url))
const scriptsDir = path.resolve(here, '..')
const commandsDir = path.resolve(scriptsDir, '..', 'commands')

const read = (p) => readFileSync(p, 'utf8')
const withoutFencedPowerShell = (s) => s.replace(/^```powershell[\s\S]*?^```/gmi, '')

const COMMANDS = [
  {
    name: 'doctor',
    script: 'cli-dispatch-doctor.sh',
    ps1: 'cli-dispatch-status.ps1',
    maxBytes: 2400, // was 9135; carries the native-Windows PowerShell fallback since 6.0.0
    forbidden: [/```bash/, /command -v cx-agent/, /codex login status/],
  },
  {
    name: 'balance',
    script: 'cli-dispatch-balance.sh',
    maxBytes: 3200, // was 6410; carries the per-backend notes + DeepSeek PowerShell fallback since 6.0.0
    stripFencedPowerShell: true,
    forbidden: [/```bash/, /api\.deepseek\.com/, /openrouter\.ai\/api/],
  },
  {
    name: 'sessions',
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
    const shellMarkdown = cmd.stripFencedPowerShell ? withoutFencedPowerShell(markdown) : markdown
    for (const pattern of cmd.forbidden) {
      assert.doesNotMatch(shellMarkdown, pattern, `${pattern} is back in ${cmd.name}.md`)
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

test('doctor passes the plugin root as an argument, not via env', () => {
  // Claude Code interpolates ${CLAUDE_PLUGIN_ROOT} into the `!` command string
  // but does NOT export it into the subprocess. Reading only the env var left
  // status's staleness warning silently dead for the whole of 4.9.0.
  for (const name of ['doctor']) {
    const preExec = read(path.join(commandsDir, `${name}.md`)).match(/^!`([^`]+)`/m)[1]
    const args = preExec.match(/\$\{CLAUDE_PLUGIN_ROOT\}/g) || []
    assert.ok(
      args.length >= 2,
      `${name}.md must pass \${CLAUDE_PLUGIN_ROOT} as an argument as well as in the script path`,
    )
  }
  for (const script of ['cli-dispatch-doctor.sh']) {
    assert.match(
      read(path.join(scriptsDir, script)),
      /\$\{1:-\$\{CLAUDE_PLUGIN_ROOT:-\}\}/,
      `${script} must fall back to $1 for the plugin root`,
    )
  }
})

test('balance keeps the DeepSeek native Windows PowerShell fallback but no fenced bash', () => {
  const markdown = read(path.join(commandsDir, 'balance.md'))
  assert.match(markdown, /^```powershell$/m)
  assert.doesNotMatch(markdown, /^```bash$/m)
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

test('cli-dispatch-clean-schedule.sh install fails loudly when crontab is missing', () => {
  // A Debian container without the cron package printed "scheduled daily" and exited 0.
  const home = mkdtempSync(path.join(os.tmpdir(), 'cd-sched-'))
  const bin = mkdtempSync(path.join(os.tmpdir(), 'cd-sched-bin-'))
  try {
    // Every system tool except crontab (on usrmerge distros /bin IS /usr/bin, so PATH=/bin
    // alone would still find it), plus a uname that forces the cron branch.
    for (const dir of ['/usr/bin', '/bin']) {
      for (const name of readdirSync(dir)) {
        if (name === 'crontab' || name === 'uname' || existsSync(path.join(bin, name))) continue
        try { symlinkSync(path.join(dir, name), path.join(bin, name)) } catch {}
      }
    }
    writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho Linux\n')
    chmodSync(path.join(bin, 'uname'), 0o755)
    const r = spawnSync('/bin/bash', [path.join(scriptsDir, 'cli-dispatch-clean-schedule.sh'), 'install'], {
      env: { HOME: home, PATH: bin }, encoding: 'utf8',
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /crontab not found/)
    assert.doesNotMatch(r.stdout, /scheduled daily at/)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
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
