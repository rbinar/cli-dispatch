// Issue #215 follow-up: the --fix-attempts resume prompt carries the verify output, so it must
// reach the resumed worker as a 0600 temp file (--prompt-file), never on a command line.
//   (a) every *-agent wrapper forwards --prompt-file to its stream instead of -p "$TASK"
//   (b) cli-dispatch-run --fix-attempts 1 resumes each backend with --prompt-file, removes the file
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SENTINEL = 'SENTINEL-215-fix-9c1e'

// ---- (a) agent wrappers
const AGENTS = [['ag-agent', 'ag-stream'], ['cx-agent', 'cx-stream'], ['oc-agent', 'oc-stream'], ['cp-agent', 'cp-stream'], ['ds-agent', 'claude-ds-stream']]
for (const [agent, stream] of AGENTS) {
  test(`${agent}: --prompt-file (both spellings) is forwarded to ${stream}, task text never on argv`, () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-pf-')))
    try {
      const bin = path.join(root, 'bin'); mkdirSync(bin)
      writeFileSync(path.join(bin, stream), `#!/bin/bash\nprintf '%s\\n' "$@" > "${root}/stream.argv"\nexit 0\n`)
      chmodSync(path.join(bin, stream), 0o755)
      const brief = path.join(root, 'brief.txt'); writeFileSync(brief, `${SENTINEL}\n`, { mode: 0o600 })
      const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, CLI_DISPATCH_CONFIG: '/dev/null' }
      const go = (args) => spawnSync('bash', [path.join(SCRIPTS, agent), '-q', ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env, input: '' })
      for (const args of [['--prompt-file', brief], [`--prompt-file=${brief}`]]) {
        rmSync(path.join(root, 'stream.argv'), { force: true })
        const r = go(args)
        assert.equal(r.status, 0, r.stderr)
        const argv = readFileSync(path.join(root, 'stream.argv'), 'utf8').split('\n')
        const i = argv.indexOf('--prompt-file')
        assert.ok(i >= 0 && argv[i + 1] === brief, `no --prompt-file <path> in:\n${argv.join('\n')}`)
        assert.ok(!argv.includes('-p'), '-p still passed')
        assert.ok(!argv.join('\n').includes(SENTINEL))
      }
      // unchanged without it
      rmSync(path.join(root, 'stream.argv'), { force: true })
      assert.equal(go(['plain task']).status, 0)
      const plain = readFileSync(path.join(root, 'stream.argv'), 'utf8').split('\n')
      assert.deepEqual(plain.slice(plain.indexOf('-p'), plain.indexOf('-p') + 2), ['-p', 'plain task'])
      // mutually exclusive with a task
      for (const args of [['--prompt-file', brief, 'a task'], ['--prompt-file', brief, '-p', 'a task']]) {
        rmSync(path.join(root, 'stream.argv'), { force: true })
        const r = go(args)
        assert.equal(r.status, 2, r.stderr)
        assert.match(r.stderr, /mutually exclusive/)
        assert.ok(!existsSync(path.join(root, 'stream.argv')), 'stream must not be launched')
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

// ---- (b) cli-dispatch-run --fix-attempts
const NAME = { ds: 'deepseek', ag: 'antigravity', cx: 'codex', oc: 'opencode', cp: 'copilot' }
const BACKENDS = [['ds', 'claude-ds-stream'], ['ag', 'ag-agent'], ['cx', 'cx-agent'], ['oc', 'oc-agent'], ['cp', 'cp-agent']]
for (const [pfx, resumeBin] of BACKENDS) {
  test(`--fix-attempts (${pfx}): the resume gets --prompt-file, the fix prompt is not on argv, the file is removed`, () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'cd-fixpf-')))
    try {
      const bin = path.join(dir, 'bin'); mkdirSync(bin)
      for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
        copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); chmodSync(path.join(bin, f), 0o755)
      }
      const repo = path.join(dir, 'repo'), sessions = path.join(dir, 'sessions'), rec = path.join(dir, 'rec'), tmp = path.join(dir, 'tmp')
      for (const d of [sessions, rec, tmp]) mkdirSync(d)
      execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo seed > note.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed`)
      const sid = `${pfx}-fix-session`
      writeFileSync(path.join(bin, `${pfx}-worktree-run.sh`), `#!/usr/bin/env bash
REPO="$1"; S="${sessions}/${sid}"; mkdir -p "$S"
printf '{"state":"done","sessionId":"${sid}","backend":"${NAME[pfx]}"}' > "$S/status.json"
printf '{"backend":"${NAME[pfx]}","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "session: ${sid}" >&2
exit 0
`)
      chmodSync(path.join(bin, `${pfx}-worktree-run.sh`), 0o755)
      // Resume stub: records argv, the --prompt-file path, whether it existed, its mode and content; then "fixes".
      writeFileSync(path.join(bin, resumeBin), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${rec}/resume-argv"
while [ "$#" -gt 0 ]; do [ "$1" = --prompt-file ] && F="$2"; shift; done
if [ -n "\${F:-}" ] && [ -f "$F" ]; then printf '%s' "$F" > "${rec}/pf-path"; cp "$F" "${rec}/pf-content"; stat -c %a "$F" 2>/dev/null > "${rec}/pf-mode" || stat -f %Lp "$F" > "${rec}/pf-mode"; fi
: > fixed.txt
`)
      chmodSync(path.join(bin, resumeBin), 0o755)
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1' }
      const verify = `echo ${SENTINEL}-verify-out; test -f fixed.txt`
      const r = spawnSync('bash', [path.join(bin, 'cli-dispatch-run'), '--backend', pfx, '--cwd', repo, '--prompt', 'x', '--fix-attempts', '1', '--verify', verify], { encoding: 'utf8', timeout: 120000, env })
      assert.equal(r.status, 0, r.stderr.slice(-600))
      const read = (n) => (existsSync(path.join(rec, n)) ? readFileSync(path.join(rec, n), 'utf8') : '')
      const argv = read('resume-argv').split('\n')
      assert.ok(argv.includes('--resume') && argv.some((a) => a.endsWith(`${pfx}-fix-session`)), `resume not launched:\n${argv.join('\n')}`)
      assert.ok(argv.includes('--prompt-file'), `no --prompt-file in:\n${argv.join('\n')}`)
      assert.ok(!argv.includes('-p'), '-p on the resume argv')
      assert.ok(!argv.join('\n').includes('verify command'), 'fix prompt text is on the resume argv')
      assert.ok(!argv.join('\n').includes(SENTINEL), 'verify output is on the resume argv')
      assert.match(read('pf-content'), /verify command\(s\) failed/)
      assert.ok(read('pf-content').includes(`${SENTINEL}-verify-out`), 'file lacks the verify output')
      assert.equal(read('pf-mode').trim(), '600')
      assert.ok(!existsSync(read('pf-path')), 'fix-prompt file was not removed')
      assert.deepEqual(readdirSync(tmp), [], 'temp files left behind')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

