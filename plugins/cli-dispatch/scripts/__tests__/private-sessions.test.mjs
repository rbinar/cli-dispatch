// #214: session files are private to the user (0600 in 0700 dirs), the detached run's log too, and a
// sessions dir that someone else owns is refused.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const mode = (p) => statSync(p).mode & 0o777

test('a parser creates its session dir 0700 and every file in it 0600, whatever the caller umask', { skip: process.platform === 'win32' }, () => {
  const base = mkdtempSync(path.join(tmpdir(), 'cd-priv-'))
  try {
    const dir = path.join(base, 'sess')
    const ev = JSON.stringify({ type: 'result', subtype: 'success', result: 'hi', session_id: 's', usage: { input_tokens: 1, output_tokens: 1 } })
    const r = spawnSync('sh', ['-c', `umask 022; node '${path.join(SCRIPTS, 'ds-stream-parse.mjs')}'`], { input: ev + '\n', encoding: 'utf8', env: { ...process.env, CLAUDE_DS_SESSION_DIR: dir } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(mode(dir), 0o700)
    const files = readdirSync(dir)
    assert.ok(files.includes('status.json') && files.includes('transcript.jsonl'), files.join(','))
    for (const f of files) assert.equal(mode(path.join(dir, f)), 0o600, f)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

function setup() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cd-priv-run-')))
  const bin = path.join(root, 'bin'), sess = path.join(root, 'sess'), repo = path.join(root, 'repo'), home = path.join(root, 'home')
  for (const d of [bin, sess, repo, home]) mkdirSync(d)
  writeFileSync(path.join(bin, 'claude'), '#!/bin/bash\nexit 0\n')
  chmodSync(path.join(bin, 'claude'), 0o755)
  const git = (a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
  git(['init', '-q']); git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base'])
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, DEEPSEEK_API_KEY: 'dummy', CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: sess }
  return { root, sess, repo, env }
}

test('cli-dispatch-run --detach: the run dir and its log are private, whatever the caller umask', { skip: process.platform === 'win32' }, async () => {
  const x = setup()
  try {
    const r = spawnSync('sh', ['-c', `umask 022; bash '${path.join(SCRIPTS, 'cli-dispatch-run')}' --detach --backend ds --cwd '${x.repo}' --prompt x`], { encoding: 'utf8', timeout: 60000, env: x.env })
    assert.equal(r.status, 0, r.stderr)
    const id = /^run: (\S+)/m.exec(r.stdout)[1]
    const runDir = path.join(x.sess, '.runs', id)
    for (let i = 0; i < 200 && !existsSync(path.join(runDir, 'exit')); i++) await new Promise((res) => setTimeout(res, 100))
    assert.equal(mode(runDir), 0o700)
    for (const f of readdirSync(runDir)) assert.equal(mode(path.join(runDir, f)), 0o600, f)
    assert.ok(readdirSync(runDir).includes('log'))
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('cli-dispatch-run refuses a CLI_DISPATCH_SESSIONS_DIR that another user owns', { skip: isRoot || process.platform === 'win32' }, () => {
  const x = setup()
  try {
    // "/" is owned by root on every Unix; the ownership check comes before the writability probe.
    const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', x.repo, '--prompt', 'x'], { encoding: 'utf8', timeout: 60000, env: { ...x.env, CLI_DISPATCH_SESSIONS_DIR: '/' } })
    assert.equal(r.status, 5, r.stderr)
    assert.match(r.stderr, /not owned by you/)
    assert.doesNotMatch(r.stderr, /not writable/)
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('claude-ds-stream refuses a CLI_DISPATCH_SESSIONS_DIR that another user owns', { skip: isRoot || process.platform === 'win32' }, () => {
  const x = setup()
  try {
    const r = spawnSync('bash', [path.join(SCRIPTS, 'claude-ds-stream'), '-p', 'x', '--cwd', x.repo], { encoding: 'utf8', timeout: 60000, env: { ...x.env, CLI_DISPATCH_SESSIONS_DIR: '/' } })
    assert.equal(r.status, 5, r.stderr)
    assert.match(r.stderr, /not owned by you/)
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})
