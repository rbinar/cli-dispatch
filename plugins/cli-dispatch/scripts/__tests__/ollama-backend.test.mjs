// ollama-backend.test.mjs — the Ollama backend (`ol`, 7.1.0; .specs/dev/sdd/ollama-backend.md §8).
// `ol` is the DeepSeek pipeline (claude-ds-stream, ds-stream-parse.mjs, ds-worktree-run.sh) switched
// by CLAUDE_DS_BACKEND=ollama, so these tests drive the real scripts with a stub `claude` and an
// in-process node:http fixture standing in for Ollama (no network beyond 127.0.0.1, no model call).
// Every run gets a temp HOME and a PATH without ~/.local/bin, so an installed, stale copy of a
// script is never the code under test. The fixture answers only while the event loop runs, so
// everything that reaches it is spawned asynchronously.
import assert from 'node:assert/strict'
import { execSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { normalizeBackend } from '../parse-utils.mjs'
import { buildVerdict } from '../verdict-writer.mjs'
import { backendFromCommand, RUNNER_RE } from '../gain-report.mjs'
import { buildPolicyContext } from '../policy-inject.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(HERE, '..')
const PLUGIN = path.join(SCRIPTS, '..')
const STREAM = path.join(SCRIPTS, 'claude-ds-stream')
const RUNNER = path.join(SCRIPTS, 'cli-dispatch-run')
const MODEL = 'qwen3.8:27b'
const PATH_BASE = (process.env.PATH || '').split(':').filter((p) => p && !p.includes('/.local/bin')).join(':')
const PCT = Number(/^OL_CONTEXT_PCT=(\d+)$/m.exec(readFileSync(STREAM, 'utf8'))?.[1])
const REDUCERS = ['AUTO_MEMORY', 'GIT_INSTRUCTIONS', 'BUNDLED_SKILLS', 'EXPLORE_PLAN_AGENTS', 'CFC_PROMPT'].map((n) => `CLAUDE_CODE_DISABLE_${n}`)
const FIX_MARK = '[cli-dispatch] The verify command(s) failed'

// ---- fixtures ---------------------------------------------------------------------------------

// A stand-in for Ollama: /api/tags lists `models`, /api/ps answers `ps`. Records every path asked.
async function ollama({ models = [MODEL], ps = { models: [] } } = {}) {
  const requests = []
  const srv = http.createServer((req, res) => {
    requests.push(req.url)
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: models.map((m) => ({ name: m, model: m })) }))
    if (req.url === '/api/ps') return res.end(JSON.stringify(ps))
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}`
  return { url, requests, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()) }) }
}

async function closedPortUrl() {
  const srv = http.createServer()
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  await new Promise((r) => srv.close(r))
  return `http://127.0.0.1:${port}`
}

// A temp world: a git repo with one commit, a stub `claude` and an empty config. The stub records
// its env, argv and stdin per call (rec/<n>.env|argv|stdin), prints one result line, and touches
// `done` in its cwd when rec/mode is "always", or when its stdin is the runner's fix prompt.
function world() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ol-')))
  const x = { root, bin: path.join(root, 'bin'), home: path.join(root, 'home'), sessions: path.join(root, 'sessions'), repo: path.join(root, 'repo'), rec: path.join(root, 'rec'), cfg: path.join(root, 'config') }
  for (const d of [x.bin, x.home, x.repo, x.rec]) mkdirSync(d)
  execSync('git init -q && echo seed > seed.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed', { cwd: x.repo })
  writeFileSync(x.cfg, '')
  writeFileSync(path.join(x.bin, 'claude'), `#!/bin/bash
REC="${x.rec}"
n=$(ls "$REC" | grep -c '\\.env$')
env > "$REC/$n.env"
printf '%s\\n' "$@" > "$REC/$n.argv"
cat > "$REC/$n.stdin"
mode="$(cat "$REC/mode" 2>/dev/null)"
if [ "$mode" = always ] || grep -qF '${FIX_MARK}' "$REC/$n.stdin"; then : > done; fi
echo '{"type":"result","subtype":"success","result":"ok","session_id":"s"}'
`)
  chmodSync(path.join(x.bin, 'claude'), 0o755)
  return x
}

function cleanup(x) {
  // Worktrees the runner made live in /tmp, outside x.root.
  const out = spawnSync('git', ['-C', x.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout || ''
  for (const wt of out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).slice(1)) {
    spawnSync('git', ['-C', x.repo, 'worktree', 'remove', '--force', wt])
    rmSync(wt, { recursive: true, force: true })
  }
  rmSync(x.root, { recursive: true, force: true })
}

const baseEnv = (x, extra = {}) => ({
  PATH: `${x.bin}:${PATH_BASE}`, HOME: x.home, CLI_DISPATCH_CONFIG: x.cfg, CLI_DISPATCH_SESSIONS_DIR: x.sessions,
  CLI_DISPATCH_NO_GH_TOKEN: '1', CLI_DISPATCH_USERCONFIG_STATUS: path.join(x.root, 'no-ucs.json'), ...extra,
})

function run(cmd, args, { env, cwd, input = '' } = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env, cwd })
    let stdout = '', stderr = ''
    c.stdout.on('data', (d) => { stdout += d })
    c.stderr.on('data', (d) => { stderr += d })
    const t = setTimeout(() => c.kill('SIGKILL'), 150000)
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }) })
    c.stdin.end(input)
  })
}