// ---- 7.1.0: the Ollama backend (ol) -------------------------------------------------------------
// ol-agent is a shim over ds-agent; the stream is stubbed, so ds-agent must be the plugin's own copy
// (PATH without ~/.local/bin).
const HERMETIC_PATH = (process.env.PATH || '').split(':').filter((p) => p && !p.includes('/.local/bin')).join(':')

test('ol-agent: --prompt-file is forwarded to claude-ds-stream (with CLAUDE_DS_BACKEND=ollama), task text never on argv', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-pf-ol-')))
  try {
    const bin = path.join(root, 'bin'); mkdirSync(bin)
    writeFileSync(path.join(bin, 'claude-ds-stream'), `#!/bin/bash\nprintf '%s\\n' "$@" > "${root}/stream.argv"\nprintf '%s' "$CLAUDE_DS_BACKEND" > "${root}/stream.backend"\nexit 0\n`)
    chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
    const brief = path.join(root, 'brief.txt'); writeFileSync(brief, `${SENTINEL}\n`, { mode: 0o600 })
    const r = spawnSync('bash', [path.join(SCRIPTS, 'ol-agent'), '-q', '--prompt-file', brief], { cwd: root, encoding: 'utf8', timeout: 60000, input: '', env: { PATH: `${bin}:${HERMETIC_PATH}`, HOME: root, CLI_DISPATCH_CONFIG: '/dev/null' } })
    assert.equal(r.status, 0, r.stderr)
    const argv = readFileSync(path.join(root, 'stream.argv'), 'utf8').split('\n')
    const i = argv.indexOf('--prompt-file')
    assert.ok(i >= 0 && argv[i + 1] === brief, `no --prompt-file <path> in:\n${argv.join('\n')}`)
    assert.ok(!argv.includes('-p'), '-p still passed')
    assert.ok(!argv.join('\n').includes(SENTINEL))
    assert.equal(readFileSync(path.join(root, 'stream.backend'), 'utf8'), 'ollama')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// cli-dispatch-run checks Ollama before the worktree; the fixture answers only while the event loop
// runs, so the runner is spawned async here.
test('--fix-attempts (ol): the resume gets --prompt-file and CLAUDE_DS_BACKEND=ollama, the fix prompt is not on argv, the file is removed', async () => {
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const srv = createServer((req, res) => res.end(JSON.stringify({ models: [{ name: 'm', model: 'm' }] })))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'cd-fixpf-ol-')))
  try {
    const bin = path.join(dir, 'bin'); mkdirSync(bin)
    for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh', 'stream-utils.sh']) {
      copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); chmodSync(path.join(bin, f), 0o755)
    }
    const repo = path.join(dir, 'repo'), sessions = path.join(dir, 'sessions'), rec = path.join(dir, 'rec'), tmp = path.join(dir, 'tmp')
    for (const d of [sessions, rec, tmp]) mkdirSync(d)
    execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo seed > note.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed`)
    const sid = 'ol-fix-session'
    // ol runs through the DeepSeek worktree runner.
    writeFileSync(path.join(bin, 'ds-worktree-run.sh'), `#!/usr/bin/env bash
