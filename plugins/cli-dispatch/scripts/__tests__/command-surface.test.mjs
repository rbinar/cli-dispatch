// command-surface.test.mjs — 6.0.0 collapsed 35 slash commands into 12. The per-backend
// status/sessions/balance copies became a backend argument, the five *-run usage pages became
// one `ask`, status folded into doctor, wait into `watch --wait`, clean-schedule into
// `clean --schedule`, and drift into `gain --drift`. This file pins that surface: the exact
// command set, that nothing still points at a removed name, and that each merged command
// routes its arguments where the removed one used to.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(SCRIPTS, '..')
const REPO = path.join(PLUGIN, '..', '..')
const COMMANDS_DIR = path.join(PLUGIN, 'commands')
const COMMANDS = ['ask', 'balance', 'clean', 'doctor', 'gain', 'help', 'kill', 'resume', 'run', 'sessions', 'setup', 'watch']

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-surface-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
let n = 0
const scratch = () => { const d = path.join(tmp, String(n++)); fs.mkdirSync(d, { recursive: true }); return d }

const md = name => fs.readFileSync(path.join(COMMANDS_DIR, `${name}.md`), 'utf8')
const preExec = name => (md(name).match(/^!`([^`]+)`/m) || [])[1]
const bashFence = name => {
  const m = /^```bash\n([\s\S]*?)^```/m.exec(md(name))
  assert.ok(m, `${name}.md must carry a bash fence`)
  return m[1]
}

// Runs a command's bash fence the way Claude Code does: $ARGUMENTS and ${CLAUDE_PLUGIN_ROOT}
// substituted textually, then bash. `bin` is prepended to a PATH without ~/.local/bin.
function runFence(name, args, { pluginRoot = PLUGIN, bin, env = {}, cwd } = {}) {
  const dir = scratch()
  const file = path.join(dir, 'block.sh')
  fs.writeFileSync(file, bashFence(name).replace(/\$ARGUMENTS/g, args).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot))
  return spawnSync('bash', [file], {
    cwd: cwd || dir, encoding: 'utf8', timeout: 30000,
    env: { PATH: `${bin ? bin + ':' : ''}${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch(), ...env },
  })
}

// A bin dir of stubs that print their own name and one argv entry per line.
function stubs(names) {
  const bin = scratch()
  for (const s of names) {
    fs.writeFileSync(path.join(bin, s), `#!/usr/bin/env bash\necho "STUB ${s}"\nfor a in "$@"; do echo "ARG[$a]"; done\necho "CWD[$PWD]"\n`)
    fs.chmodSync(path.join(bin, s), 0o755)
  }
  return bin
}

function runScript(script, args, env = {}) {
  return spawnSync('bash', [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME: scratch(), CLI_DISPATCH_CONFIG: '/dev/null', ...env },
  })
}

test('the commands dir carries exactly the 12 commands', () => {
  const have = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort()
  assert.deepEqual(have, COMMANDS)
})

test('help lists exactly the shipped commands', () => {
  const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-help.sh')], { encoding: 'utf8' })
  const listed = [...new Set([...r.stdout.matchAll(/\/cli-dispatch:([a-z-]+)/g)].map(m => m[1]))].sort()
  assert.deepEqual(listed, COMMANDS)
})