const calls = (x) => readdirSync(x.rec).filter((f) => f.endsWith('.env')).length
const envOf = (x, n = 0) => {
  const e = {}
  for (const l of readFileSync(path.join(x.rec, `${n}.env`), 'utf8').split('\n')) {
    const i = l.indexOf('=')
    if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(l.slice(0, i))) e[l.slice(0, i)] = l.slice(i + 1)
  }
  return e
}
const argvOf = (x, n = 0) => readFileSync(path.join(x.rec, `${n}.argv`), 'utf8').split('\n')
const sessionDirs = (x) => (existsSync(x.sessions) ? readdirSync(x.sessions).filter((d) => !d.startsWith('.')) : [])
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const sessionDirFrom = (stderr) => /^ {2}dir: +(\S+)$/m.exec(stderr)?.[1]
const olEnv = (x, srv, extra = {}) => baseEnv(x, { CLAUDE_DS_BACKEND: 'ollama', OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL, ...extra })
const stream = (x, env, args = ['-p', 'x']) => run('bash', [STREAM, '--cwd', x.repo, ...args], { env, cwd: x.root })

// ---- AC1–AC3: the stream ------------------------------------------------------------------------

test('AC1: CLAUDE_DS_BACKEND=ollama runs claude against Ollama; config-only URL/model reach it; no key needed', async () => {
  const x = world(); const srv = await ollama()
  try {
    writeFileSync(x.cfg, `OLLAMA_BASE_URL="${srv.url}/"\nOL_MODEL="${MODEL}"\n`)
    const r = await stream(x, baseEnv(x, { CLAUDE_DS_BACKEND: 'ollama' }))
    assert.equal(r.status, 0, r.stderr)
    const e = envOf(x)
    assert.equal(e.ANTHROPIC_BASE_URL, srv.url, 'trailing / stripped')
    assert.equal(e.ANTHROPIC_AUTH_TOKEN, 'ollama')
    for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
      assert.equal(e[k], MODEL, k)
    }
    assert.equal(e.CLI_DISPATCH_WORKER, '1')
    assert.equal(e.DEEPSEEK_API_KEY, undefined)
  } finally { await srv.close(); cleanup(x) }
})

test('AC1: the default base URL is pinned and OL_MODEL has no default', () => {
  const text = readFileSync(STREAM, 'utf8')
  assert.ok(text.includes('OLLAMA_BASE_URL:-http://127.0.0.1:11434'))
  assert.ok(!text.includes('OL_MODEL:-'), 'OL_MODEL must have no default')
})