REPO="$1"; S="${sessions}/${sid}"; mkdir -p "$S"
printf '{"state":"done","sessionId":"${sid}","backend":"ollama"}' > "$S/status.json"
printf '{"backend":"ollama","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "claude-ds session: ${sid}" >&2
exit 0
`)
    chmodSync(path.join(bin, 'ds-worktree-run.sh'), 0o755)
    writeFileSync(path.join(bin, 'claude-ds-stream'), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${rec}/resume-argv"
printf '%s' "$CLAUDE_DS_BACKEND" > "${rec}/backend"
while [ "$#" -gt 0 ]; do [ "$1" = --prompt-file ] && F="$2"; shift; done
if [ -n "\${F:-}" ] && [ -f "$F" ]; then printf '%s' "$F" > "${rec}/pf-path"; cp "$F" "${rec}/pf-content"; fi
: > fixed.txt
`)
    chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1',
      CLI_DISPATCH_CONFIG: '/dev/null', OLLAMA_BASE_URL: `http://127.0.0.1:${srv.address().port}`, OL_MODEL: 'm' }
    delete env.CLI_DISPATCH_WORKER
    const verify = `echo ${SENTINEL}-verify-out; test -f fixed.txt`
    const r = await new Promise((resolve) => {
      const c = spawn('bash', [path.join(bin, 'cli-dispatch-run'), '--backend', 'ol', '--cwd', repo, '--prompt', 'x', '--fix-attempts', '1', '--verify', verify], { env })
      let stderr = ''
      c.stderr.on('data', (d) => { stderr += d })
      c.on('close', (status) => resolve({ status, stderr }))
      c.stdin.end()
    })
    assert.equal(r.status, 0, r.stderr.slice(-600))
    const read = (n) => (existsSync(path.join(rec, n)) ? readFileSync(path.join(rec, n), 'utf8') : '')
    const argv = read('resume-argv').split('\n')
    assert.ok(argv.includes('--resume') && argv.includes(sid), `resume not launched:\n${argv.join('\n')}`)
    assert.ok(argv.includes('--prompt-file'), `no --prompt-file in:\n${argv.join('\n')}`)
    assert.ok(!argv.includes('-p'), '-p on the resume argv')
    assert.ok(!argv.join('\n').includes(SENTINEL), 'verify output is on the resume argv')
    assert.equal(read('backend'), 'ollama')
    assert.ok(read('pf-content').includes(`${SENTINEL}-verify-out`), 'file lacks the verify output')
    assert.ok(!existsSync(read('pf-path')), 'fix-prompt file was not removed')
    assert.deepEqual(readdirSync(tmp), [], 'temp files left behind')
  } finally { srv.closeAllConnections?.(); srv.close(); rmSync(dir, { recursive: true, force: true }) }
})