test('no shipped file or doc points at a removed command', () => {
  const REMOVED = [
    /cli-dispatch:(?:ds|ag|cx|oc|cp)-(?:run|status|sessions|balance)\b/,
    /cli-dispatch:(?:wait|drift|clean-schedule|status)\b/,
    /`\/?(?:ds|ag|cx|oc|cp)-(?:run|status|sessions|balance)`/,
  ]
  const files = []
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!['node_modules', '.git', 'vendor'].includes(e.name)) walk(p) }
      else if (/\.(md|sh|mjs|ps1|json)$|^[a-z-]+$/.test(e.name) && p !== fileURLToPath(import.meta.url)) files.push(p)
    }
  }
  walk(PLUGIN); walk(path.join(REPO, 'docs'))
  files.push(path.join(REPO, 'README.md'), path.join(REPO, 'README.tr.md'), path.join(REPO, 'CLAUDE.md'))
  const hits = []
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (REMOVED.some(re => re.test(line))) hits.push(`${path.relative(REPO, f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(hits, [])
})

// ---- doctor [backend] (absorbed status + the five *-status) ---------------------------------

test('doctor pre-executes with the plugin root and the user argument', () => {
  assert.match(preExec('doctor'), /cli-dispatch-doctor\.sh"?\s+"\$\{CLAUDE_PLUGIN_ROOT\}"\s+\$ARGUMENTS\s*$/)
})

test('doctor with no backend reports every backend', () => {
  const r = runScript('cli-dispatch-doctor.sh', [PLUGIN])
  for (const h of ['DeepSeek', 'Antigravity', 'Codex', 'OpenCode', 'Copilot']) assert.match(r.stdout, new RegExp(`──[^\n]*${h}`), h)
})

for (const arg of ['cx', 'codex']) {
  test(`doctor ${arg} reports only the Codex backend`, () => {
    const r = runScript('cli-dispatch-doctor.sh', [PLUGIN, arg])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /──[^\n]*Codex/)
    for (const h of ['DeepSeek', 'Antigravity', 'OpenCode', 'Copilot']) assert.doesNotMatch(r.stdout, new RegExp(`──[^\n]*${h}`), h)
  })
}

test('doctor rejects an unknown backend', () => {
  const r = runScript('cli-dispatch-doctor.sh', [PLUGIN, 'zz'])
  assert.notEqual(r.status, 0)
  assert.match(r.stdout + r.stderr, /ds.*ag.*cx.*oc.*cp|deepseek/i)
})

test('doctor warns when the installed copies are older than the plugin (from status)', () => {
  const home = scratch()
  fs.mkdirSync(path.join(home, '.config', 'cli-dispatch'), { recursive: true })
  fs.writeFileSync(path.join(home, '.config', 'cli-dispatch', '.installed-version'), '0.0.1\n')
  assert.match(runScript('cli-dispatch-doctor.sh', [PLUGIN], { HOME: home }).stdout, /stale/i)
  const current = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version
  fs.writeFileSync(path.join(home, '.config', 'cli-dispatch', '.installed-version'), `${current}\n`)
  assert.doesNotMatch(runScript('cli-dispatch-doctor.sh', [PLUGIN], { HOME: home }).stdout, /stale/i)
})

test('doctor shows the configured model (from status)', () => {
  const cfg = path.join(scratch(), 'config')
  fs.writeFileSync(cfg, 'CX_MODEL="gate-model-x"\n')
  assert.match(runScript('cli-dispatch-doctor.sh', [PLUGIN, 'cx'], { CLI_DISPATCH_CONFIG: cfg }).stdout, /gate-model-x/)
})

// ---- sessions [backend] / balance [backend] -------------------------------------------------

test('sessions and balance pass the user argument to their script', () => {
  assert.match(preExec('sessions'), /cli-dispatch-sessions\.sh"?\s+\$ARGUMENTS\s*$/)
  assert.match(preExec('balance'), /cli-dispatch-balance\.sh"?\s+\$ARGUMENTS\s*$/)
})

test('sessions accepts a short or long backend slug', () => {
  const root = scratch()
  for (const [id, backend] of [['cx-one', 'codex'], ['ds-one', 'deepseek']]) {
    fs.mkdirSync(path.join(root, id))
    fs.writeFileSync(path.join(root, id, 'meta.json'), JSON.stringify({ backend, startedAt: '2026-10-01T00:00:00Z' }))
    fs.writeFileSync(path.join(root, id, 'status.json'), JSON.stringify({ backend, state: 'done' }))
  }
  for (const arg of ['cx', 'codex']) {
    const r = runScript('cli-dispatch-sessions.sh', [arg], { CLI_DISPATCH_SESSIONS_DIR: root })
    assert.match(r.stdout, /cx-one/, arg)
    assert.doesNotMatch(r.stdout, /ds-one/, arg)
  }
})

for (const args of [['cp'], ['copilot'], ['--backend', 'copilot']]) {
  test(`balance ${args.join(' ')} reports only Copilot`, () => {
    const r = runScript('cli-dispatch-balance.sh', args)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /== GitHub Copilot ==/)
    assert.doesNotMatch(r.stdout, /== DeepSeek|== Codex|== OpenCode|== Antigravity/)
  })
}

// ---- ask <backend> "<prompt>" (replaced the five *-run pages) --------------------------------

test('ask is not pre-executed (it starts a paid worker)', () => {
  assert.equal(preExec('ask'), undefined)
})

const AGENTS = { ds: 'ds-agent', ag: 'ag-agent', cx: 'cx-agent', oc: 'oc-agent', cp: 'cp-agent' }
for (const [slug, agent] of Object.entries(AGENTS)) {
  test(`ask ${slug} forwards the prompt intact to ${agent} without touching the repo`, () => {
    const bin = stubs(Object.values(AGENTS))
    const cwd = scratch()
    const r = runFence('ask', `${slug} "two words"`, { bin, cwd })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, new RegExp(`^STUB ${agent}$`, 'm'))
    assert.match(r.stdout, /^ARG\[two words\]$/m)
    if (slug === 'ds' || slug === 'cx') {
      assert.match(r.stdout, /^ARG\[--read-only\]$/m, 'ds/cx have a real read-only mode')
    } else {
      // ag/oc/cp have no write-deny: they must run in a throwaway dir, never the caller's cwd.
      assert.doesNotMatch(r.stdout, /^ARG\[--read-only\]$/m, `${agent} rejects --read-only`)
      const at = r.stdout.split('\n').indexOf('ARG[--cwd]')
      assert.ok(at >= 0, 'ag/oc/cp must get --cwd')
      const dir = r.stdout.split('\n')[at + 1].slice(4, -1)
      assert.notEqual(path.resolve(dir), path.resolve(cwd))
    }
  })
}

test('ask rejects a missing or unknown backend', () => {
  const bin = stubs(Object.values(AGENTS))
  for (const args of ['', 'zz "hi"', 'ds']) {
    const r = runFence('ask', args, { bin })
    assert.notEqual(r.status, 0, args)
    assert.doesNotMatch(r.stdout, /^STUB /m, args)
  }
})

// ---- watch <id> [--wait] (absorbed wait) ----------------------------------------------------

test('watch --wait blocks through cli-dispatch-wait with the remaining flags', () => {
  const r = runFence('watch', 'abc --wait --timeout 5', { bin: stubs(['cli-dispatch-wait']) })
  assert.match(r.stdout, /^STUB cli-dispatch-wait$/m)
  assert.match(r.stdout, /^ARG\[abc\]$/m)
  assert.match(r.stdout, /^ARG\[--timeout\]\nARG\[5\]$/m)
})

test('watch without --wait reads status.json once and never waits', () => {
  const root = scratch()
  fs.mkdirSync(path.join(root, 'abc'))
  fs.writeFileSync(path.join(root, 'abc', 'status.json'), '{"state":"running","gate":"seen"}')
  const r = runFence('watch', 'abc', { bin: stubs(['cli-dispatch-wait']), env: { CLI_DISPATCH_SESSIONS_DIR: root } })
  assert.match(r.stdout, /"gate":"seen"/)
  assert.doesNotMatch(r.stdout, /STUB cli-dispatch-wait/)
})

// ---- clean [--schedule …] (absorbed clean-schedule; body is now the installed binary) --------

function fakePluginRoot() {
  const root = scratch()
  fs.mkdirSync(path.join(root, 'scripts'))
  for (const s of ['cli-dispatch-clean', 'cli-dispatch-clean-schedule.sh']) {
    fs.writeFileSync(path.join(root, 'scripts', s), `#!/usr/bin/env bash\necho "PLUGIN ${s}"\nfor a in "$@"; do echo "ARG[$a]"; done\n`)
    fs.chmodSync(path.join(root, 'scripts', s), 0o755)
  }
  return root
}

