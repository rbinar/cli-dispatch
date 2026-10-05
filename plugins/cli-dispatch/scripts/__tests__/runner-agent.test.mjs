// runner-agent.test.mjs — the thin `cli-dispatch:runner` babysitter (5.2.0) and the shell
// pieces it stands on. The babysitter itself only forwards: everything mechanical lives in
// shell so it is deterministic and testable here.
//
//   --detach          runner re-launches itself in the background and returns at once, so a
//                     run longer than the Bash tool's 10-minute ceiling is not killed
//   wait --run <id>   blocks on that detached run and prints its compact summary
//   --fix-attempts N  on a verify FAIL, resume the worker once with the verify tail, re-verify
//
// Test seam (same as cli-dispatch-run-verify.test.mjs): `--resume <id>` re-attaches to a seeded
// terminal session, so no real worker is launched. The fix-attempt path resumes the worker
// through `claude-ds-stream --resume`, which is stubbed on PATH.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { analyzeTranscriptText } from '../drift-report.mjs'
import { buildPolicyContext } from '../policy-inject.mjs'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(SELF_DIR, '..')
const RUNNER = path.join(SCRIPTS, 'cli-dispatch-run')
const WAIT = path.join(SCRIPTS, 'cli-dispatch-wait')
const CLEAN = path.join(SCRIPTS, 'cli-dispatch-clean.mjs')
const WRITER = path.join(SCRIPTS, 'verdict-writer.mjs')
const AGENT = path.join(SCRIPTS, '..', 'agents', 'runner.md')
const SID = 'ds-test-session'

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