test('AC2: without CLAUDE_DS_BACKEND the stream is DeepSeek, unchanged', async () => {
  const x = world()
  try {
    const r = await stream(x, baseEnv(x, { DEEPSEEK_API_KEY: 'k-ds' }))
    assert.equal(r.status, 0, r.stderr)
    const e = envOf(x)
    assert.equal(e.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic')
    assert.equal(e.ANTHROPIC_AUTH_TOKEN, 'k-ds')
    assert.equal(e.ANTHROPIC_MODEL, 'deepseek-v4-pro')
    assert.equal(e.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash')
    assert.equal(e.CLAUDE_CODE_MAX_CONTEXT_TOKENS, undefined, 'AC21(f): no context override for DeepSeek')
    for (const k of REDUCERS) assert.equal(e[k], undefined, `AC22: ${k} is ollama-only`)
    const miss = await stream(x, baseEnv(x))
    assert.equal(miss.status, 1)
    assert.match(miss.stderr, /claude-ds-stream: DEEPSEEK_API_KEY not set\. Add it to /)
    assert.equal(calls(x), 1, 'no claude call without a key')
  } finally { cleanup(x) }
})

test('AC2: an unknown CLAUDE_DS_BACKEND is refused', async () => {
  const x = world()
  try {
    const r = await stream(x, baseEnv(x, { CLAUDE_DS_BACKEND: 'zz', DEEPSEEK_API_KEY: 'k' }))
    assert.equal(r.status, 1)
    assert.match(r.stderr, /unknown CLAUDE_DS_BACKEND 'zz'/)
    assert.equal(calls(x), 0)
  } finally { cleanup(x) }
})

test('AC3: an ollama session is labelled ollama with OL_MODEL; a default one still says deepseek', async () => {
  const x = world(); const srv = await ollama()
  try {
    const r = await stream(x, olEnv(x, srv))
    assert.equal(r.status, 0, r.stderr)
    const sid = /^claude-ds session: (\S+)$/m.exec(r.stderr)?.[1]
    assert.ok(sid, r.stderr)
    const dir = sessionDirFrom(r.stderr)
    assert.equal(path.basename(dir), sid)
    assert.equal(json(path.join(dir, 'meta.json')).backend, 'ollama')
    assert.equal(json(path.join(dir, 'meta.json')).model, MODEL)
    assert.equal(json(path.join(dir, 'status.json')).backend, 'ollama')
    const d = await stream(x, baseEnv(x, { DEEPSEEK_API_KEY: 'k' }))
    const ddir = sessionDirFrom(d.stderr)
    assert.equal(json(path.join(ddir, 'meta.json')).backend, 'deepseek')
    assert.equal(json(path.join(ddir, 'status.json')).backend, 'deepseek')
  } finally { await srv.close(); cleanup(x) }
})

// ---- AC4: wrapper preflight ---------------------------------------------------------------------

test('AC4(a): an unreachable Ollama fails the stream with exit 1, before any session dir or claude', async () => {
  const x = world()
  try {
    const r = await stream(x, baseEnv(x, { CLAUDE_DS_BACKEND: 'ollama', OLLAMA_BASE_URL: await closedPortUrl(), OL_MODEL: MODEL }))
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Ollama not reachable at http:\/\/127\.0\.0\.1:\d+ .*ollama serve.*OLLAMA_BASE_URL/)
    assert.equal(calls(x), 0)
    assert.deepEqual(sessionDirs(x), [])
  } finally { cleanup(x) }
})

test('AC4(b): a model that is not pulled fails with the pull command', async () => {
  const x = world(); const srv = await ollama({ models: ['other:1b'] })
  try {
    const r = await stream(x, olEnv(x, srv))
    assert.equal(r.status, 1)
    assert.ok(r.stderr.includes(`ollama pull ${MODEL}`), r.stderr)
    assert.equal(calls(x), 0)
    assert.deepEqual(sessionDirs(x), [])
  } finally { await srv.close(); cleanup(x) }
})

test('AC4(c): no OL_MODEL anywhere fails before asking the server', async () => {
  const x = world(); const srv = await ollama()
  try {
    const r = await stream(x, baseEnv(x, { CLAUDE_DS_BACKEND: 'ollama', OLLAMA_BASE_URL: srv.url }))
    assert.equal(r.status, 1)
    assert.match(r.stderr, /OL_MODEL is not set/)
    assert.match(r.stderr, /never pulls/)
    assert.deepEqual(srv.requests, [])
    assert.equal(calls(x), 0)
    assert.deepEqual(sessionDirs(x), [])
  } finally { await srv.close(); cleanup(x) }
})

test('preflight: a model listed as <model>:latest counts as pulled', async () => {
  const x = world(); const srv = await ollama({ models: ['tiny:latest'] })
  try {
    const r = await stream(x, olEnv(x, srv, { OL_MODEL: 'tiny' }))
    assert.equal(r.status, 0, r.stderr)
    assert.equal(envOf(x).ANTHROPIC_MODEL, 'tiny')
  } finally { await srv.close(); cleanup(x) }
})

// ---- AC5: verdict backend -------------------------------------------------------------------------

test('AC5: ollama normalizes to ol and builds a verdict', () => {
  assert.equal(normalizeBackend('ollama'), 'ol')
  assert.equal(normalizeBackend('ol'), 'ol')
  const v = buildVerdict({ statusJson: { state: 'done', backend: 'ollama' }, metaJson: { backend: 'ollama', cwd: '/tmp/x' }, changedFilesJson: { files: [] }, worktreeInfo: { sessionDir: '/tmp/s' } })
  assert.equal(v.verdict.backend, 'ol')
})

// ---- AC6 / AC18 / AC20: the runner ----------------------------------------------------------------

const runner = (x, env, args) => run('bash', [RUNNER, '--cwd', x.repo, ...args], { env, cwd: x.root })
const verdictOf = (x) => {
  const d = sessionDirs(x).map((s) => path.join(x.sessions, s)).find((s) => existsSync(path.join(s, 'verdict.json')))
  return d ? json(path.join(d, 'verdict.json')) : null
}

test('AC6: cli-dispatch-run --backend ol runs the worker on Ollama in a worktree and verifies it', async () => {
  const x = world(); const srv = await ollama({ models: ['m1'] })
  try {
    writeFileSync(path.join(x.rec, 'mode'), 'always')
    const r = await runner(x, baseEnv(x, { OLLAMA_BASE_URL: srv.url }), ['--backend', 'ol', '--prompt', 'x', '--model', 'm1', '--effort', 'high', '--verify', 'test -f done'])
    assert.equal(r.status, 0, r.stderr.slice(-1500))
    const v = verdictOf(x)
    assert.equal(v.backend, 'ol')
    assert.equal(v.verify.exitCode, 0)
    assert.match(v.branch, /^ol-run-/)
    const e = envOf(x)
    assert.equal(e.CLAUDE_DS_BACKEND, 'ollama')
    assert.equal(e.ANTHROPIC_MODEL, 'm1')
    assert.equal(e.MAX_THINKING_TOKENS, '31999')
    const z = await runner(x, baseEnv(x), ['--backend', 'zz', '--prompt', 'x'])
    assert.equal(z.status, 5)
  } finally { await srv.close(); cleanup(x) }
})

test('AC6: a failing verify is fixed by resuming the Ollama worker (--fix-attempts 1)', async () => {
  const x = world(); const srv = await ollama({ models: ['m1'] })
  try {
    const r = await runner(x, baseEnv(x, { OLLAMA_BASE_URL: srv.url }), ['--backend', 'ol', '--prompt', 'x', '--model', 'm1', '--fix-attempts', '1', '--verify', 'test -f done'])
    assert.equal(r.status, 0, r.stderr.slice(-1500))
    const v = verdictOf(x)
    assert.equal(v.fixAttempts.used, 1)
    assert.equal(calls(x), 2)
    assert.ok(argvOf(x, 1).includes('--resume'), 'the second call is the resume')
    assert.equal(envOf(x, 1).CLAUDE_DS_BACKEND, 'ollama')
    assert.equal(envOf(x, 1).ANTHROPIC_BASE_URL, srv.url)
  } finally { await srv.close(); cleanup(x) }
})

const worktrees = (x) => (spawnSync('git', ['-C', x.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout.match(/^worktree /gm) || []).length
const olBranches = (x) => spawnSync('git', ['-C', x.repo, 'branch', '--list', 'ol-run-*'], { encoding: 'utf8' }).stdout.trim()

for (const [name, setup] of [
  ['(a) unreachable', async () => ({ env: { OLLAMA_BASE_URL: await closedPortUrl(), OL_MODEL: MODEL }, line: /Ollama not reachable at /, srv: null })],
  ['(b) not pulled', async () => { const srv = await ollama({ models: ['other:1b'] }); return { env: { OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL }, line: /ollama pull qwen3\.8:27b/, srv } }],
  ['(c) no OL_MODEL', async () => { const srv = await ollama(); return { env: { OLLAMA_BASE_URL: srv.url }, line: /OL_MODEL is not set/, srv } }],
]) {
  test(`AC18${name}: the runner refuses with exit 5 before any worktree, branch, session or worker`, async () => {
    const x = world(); const s = await setup()
    try {
      const r = await runner(x, baseEnv(x, s.env), ['--backend', 'ol', '--prompt', 'x'])
      assert.equal(r.status, 5, r.stderr)
      assert.match(r.stderr, s.line)
      assert.match(r.stderr, /no worktree was created/)
      assert.equal(worktrees(x), 1)
      assert.equal(olBranches(x), '')
      assert.deepEqual(sessionDirs(x), [])
      assert.equal(calls(x), 0)
    } finally { await s.srv?.close(); cleanup(x) }
  })
}

test('AC18(d): the runner check leaks nothing into verify (CLI_DISPATCH_WORKER stays unset there)', async () => {
  const x = world(); const srv = await ollama()
  try {
    const r = await runner(x, baseEnv(x, { OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL }), ['--backend', 'ol', '--prompt', 'x', '--verify', 'printf %s "${CLI_DISPATCH_WORKER:-unset}" > w.txt'])
    assert.equal(r.status, 0, r.stderr.slice(-1500))
    const v = verdictOf(x)
    assert.equal(readFileSync(path.join(v.worktree, 'w.txt'), 'utf8'), 'unset')
  } finally { await srv.close(); cleanup(x) }
})

test('AC18(e): --resume (re-attach) makes no request to Ollama', async () => {
  const x = world(); const srv = await ollama()
  try {
    const sid = 'ol-existing'
    mkdirSync(path.join(x.sessions, sid), { recursive: true })
    writeFileSync(path.join(x.sessions, sid, 'status.json'), JSON.stringify({ state: 'done', backend: 'ollama', sessionId: sid }))
    writeFileSync(path.join(x.sessions, sid, 'meta.json'), JSON.stringify({ backend: 'ollama', cwd: x.repo, model: MODEL }))
    writeFileSync(path.join(x.sessions, sid, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
    const r = await runner(x, baseEnv(x, { OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL }), ['--backend', 'ol', '--resume', sid])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(srv.requests, [])
  } finally { await srv.close(); cleanup(x) }
})

test('AC20: a detached run with no verdict carries the reason as log: lines; one with a verdict does not', async () => {
  const x = world(); const srv = await ollama()
  try {
    const WAIT = path.join(SCRIPTS, 'cli-dispatch-wait')
    const bad = await runner(x, baseEnv(x, { OLLAMA_BASE_URL: await closedPortUrl(), OL_MODEL: MODEL }), ['--detach', '--backend', 'ol', '--prompt', 'x'])
    const id = /^run: (\S+)$/m.exec(bad.stdout)?.[1]
    assert.ok(id, bad.stdout + bad.stderr)
    const w = await run('bash', [WAIT, '--run', id, '--timeout', '120'], { env: baseEnv(x) })
    assert.equal(w.status, 5, w.stdout + w.stderr)
    assert.match(w.stdout, /^exit: 5 {2}\(no verdict\.json found\)\n(?:log: .*\n)*log: .*Ollama not reachable/m)
    writeFileSync(path.join(x.rec, 'mode'), 'always')
    const good = await runner(x, baseEnv(x, { OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL }), ['--detach', '--backend', 'ol', '--prompt', 'x', '--verify', 'test -f done'])
    const gid = /^run: (\S+)$/m.exec(good.stdout)?.[1]
    const gw = await run('bash', [WAIT, '--run', gid, '--timeout', '120'], { env: baseEnv(x) })
    assert.equal(gw.status, 0, gw.stdout + gw.stderr)
    assert.match(gw.stdout, /verify: pass/)
    assert.doesNotMatch(gw.stdout, /^log: /m)
  } finally { await srv.close(); cleanup(x) }
})

// ---- AC8: command fences ----------------------------------------------------------------------------

function runFence(name, args, { bin, env = {}, cwd }) {
  const md = readFileSync(path.join(PLUGIN, 'commands', `${name}.md`), 'utf8')
  const fence = /^```bash\n([\s\S]*?)^```/m.exec(md)[1]
  const dir = mkdtempSync(path.join(tmpdir(), 'ol-fence-'))
  try {
    const file = path.join(dir, 'block.sh')
    writeFileSync(file, fence.replace(/\$ARGUMENTS/g, args).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PLUGIN))
    return spawnSync('bash', [file], { cwd: cwd || dir, encoding: 'utf8', timeout: 30000, env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: dir, ...env } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
function stubs(names) {
  const bin = mkdtempSync(path.join(tmpdir(), 'ol-stubs-'))
  for (const s of names) {
    writeFileSync(path.join(bin, s), `#!/usr/bin/env bash\necho "STUB ${s}"\necho "CDB[\${CLAUDE_DS_BACKEND:-}]"\nfor a in "$@"; do echo "ARG[$a]"; done\n`)
    chmodSync(path.join(bin, s), 0o755)
  }
  return bin
}

test('AC8: ask ol runs ol-agent read-only with the prompt intact', () => {
  const bin = stubs(['ol-agent', 'ds-agent'])
  try {
    const r = runFence('ask', 'ol "two words"', { bin })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^STUB ol-agent$/m)
    assert.match(r.stdout, /^ARG\[--read-only\]$/m)
    assert.match(r.stdout, /^ARG\[two words\]$/m)
  } finally { rmSync(bin, { recursive: true, force: true }) }
})

test('AC8: run ol passes --backend ol to cli-dispatch-run', () => {
  const bin = stubs(['cli-dispatch-run'])
  try {
    const r = runFence('run', 'ol "x"', { bin })
    assert.match(r.stdout, /^STUB cli-dispatch-run$/m)
    assert.match(r.stdout, /^ARG\[--backend\]\nARG\[ol\]$/m)
  } finally { rmSync(bin, { recursive: true, force: true }) }
})

test('AC8: resume of an ollama session runs claude-ds-stream with CLAUDE_DS_BACKEND=ollama', () => {
  const bin = stubs(['claude-ds-stream'])
  const root = mkdtempSync(path.join(tmpdir(), 'ol-resume-'))
  try {
    mkdirSync(path.join(root, 'sess-ol'))
    writeFileSync(path.join(root, 'sess-ol', 'status.json'), JSON.stringify({ backend: 'ollama', state: 'done' }))
    const r = runFence('resume', 'sess-ol follow up please', { bin, env: { CLI_DISPATCH_SESSIONS_DIR: root } })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^STUB claude-ds-stream$/m)
    assert.match(r.stdout, /^CDB\[ollama\]$/m)
    assert.match(r.stdout, /^ARG\[--resume\]\nARG\[sess-ol\]$/m)
  } finally { rmSync(bin, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }) }
})

// ---- AC9: pre-executed scripts ------------------------------------------------------------------------

const script = (name, args, env = {}, input) => spawnSync('bash', [path.join(SCRIPTS, name), ...args], { encoding: 'utf8', timeout: 60000, input, env: { PATH: PATH_BASE, HOME: mkdtempSync(path.join(tmpdir(), 'ol-h-')), CLI_DISPATCH_CONFIG: '/dev/null', ...env } })

test('AC9: sessions ol / ollama list only ollama rows', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ol-sess-'))
  try {
    for (const [id, backend] of [['ol-one', 'ollama'], ['ds-one', 'deepseek']]) {
      mkdirSync(path.join(root, id))
      writeFileSync(path.join(root, id, 'meta.json'), JSON.stringify({ backend, startedAt: '2026-10-01T00:00:00Z' }))
      writeFileSync(path.join(root, id, 'status.json'), JSON.stringify({ backend, state: 'done' }))
    }
    for (const arg of ['ol', 'ollama']) {
      const r = script('cli-dispatch-sessions.sh', [arg], { CLI_DISPATCH_SESSIONS_DIR: root })
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /ol-one/)
      assert.doesNotMatch(r.stdout, /ds-one/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('AC9: doctor ol prints only the Ollama section, with the preflight line when unreachable', async () => {
  const bin = mkdtempSync(path.join(tmpdir(), 'ol-doc-'))
  try {
    writeFileSync(path.join(bin, 'ol-agent'), '#!/bin/sh\nexit 0\n'); chmodSync(path.join(bin, 'ol-agent'), 0o755)
    const url = await closedPortUrl()
    const r = script('cli-dispatch-doctor.sh', [PLUGIN, 'ol'], { PATH: `${bin}:${PATH_BASE}`, OLLAMA_BASE_URL: url, OL_MODEL: MODEL })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /── Ollama/)
    for (const h of ['DeepSeek', 'Antigravity', 'Codex', 'OpenCode', 'Copilot']) assert.doesNotMatch(r.stdout, new RegExp(`──[^\n]*${h}`), h)
    assert.match(r.stdout, /✗ .*not reachable/)
    assert.ok(r.stdout.includes(`OLLAMA_BASE_URL=${url}`))
  } finally { rmSync(bin, { recursive: true, force: true }) }
})

test('AC9: doctor ol reports a reachable server, the model and the resolved context', async () => {
  const srv = await ollama({ ps: { models: [{ name: MODEL, model: MODEL, context_length: 65536 }] } })
  const bin = mkdtempSync(path.join(tmpdir(), 'ol-doc-'))
  try {
    writeFileSync(path.join(bin, 'ol-agent'), '#!/bin/sh\nexit 0\n'); chmodSync(path.join(bin, 'ol-agent'), 0o755)
    const r = await run('bash', [path.join(SCRIPTS, 'cli-dispatch-doctor.sh'), PLUGIN, 'ollama'], { env: { PATH: `${bin}:${PATH_BASE}`, HOME: bin, CLI_DISPATCH_CONFIG: '/dev/null', OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL } })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /✓ Ollama reachable at .*qwen3\.8:27b listed/)
    assert.match(r.stdout, /✓ context: 65536 \(api\/ps\)/)
  } finally { await srv.close(); rmSync(bin, { recursive: true, force: true }) }
})

test('AC9: balance ol prints no balance and makes no call', () => {
  const r = script('cli-dispatch-balance.sh', ['ol'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /== Ollama ==/)
  assert.match(r.stdout, /balance: none/)
  assert.doesNotMatch(r.stdout, /== DeepSeek|== Codex/)
})

test('AC9: the statusline counts a running ollama worker of this session as ol:1', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ol-sl-'))
  try {
    mkdirSync(path.join(root, 'w1'))
    writeFileSync(path.join(root, 'w1', 'status.json'), JSON.stringify({ state: 'running', backend: 'ollama' }))
    writeFileSync(path.join(root, 'w1', 'meta.json'), JSON.stringify({ backend: 'ollama', parentSessionId: 'P-1' }))
    const r = script('cli-dispatch-statusline.sh', [], { CLI_DISPATCH_SESSIONS_DIR: root, CLI_DISPATCH_POLICY_FILE: path.join(root, 'none.json') }, '{"session_id":"P-1"}')
    assert.match(r.stdout, /ol:1/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('AC9: help keeps its box aligned and names ol and ollama', () => {
  const out = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-help.sh')], { encoding: 'utf8' }).stdout
  const lens = new Set(out.split('\n').filter((l) => l.includes('│')).map((l) => [...l].length))
  assert.equal(lens.size, 1, `box lines differ in length: ${[...lens]}`)
  assert.match(out, /\bol\b/)
  assert.match(out, /\bollama\b/)
})

// ---- AC10 / AC11: gain and policy ---------------------------------------------------------------------

test('AC10: gain attributes ol-agent to ollama and counts it as a wrapper call', () => {
  assert.equal(backendFromCommand('ol-agent -q x'), 'ollama')
  assert.ok(RUNNER_RE.test('ol-agent -q x'))
})

test('AC11: the injected policy names ol among the backends', () => {
  assert.ok(buildPolicyContext({ enabled: true }).includes('backend: <ds|ag|cx|oc|cp|ol>'))
})

// ---- AC12: setup form and the pane's config writer ----------------------------------------------------

function startForm(cfg, backends) {
  const child = spawn(process.execPath, [path.join(SCRIPTS, 'setup-form.mjs'), '--config', cfg, '--backends', backends, '--timeout', '30', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise((r) => child.on('exit', (code) => r(code)))
  const ready = new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (d) => { out += d; const m = /http:\/\/127\.0\.0\.1:(\d+)\/([A-Za-z0-9_-]{20,})\//.exec(out); if (m) resolve({ port: Number(m[1]), token: m[2] }) })
    child.on('exit', (code) => reject(new Error(`setup-form exited ${code}: ${out}`)))
  })
  return { child, exited, ready }
}
function req({ port, method = 'GET', pathname, body }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { Host: `127.0.0.1:${port}`, ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    r.on('error', reject)
    if (body !== undefined) r.write(body)
    r.end()
  })
}

test('AC12: the setup form shows the three Ollama fields as text, saves a URL and refuses a $', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ol-form-'))
  const cfg = path.join(dir, 'config')
  writeFileSync(cfg, 'OLLAMA_BASE_URL="http://127.0.0.1:11434"\nOL_MODEL=""\nOL_CONTEXT=""\n')
  const a = startForm(cfg, 'ollama')
  try {
    const { port, token } = await a.ready
    const page = await req({ port, pathname: `/${token}/` })
    for (const k of ['OLLAMA_BASE_URL', 'OL_MODEL', 'OL_CONTEXT']) assert.match(page.body, new RegExp(`<input type="text" name="${k}"`), k)
    assert.doesNotMatch(page.body, /type="password"/)
    const saved = await req({ port, method: 'POST', pathname: `/${token}/save`, body: new URLSearchParams({ OLLAMA_BASE_URL: 'http://10.0.0.5:11434', OL_MODEL: MODEL }).toString() })
    assert.equal(saved.status, 200)
    assert.equal(await a.exited, 0)
    const text = readFileSync(cfg, 'utf8')
    assert.match(text, /^OLLAMA_BASE_URL="http:\/\/10\.0\.0\.5:11434"$/m)
    assert.match(text, /^OL_MODEL="qwen3\.8:27b"$/m)
    const b = startForm(cfg, 'ollama')
    try {
      const t = await b.ready
      const bad = await req({ port: t.port, method: 'POST', pathname: `/${t.token}/save`, body: new URLSearchParams({ OL_MODEL: 'a$b' }).toString() })
      assert.equal(bad.status, 400)
      assert.equal(readFileSync(cfg, 'utf8'), text)
    } finally { b.child.kill() }
  } finally { a.child.kill(); rmSync(dir, { recursive: true, force: true }) }
})

test('AC12: the setup pane writer (config-file.mjs) sets the Ollama settings and reports them', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ol-cfgfile-'))
  try {
    const cfg = path.join(dir, 'config')
    writeFileSync(cfg, 'OLLAMA_BASE_URL="http://127.0.0.1:11434"\nOL_MODEL=""\n')
    const cf = (args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'config-file.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_CONFIG: cfg } })
    assert.equal(cf(['set', 'OLLAMA_BASE_URL', 'http://10.0.0.5:11434']).status, 0)
    assert.equal(cf(['set', 'OL_CONTEXT', '65536']).status, 0)
    assert.equal(cf(['set', 'OL_MODEL', 'a$b']).status, 3)
    const s = JSON.parse(cf(['status']).stdout)
    assert.deepEqual(s.settings, { OL_MODEL: '', OLLAMA_BASE_URL: 'http://10.0.0.5:11434', OL_CONTEXT: '65536' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---- AC13: install.sh ------------------------------------------------------------------------------------

test('AC13: install.sh --backends ollama installs ol-agent with the DeepSeek pipeline (not claude-ds), config once', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ol-inst-'))
  try {
    const inst = (backends) => spawnSync('bash', [path.join(SCRIPTS, 'install.sh'), '--backends', backends, '--non-interactive'], { encoding: 'utf8', timeout: 60000, env: { PATH: PATH_BASE, HOME: home, SHELL: '/bin/bash' } })
    const r = inst('ollama')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Done\.$/m)
    const bin = path.join(home, '.local', 'bin')
    for (const f of ['ol-agent', 'claude-ds-stream', 'ds-agent', 'stream-utils.sh']) assert.ok(existsSync(path.join(bin, f)), f)
    assert.ok(existsSync(path.join(home, '.local', 'share', 'cli-dispatch', 'ds-stream-parse.mjs')))
    assert.ok(!existsSync(path.join(bin, 'claude-ds')), 'claude-ds is DeepSeek-only')
    const cfgPath = path.join(home, '.config', 'cli-dispatch', 'config')
    const cfg = readFileSync(cfgPath, 'utf8')
    for (const l of ['OLLAMA_BASE_URL="http://127.0.0.1:11434"', 'OL_MODEL=""', 'OL_CONTEXT=""']) {
      assert.equal(cfg.split('\n').filter((x) => x === l).length, 1, l)
    }
    assert.equal(inst('ollama').status, 0)
    assert.equal(readFileSync(cfgPath, 'utf8'), cfg, 'a second run leaves the config unchanged')
    const home2 = mkdtempSync(path.join(tmpdir(), 'ol-inst-all-'))
    try {
      const all = spawnSync('bash', [path.join(SCRIPTS, 'install.sh'), '--backends', 'all', '--non-interactive'], { encoding: 'utf8', timeout: 60000, env: { PATH: PATH_BASE, HOME: home2, SHELL: '/bin/bash' } })
      assert.equal(all.status, 0, all.stdout + all.stderr)
      assert.ok(existsSync(path.join(home2, '.local', 'bin', 'ol-agent')))
    } finally { rmSync(home2, { recursive: true, force: true }) }
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('AC13: ensure_config_block appends the ollama block once (0, then 1)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ol-ecb-'))
  try {
    const fn = /# >>> ensure_config_block >>>\n([\s\S]*?)\n# <<< ensure_config_block <<</.exec(readFileSync(path.join(SCRIPTS, 'install.sh'), 'utf8'))[1]
    const sh = path.join(dir, 'ecb.sh'); writeFileSync(sh, fn + '\n')
    const cfg = path.join(dir, 'config'); writeFileSync(cfg, '# header\n')
    const call = () => spawnSync('bash', ['-c', '. "$0"; ensure_config_block "$1" ollama', sh, cfg]).status
    assert.equal(call(), 0)
    assert.equal(call(), 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---- AC14: ol-agent ----------------------------------------------------------------------------------------

test('AC14: ol-agent --read-only -q runs the worker read-only against Ollama and prints the answer', async () => {
  const x = world(); const srv = await ollama()
  try {
    const r = await run('bash', [path.join(SCRIPTS, 'ol-agent'), '--read-only', '-q', 'x'], { env: baseEnv(x, { OLLAMA_BASE_URL: srv.url, OL_MODEL: MODEL }), cwd: x.repo })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout.trim(), 'ok')
    const argv = argvOf(x)
    assert.equal(argv[argv.indexOf('--tools') + 1], 'Read,Grep,Glob')
    assert.equal(envOf(x).ANTHROPIC_BASE_URL, srv.url)
    assert.equal(envOf(x).ANTHROPIC_AUTH_TOKEN, 'ollama')
  } finally { await srv.close(); cleanup(x) }
})

test('AC14: ol-agent forwards --prompt-file, never the brief text, to the stream', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ol-pf-')))
  try {
    const bin = path.join(root, 'bin'); mkdirSync(bin)
    // ds-agent from the plugin (next to ol-agent), the stream stubbed on PATH.
    writeFileSync(path.join(bin, 'claude-ds-stream'), `#!/bin/bash\nprintf '%s\\n' "$@" > "${root}/stream.argv"\nprintf '%s' "$CLAUDE_DS_BACKEND" > "${root}/stream.backend"\n`)
    chmodSync(path.join(bin, 'claude-ds-stream'), 0o755)
    const brief = path.join(root, 'brief.txt'); writeFileSync(brief, 'SENTINEL-OL-BRIEF\n', { mode: 0o600 })
    const r = spawnSync('bash', [path.join(SCRIPTS, 'ol-agent'), '-q', '--prompt-file', brief], { cwd: root, encoding: 'utf8', env: { PATH: `${bin}:${PATH_BASE}`, HOME: root, CLI_DISPATCH_CONFIG: '/dev/null' } })
    assert.equal(r.status, 0, r.stderr)
    const argv = readFileSync(path.join(root, 'stream.argv'), 'utf8').split('\n')
    assert.equal(argv[argv.indexOf('--prompt-file') + 1], brief)
    assert.ok(!argv.join('\n').includes('SENTINEL-OL-BRIEF'))
    assert.equal(readFileSync(path.join(root, 'stream.backend'), 'utf8'), 'ollama')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ---- AC19: thinking is activity, never progress ---------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const backend of [undefined, 'ollama']) {
  // A bounded wait: a regression must fail this test, not hang the suite.
  test(`AC19: thinking moves status.json but never reaches progress.log or stdout (${backend ?? 'deepseek'})`, { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ol-think-'))
    let c
    try {
      const sd = path.join(dir, 's1')
      const env = { ...process.env, CLAUDE_DS_SESSION_DIR: sd, CLI_DISPATCH_MAX_SESSIONS: '0' }
      delete env.CLAUDE_DS_BACKEND
      if (backend) env.CLAUDE_DS_BACKEND = backend
      c = spawn(process.execPath, [path.join(SCRIPTS, 'ds-stream-parse.mjs')], { env })
      let stdout = ''
      c.stdout.on('data', (d) => { stdout += d })
      const closed = new Promise((r) => c.on('close', r))
      const status = () => json(path.join(sd, 'status.json'))
      const send = (o) => c.stdin.write(JSON.stringify(o) + '\n')
      send({ type: 'system', subtype: 'init', session_id: 's1', model: MODEL })
      await sleep(300)
      const s0 = status()
      send({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'SECRET-THINK' } } })
      await sleep(300)
      const s1 = status()
      assert.ok(s1.events > s0.events, 'a thinking delta is an event')
      assert.ok(s1.lastActivityAt > s0.lastActivityAt, 'a thinking delta moves lastActivityAt')
      send({ type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'SECRET-THINK again' }] } })
      await sleep(300)
      const s2 = status()
      assert.ok(s2.events > s1.events, 'a thinking block is an event')
      assert.ok(s2.lastActivityAt > s1.lastActivityAt)
      send({ type: 'result', subtype: 'success', result: 'final answer', session_id: 's1' })
      c.stdin.end()
      await closed
      assert.equal(status().backend, backend ?? 'deepseek')
      assert.ok(!readFileSync(path.join(sd, 'progress.log'), 'utf8').includes('SECRET-THINK'))
      assert.ok(!stdout.includes('SECRET-THINK'))
      assert.ok(stdout.includes('final answer'))
      assert.ok(readFileSync(path.join(sd, 'transcript.jsonl'), 'utf8').includes('SECRET-THINK'))
    } finally {
      if (c && c.exitCode === null) c.kill() // a failed assertion must not leave the parser holding the suite open
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

// ---- AC21 / AC22 / AC23: context window and worker env -----------------------------------------------------

const ps = (name, n) => ({ models: [{ name, model: name, context_length: n }] })
for (const [name, opts, want, src] of [
  ['(a) OL_CONTEXT beats /api/ps', { cfg: 'OL_CONTEXT="40000"\n', ps: ps(MODEL, 65536) }, 40000, 'OL_CONTEXT'],
  ['(b) /api/ps of the loaded model', { ps: ps(MODEL, 65536) }, 65536, 'api/ps'],
  ['(c) nothing loaded falls back to 32768', { ps: { models: [] } }, 32768, 'fallback'],
  ['(d) another loaded model falls back to 32768', { ps: ps('other:1b', 65536) }, 32768, 'fallback'],
]) {
  test(`AC21${name}`, async () => {
    const x = world(); const srv = await ollama({ ps: opts.ps })
    try {
      if (opts.cfg) writeFileSync(x.cfg, opts.cfg)
      const r = await stream(x, olEnv(x, srv))
      assert.equal(r.status, 0, r.stderr)
      const n = want * PCT / 100
      assert.equal(envOf(x).CLAUDE_CODE_MAX_CONTEXT_TOKENS, String(n))
      assert.ok(r.stderr.includes(`context: ${want} (${src}) → CLAUDE_CODE_MAX_CONTEXT_TOKENS=${n}`), r.stderr)
      if (src === 'OL_CONTEXT') assert.ok(!srv.requests.includes('/api/ps'), '/api/ps must not be asked')
      if (src === 'fallback') assert.match(r.stderr, /assuming 32768/)
    } finally { await srv.close(); cleanup(x) }
  })
}

test('AC21(e): a non-integer OL_CONTEXT fails before the worker', async () => {
  const x = world(); const srv = await ollama()
  try {
    writeFileSync(x.cfg, 'OL_CONTEXT="abc"\n')
    const r = await stream(x, olEnv(x, srv))
    assert.equal(r.status, 1)
    assert.match(r.stderr, /OL_CONTEXT must be a positive integer/)
    assert.equal(calls(x), 0)
  } finally { await srv.close(); cleanup(x) }
})

test('AC22: an inherited unknown-model override never reaches the worker; the reducers are exactly the five', async () => {
  const x = world(); const srv = await ollama()
  try {
    const r = await stream(x, olEnv(x, srv, { CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1' }))
    assert.equal(r.status, 0, r.stderr)
    const e = envOf(x)
    assert.equal(e.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT, undefined)
    for (const k of REDUCERS) assert.equal(e[k], '1', k)
    assert.equal(e.CLAUDE_CODE_DISABLE_CLAUDE_MDS, undefined)
    assert.equal(e.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined)
    assert.doesNotMatch(readFileSync(STREAM, 'utf8'), /DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=/)
  } finally { await srv.close(); cleanup(x) }
})

test('AC23: OL_CONTEXT_PCT is assigned exactly once, to an integer 1-100', () => {
  const m = readFileSync(STREAM, 'utf8').match(/^OL_CONTEXT_PCT=[0-9]+$/gm) || []
  assert.equal(m.length, 1)
  assert.ok(PCT >= 1 && PCT <= 100)
})