test('clean is not pre-executed and is a thin call, not a copy of the engine', () => {
  assert.equal(preExec('clean'), undefined, 'clean deletes things; it must never run before the model sees it')
  assert.ok(md('clean').split('\n').length < 90, 'clean.md must not embed the sweep again')
})

test('clean passes its flags to the installed cli-dispatch-clean', () => {
  const r = runFence('clean', '--remove --older-than 7', { pluginRoot: fakePluginRoot(), bin: stubs(['cli-dispatch-clean']) })
  assert.match(r.stdout, /^STUB cli-dispatch-clean$/m)
  assert.match(r.stdout, /^ARG\[--remove\]\nARG\[--older-than\]\nARG\[7\]$/m)
})

test('clean falls back to the plugin copy when cli-dispatch-clean is not on PATH', () => {
  const r = runFence('clean', '--remove', { pluginRoot: fakePluginRoot() })
  assert.match(r.stdout, /^PLUGIN cli-dispatch-clean$/m)
})

test('clean --schedule routes to the schedule script, not to a cleanup', () => {
  const r = runFence('clean', '--schedule install --time 03:30', { pluginRoot: fakePluginRoot(), bin: stubs(['cli-dispatch-clean']) })
  assert.match(r.stdout, /^PLUGIN cli-dispatch-clean-schedule\.sh$/m)
  assert.match(r.stdout, /^ARG\[install\]\nARG\[--time\]\nARG\[03:30\]$/m)
  assert.doesNotMatch(r.stdout, /cli-dispatch-clean$/m)
})

// ---- gain [--drift] (absorbed drift) --------------------------------------------------------

test('gain --drift runs the drift report', () => {
  const r = runFence('gain', '--drift --days 3', { bin: stubs(['cli-dispatch-gain']) })
  assert.match(r.stdout, /cli-dispatch drift \(3d\)/)
  assert.doesNotMatch(r.stdout, /STUB cli-dispatch-gain/)
})

test('gain without --drift still runs the gain report', () => {
  const r = runFence('gain', '', { bin: stubs(['cli-dispatch-gain']) })
  assert.match(r.stdout, /^STUB cli-dispatch-gain$/m)
})