function fixture() {
  const repo = mkdtemp('cd-agent-repo-')
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
  execSync('git init -q', { cwd: repo, env })
  fs.writeFileSync(path.join(repo, 'note.txt'), 'seed\n')
  execSync('git add note.txt && git commit -q -m seed', { cwd: repo, env })
  const root = mkdtemp('cd-agent-sessions-')
  const dir = path.join(root, SID)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ state: 'done', sessionId: SID }))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: repo, model: 'test-model' }))
  fs.writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
  // Stub worker: on resume it records its argv and cwd, and "fixes" the repo.
  const bin = mkdtemp('cd-agent-bin-')
  const log = path.join(bin, 'calls.log')
  fs.writeFileSync(path.join(bin, 'claude-ds-stream'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "cwd=$PWD" "$@" >> "${log}"\n[ -n "\${STUB_NO_FIX:-}" ] || : > fixed.txt\nexit 0\n`)
  fs.chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
  const envOut = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    CLI_DISPATCH_SESSIONS_DIR: root,
    CLI_DISPATCH_VERDICT_WRITER: WRITER,
  }
  return { repo, root, dir, log, env: envOut, cleanup: () => { rmrf(repo); rmrf(root); rmrf(bin) } }
}

const run = (cmd, args, env, opts = {}) => spawnSync('bash', [cmd, ...args], { encoding: 'utf8', env, timeout: 60000, ...opts })
const verdictOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf8'))

test('--detach returns at once with a run id; wait --run blocks, prints the summary and the runner exit code', () => {
  const f = fixture()
  try {
    const t0 = Date.now()
    const d = run(RUNNER, ['--detach', '--backend', 'ds', '--cwd', f.repo, '--resume', SID, '--verify', 'true'], f.env)
    assert.equal(d.status, 0, d.stdout + d.stderr)
    assert.ok(Date.now() - t0 < 10000, 'detach must not wait for the run')
    const m = /^run: (\S+)$/m.exec(d.stdout)
    assert.ok(m, `expected a "run: <id>" line, got: ${d.stdout}`)
    const id = m[1]

    const w = run(WAIT, ['--run', id, '--timeout', '60'], f.env)
    assert.equal(w.status, 0, w.stdout + w.stderr)
    assert.match(w.stdout, /verify: pass/)
    assert.match(w.stdout, new RegExp(`session: ${SID}`))

    const runDir = path.join(f.root, '.runs', id)
    for (const name of ['pid', 'log', 'session', 'exit', 'summary.txt']) {
      assert.ok(fs.existsSync(path.join(runDir, name)), `run dir must contain ${name}`)
    }
    assert.equal(fs.readFileSync(path.join(runDir, 'session'), 'utf8').trim(), SID)
    assert.equal(fs.readFileSync(path.join(runDir, 'exit'), 'utf8').trim(), '0')
  } finally { f.cleanup() }
})

test('wait --run passes a failing verify through as the runner exit code', () => {
  const f = fixture()
  try {
    const d = run(RUNNER, ['--detach', '--backend', 'ds', '--cwd', f.repo, '--resume', SID, '--verify', 'false'], f.env)
    const id = /^run: (\S+)$/m.exec(d.stdout)[1]
    const w = run(WAIT, ['--run', id, '--timeout', '60'], f.env)
    assert.equal(w.status, 1, w.stdout + w.stderr)
    assert.match(w.stdout, /verify: FAIL/)
  } finally { f.cleanup() }
})

test('wait --run exits 2 on timeout while the run is still going', () => {
  const f = fixture()
  try {
    const runDir = path.join(f.root, '.runs', 'still-running')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'pid'), String(process.pid))
    const t0 = Date.now()
    const w = run(WAIT, ['--run', 'still-running', '--timeout', '1'], f.env)
    assert.equal(w.status, 2, w.stdout + w.stderr)
    assert.ok(Date.now() - t0 < 15000)
  } finally { f.cleanup() }
})

test('--fix-attempts 1: verify FAIL resumes the worker once with the verify tail, then re-verifies to a pass', () => {
  const f = fixture()
  try {
    const r = run(RUNNER, ['--backend', 'ds', '--cwd', f.repo, '--resume', SID, '--verify', 'test -f fixed.txt', '--fix-attempts', '1'], f.env)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const calls = fs.readFileSync(f.log, 'utf8')
    assert.match(calls, new RegExp(`cwd=${fs.realpathSync(f.repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|cwd=${f.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the worker resumes in the run worktree')
    assert.match(calls, /--resume\n/)
    assert.match(calls, new RegExp(`\\n${SID}\\n`))
    assert.match(calls, /test -f fixed\.txt/, 'the follow-up prompt names the failing verify command')
    const v = verdictOf(f.dir)
    assert.equal(v.verify.exitCode, 0)
    assert.deepEqual(v.fixAttempts, { used: 1, max: 1 })
  } finally { f.cleanup() }
})

test('--fix-attempts stops at the limit and reports the FAIL', () => {
  const f = fixture()
  try {
    const r = run(RUNNER, ['--backend', 'ds', '--cwd', f.repo, '--resume', SID, '--verify', 'test -f fixed.txt', '--fix-attempts', '1'], { ...f.env, STUB_NO_FIX: '1' })
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.equal(fs.readFileSync(f.log, 'utf8').split('\n').filter((l) => l === '--resume').length, 1, 'exactly one resume')
    const v = verdictOf(f.dir)
    assert.notEqual(v.verify.exitCode, 0)
    assert.deepEqual(v.fixAttempts, { used: 1, max: 1 })
  } finally { f.cleanup() }
})

test('without --fix-attempts a verify FAIL never resumes the worker (/cli-dispatch:run unchanged)', () => {
  const f = fixture()
  try {
    const r = run(RUNNER, ['--backend', 'ds', '--cwd', f.repo, '--resume', SID, '--verify', 'test -f fixed.txt'], f.env)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.equal(fs.existsSync(f.log), false, 'the worker must not be resumed')
    const v = verdictOf(f.dir)
    assert.ok(v.fixAttempts === undefined || v.fixAttempts.used === 0)
  } finally { f.cleanup() }
})

test('cli-dispatch-clean never treats the .runs bookkeeping dir as a session', () => {
  const f = fixture()
  try {
    const runs = path.join(f.root, '.runs', 'old')
    fs.mkdirSync(runs, { recursive: true })
    const old = new Date(Date.now() - 30 * 86400 * 1000)
    fs.utimesSync(path.join(f.root, '.runs'), old, old)
    const out = spawnSync(process.execPath, [CLEAN, '--stale-secs', '1', '--older-than', '1', '--remove'], { encoding: 'utf8', env: f.env })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.doesNotMatch(out.stdout, /\.runs/)
    assert.ok(fs.existsSync(runs))
  } finally { f.cleanup() }
})

test('agents/runner.md is a thin haiku forwarder with only Bash', () => {
  const src = fs.readFileSync(AGENT, 'utf8')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(src)
  assert.ok(fm, 'frontmatter required')
  assert.match(fm[1], /^name: runner$/m)
  assert.match(fm[1], /^model: haiku$/m, 'model pinned in frontmatter (#95: overrides leaked otherwise)')
  assert.match(fm[1], /^tools: Bash$/m)
  assert.match(fm[1], /^description: .+/m)
  const body = src.slice(fm[0].length)
  assert.match(body, /--detach/)
  assert.match(body, /cli-dispatch-wait --run/)
  assert.match(body, /--fix-attempts 1/)
  assert.match(body, /<<'CDBRIEF'/, 'the brief goes through a quoted heredoc, never shell-interpolated')
  // Found end to end: haiku ran a third command (cat the patch) and returned a prose summary,
  // so the orchestrator lost the session id, verify line and patch path.
  assert.match(body, /Run no other command/)
  assert.match(body, /character for character/)
})

test('drift: delegating through the runner agent counts as runner adoption, not as drift', () => {
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'cli-dispatch:runner', description: 'x', prompt: 'backend: ds' } }] } })
  const a = analyzeTranscriptText(line + '\n')
  assert.equal(a.agentSpawns, 0)
  assert.equal(a.runnerInvocations, 1)
  const other = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'general-purpose', prompt: 'y' } }] } })
  assert.equal(analyzeTranscriptText(other + '\n').agentSpawns, 1)
})

test('policy routes delegation to the runner agent and no longer forbids a babysitter', () => {
  const ctx = buildPolicyContext({ enabled: true, schemaVersion: 1 })
  assert.match(ctx, /cli-dispatch:runner/)
  assert.doesNotMatch(ctx, /never spawn an LLM babysitter/)
  assert.match(ctx, /verify it yourself/, 'the re-measure rule stays')
  // Found in a live headless run: the orchestrator passed model: "sonnet", which overrides the
  // agent's haiku frontmatter, and blocked on the agent in the foreground.
  assert.match(ctx, /NO model parameter/)
  assert.match(ctx, /run_in_background: true/)
})
