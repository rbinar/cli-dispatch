// worker-questions.test.mjs — worker questions and messages (7.3.0;
// .specs/dev/sdd/worker-questions.md §8, AC1-AC13 and AC18-AC21, AC23).
// The MCP server is driven as a real client over stdio; the streams and the runner run with stub CLIs.
// Every run gets a temp HOME and a PATH without ~/.local/bin, so an installed, stale copy of a script
// is never the code under test. (AC14 and AC22 are in tests/mod.test.ts; AC15-AC17 are shell gates.)
import assert from 'node:assert/strict'
import { execSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { effectiveCeiling } from '../cli-dispatch-ask.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(HERE, '..')
const ASK = path.join(SCRIPTS, 'cli-dispatch-ask.mjs')
const PATH_BASE = (process.env.PATH || '').split(':').filter((p) => p && !p.includes('/.local/bin')).join(':')
const BASE_REF = '7b30dea' // 7.2.0: what "unchanged without the env" is measured against
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const mkdtemp = (p) => realpathSync(mkdtempSync(path.join(tmpdir(), p)))
const rmrf = (p) => rmSync(p, { recursive: true, force: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) return v
    await sleep(25)
  }
}
const mode = (p) => statSync(p).mode & 0o777

// ---- the MCP client ---------------------------------------------------------------------------

function askRoot() {
  const root = mkdtemp('wq-')
  const dir = path.join(root, '.ask', 'run-abc123')
  mkdirSync(dir, { recursive: true })
  return { root, dir }
}

function startServer({ args = [], env = {} } = {}) {
  const proc = spawn('node', [ASK, ...args], { env: { PATH: PATH_BASE, HOME: tmpdir(), ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const responses = []
  const waiters = new Map()
  let buf = ''
  let exited = null
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      responses.push(msg)
      waiters.get(msg.id)?.(msg)
    }
  })
  const done = new Promise((r) => proc.on('exit', (code) => { exited = code; r(code) }))
  let n = 0
  const write = (obj) => proc.stdin.write(`${JSON.stringify(obj)}\n`)
  const c = {
    proc, responses, done, exit: () => exited,
    request(method, params = {}) {
      const id = ++n
      const p = new Promise((r) => waiters.set(id, r))
      write({ jsonrpc: '2.0', id, method, params })
      return Object.assign(p, { id })
    },
    notify: (method, params = {}) => write({ jsonrpc: '2.0', method, params }),
    call: (name, args = {}) => c.request('tools/call', { name, arguments: args }),
    text: async (p) => (await p).result.content[0].text,
    close: async () => { proc.stdin.end(); await Promise.race([done, sleep(3000)]); proc.kill('SIGKILL') },
  }
  return c
}
const init = (c) => c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } })
const qFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.q.json'))
const logLines = (dir) => (existsSync(path.join(dir, 'log.jsonl')) ? readFileSync(path.join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const helper = (sub, args, stdin) => spawnSync('node', [ASK, sub, ...args], { input: stdin, encoding: 'utf8', env: { PATH: PATH_BASE, HOME: tmpdir() } })
const qidOf = (f) => f.replace('.q.json', '')

// ---- AC1: the round trip ------------------------------------------------------------------------

test('AC1: initialize, tools/list, and an ask_user round trip', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    const ini = await init(c)
    assert.ok(ini.result)
    const list = await c.request('tools/list')
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['ask_user', 'check_messages'])
    assert.deepEqual(list.result.tools.find((t) => t.name === 'ask_user').inputSchema.required, ['question'])

    const call = c.call('ask_user', { question: 'Q?', options: ['a', 'b'] })
    const files = await waitFor(() => (qFiles(dir).length === 1 ? qFiles(dir) : null), 2000)
    assert.ok(files, 'one q file within 2 s')
    const qfile = path.join(dir, files[0])
    assert.match(qidOf(files[0]), UUID)
    assert.equal(mode(qfile), 0o600)
    const q = JSON.parse(readFileSync(qfile, 'utf8'))
    assert.equal(q.v, 1)
    assert.equal(q.id, qidOf(files[0]))
    assert.equal(q.question, 'Q?')
    assert.deepEqual(q.options, ['a', 'b'])
    assert.ok(Date.parse(q.askedAt))
    assert.equal(q.pid, c.proc.pid)

    const a = helper('answer', [dir, q.id], JSON.stringify({ v: 1, answer: 'ANSWER-ZQ' }))
    assert.equal(a.status, 0, a.stderr)
    assert.equal(await c.text(call), 'The user answered: ANSWER-ZQ')
    assert.deepEqual(readdirSync(dir).filter((f) => /\.(q|a)\.json$/.test(f)), [])
    const lines = logLines(dir)
    assert.equal(lines.length, 1)
    assert.equal(lines[0].outcome, 'answered')
    assert.ok(!readFileSync(path.join(dir, 'log.jsonl'), 'utf8').includes('ANSWER-ZQ'), 'the answer text is never logged')
  } finally { await c.close(); rmrf(root) }
})

test('AC1: question and options are bounded before they are written', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    c.call('ask_user', { question: 'x'.repeat(5000), options: ['1', 2, 'o'.repeat(300), '3', '4', '5'] })
    const files = await waitFor(() => (qFiles(dir).length === 1 ? qFiles(dir) : null), 2000)
    const q = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8'))
    assert.equal(q.question.length, 2000)
    assert.equal(q.options.length, 4)
    assert.equal(q.options[1].length, 100)
  } finally { await c.close(); rmrf(root) }
})

// ---- AC2: retries and cancel --------------------------------------------------------------------

test('AC2: two concurrent calls get two files and the right answers, whatever the order', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    const p1 = c.call('ask_user', { question: 'one?' })
    const p2 = c.call('ask_user', { question: 'two?' })
    const files = await waitFor(() => (qFiles(dir).length === 2 ? qFiles(dir) : null), 2000)
    assert.ok(files, 'two distinct q files')
    const byQuestion = Object.fromEntries(files.map((f) => [JSON.parse(readFileSync(path.join(dir, f), 'utf8')).question, qidOf(f)]))
    assert.equal(helper('answer', [dir, byQuestion['two?']], '{"v":1,"answer":"B"}').status, 0)
    assert.equal(await c.text(p2), 'The user answered: B')
    assert.equal(helper('answer', [dir, byQuestion['one?']], '{"v":1,"answer":"A"}').status, 0)
    assert.equal(await c.text(p1), 'The user answered: A')
  } finally { await c.close(); rmrf(root) }
})

test('AC2: notifications/cancelled removes the q file, sends no response, logs cancelled; the other call completes', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    const p1 = c.call('ask_user', { question: 'one?' })
    await waitFor(() => qFiles(dir).length === 1)
    const first = qFiles(dir)[0]
    const p2 = c.call('ask_user', { question: 'two?' })
    await waitFor(() => qFiles(dir).length === 2)
    c.notify('notifications/cancelled', { requestId: p1.id })
    assert.ok(await waitFor(() => !existsSync(path.join(dir, first)), 1000), 'its q file is removed within 1 s')
    await sleep(1200)
    assert.ok(!c.responses.some((r) => r.id === p1.id), 'no response ever arrives for the cancelled id')
    assert.ok(logLines(dir).some((l) => l.outcome === 'cancelled'))
    const second = qFiles(dir)[0]
    helper('answer', [dir, qidOf(second)], '{"v":1,"answer":"ok"}')
    assert.equal(await c.text(p2), 'The user answered: ok')
  } finally { await c.close(); rmrf(root) }
})

// ---- AC3: the ceiling ---------------------------------------------------------------------------

test('AC3: the ceiling ends the call with the do-not-guess text and logs timeout', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir], env: { CLI_DISPATCH_ASK_CEILING_S: '1' } })
  try {
    await init(c)
    const started = Date.now()
    const text = await c.text(c.call('ask_user', { question: 'Q?' }))
    assert.ok(Date.now() - started < 3000)
    assert.match(text, /No answer \(timed out/)
    assert.match(text, /Do not guess/)
    assert.deepEqual(qFiles(dir), [])
    assert.equal(logLines(dir)[0].outcome, 'timeout')
  } finally { await c.close(); rmrf(root) }
})

test('AC3: the ceiling can be lowered by the env, never raised past 300 s', () => {
  assert.equal(effectiveCeiling('900'), 300)
  assert.equal(effectiveCeiling('1'), 1)
  assert.equal(effectiveCeiling('x'), 300)
  assert.equal(effectiveCeiling(undefined), 300)
  assert.equal(effectiveCeiling('0'), 300)
})

// ---- AC4: no dir, skipped, EOF ------------------------------------------------------------------

test('AC4: no ask dir (no arg and no env, or a missing path) answers at once and creates nothing', async () => {
  const root = mkdtemp('wq-nodir-')
  const missing = path.join(root, '.ask', 'run-gone')
  for (const opts of [{}, { args: [missing] }, { env: { CLI_DISPATCH_ASK_DIR: missing } }]) {
    const c = startServer(opts)
    try {
      await init(c)
      const started = Date.now()
      const text = await c.text(c.call('ask_user', { question: 'Q?' }))
      assert.match(text, /Questions are not available in this run/)
      assert.ok(Date.now() - started < 1500)
      assert.ok(!existsSync(missing), 'the server never creates the dir')
    } finally { await c.close() }
  }
  rmrf(root)
})

test('AC4: a skipped answer tells the worker to assume; the log says skipped', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    const p = c.call('ask_user', { question: 'Q?' })
    const files = await waitFor(() => (qFiles(dir).length === 1 ? qFiles(dir) : null), 2000)
    assert.equal(helper('answer', [dir, qidOf(files[0])], '{"v":1,"skipped":true}').status, 0)
    const text = await c.text(p)
    assert.match(text, /closed the question without answering/)
    assert.match(text, /best assumption/)
    assert.equal(logLines(dir)[0].outcome, 'skipped')
  } finally { await c.close(); rmrf(root) }
})

test('AC4: stdin EOF with a pending call removes its q file and exits 0', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    c.call('ask_user', { question: 'Q?' })
    await waitFor(() => qFiles(dir).length === 1)
    c.proc.stdin.end()
    assert.equal(await Promise.race([c.done, sleep(3000).then(() => 'hung')]), 0)
    assert.deepEqual(qFiles(dir), [])
  } finally { await c.close(); rmrf(root) }
})

// ---- AC5: the answer helper ---------------------------------------------------------------------

test('AC5: the answer helper reads stdin only and refuses bad names and dirs', () => {
  const { root, dir } = askRoot()
  try {
    const qid = '11111111-1111-1111-1111-111111111111'
    assert.equal(helper('answer', [dir, '../x'], '{"v":1,"answer":"a"}').status, 2)
    const wrongParent = path.join(root, 'plain')
    mkdirSync(wrongParent)
    assert.equal(helper('answer', [wrongParent, qid], '{"v":1,"answer":"a"}').status, 2)
    assert.equal(helper('answer', [dir, qid], '{"v":1}').status, 2, 'neither an answer nor a skip')
    assert.equal(helper('answer', [dir, qid], '{"v":1,"answer":"a"}').status, 3, 'no such question')
    assert.ok(!existsSync(path.join(dir, `${qid}.a.json`)))
    writeFileSync(path.join(dir, `${qid}.q.json`), '{}')
    const secret = 'ANSWER-NOT-ON-ARGV'
    const r = spawnSync('node', [ASK, 'answer', dir, qid], { input: JSON.stringify({ v: 1, answer: secret }), encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(mode(path.join(dir, `${qid}.a.json`)), 0o600)
    assert.equal(JSON.parse(readFileSync(path.join(dir, `${qid}.a.json`), 'utf8')).answer, secret)
  } finally { rmrf(root) }
})

// ---- AC6: the wiring shapes ---------------------------------------------------------------------

const cfg = (backend, dir, env = {}) => spawnSync('node', [ASK, 'config', backend, dir], { encoding: 'utf8', env: { PATH: PATH_BASE, ...env } })

test('AC6: config shapes per backend', () => {
  const dir = '/tmp/some dir/.ask/run-a"b'
  for (const be of ['ds', 'ol']) {
    const s = JSON.parse(cfg(be, dir).stdout).mcpServers.cli_dispatch_ask
    assert.ok(path.isAbsolute(s.command))
    assert.deepEqual(s.args, [ASK, dir])
  }
  const lines = cfg('cx', dir).stdout.trimEnd().split('\n')
  assert.equal(lines.length, 4)
  for (const l of lines) assert.match(l, /^mcp_servers\.cli_dispatch_ask\./)
  assert.ok(lines.includes('mcp_servers.cli_dispatch_ask.default_tools_approval_mode="approve"'))
  assert.ok(lines.includes('mcp_servers.cli_dispatch_ask.tool_timeout_sec=600'))
  assert.equal(JSON.parse(lines.find((l) => l.includes('.args=')).split('.args=')[1])[1], dir, 'a quote and a space survive the TOML line')
  assert.equal(JSON.parse(lines.find((l) => l.includes('.command=')).split('.command=')[1]), process.execPath)
  assert.equal(JSON.parse(cfg('cp', dir).stdout).mcpServers.cli_dispatch_ask.timeout, 600000)
  const oc = JSON.parse(cfg('oc', dir).stdout).mcp.cli_dispatch_ask
  assert.equal(oc.timeout, 600000)
  assert.ok(Array.isArray(oc.command) && oc.command.at(-1) === dir)
  const merged = JSON.parse(cfg('oc', dir, { OPENCODE_CONFIG_CONTENT: '{"model":"m","mcp":{"other":{}}}' }).stdout)
  assert.equal(merged.model, 'm')
  assert.ok(merged.mcp.other && merged.mcp.cli_dispatch_ask)
  const bad = cfg('oc', dir, { OPENCODE_CONFIG_CONTENT: '{nope' })
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /not a JSON object/)
})

// ---- the stub world for the streams and the runner ------------------------------------------------

function world() {
  const root = mkdtemp('wq-w-')
  const x = { root, bin: path.join(root, 'bin'), home: path.join(root, 'home'), sessions: path.join(root, 'sessions'), repo: path.join(root, 'repo'), rec: path.join(root, 'rec'), ask: path.join(root, 'ask', '.ask', 'run-test1') }
  for (const d of [x.bin, x.home, x.repo, x.rec, x.ask]) mkdirSync(d, { recursive: true })
  execSync('git init -q && echo seed > seed.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed', { cwd: x.repo })
  return x
}
// A stub CLI: dumps argv and env into rec/<name>.argv|env, then runs `body`.
function stub(x, name, body = '') {
  writeFileSync(path.join(x.bin, name), `#!/bin/bash
printf '%s\\n' "$@" > "${x.rec}/${name}.argv"
env > "${x.rec}/${name}.env"
${body}
`)
  chmodSync(path.join(x.bin, name), 0o755)
}
const argvOf = (x, name) => readFileSync(path.join(x.rec, `${name}.argv`), 'utf8').split('\n').slice(0, -1)
const envOf = (x, name) => {
  const e = {}
  for (const l of readFileSync(path.join(x.rec, `${name}.env`), 'utf8').split('\n')) {
    const i = l.indexOf('=')
    if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(l.slice(0, i))) e[l.slice(0, i)] = l.slice(i + 1)
  }
  return e
}
const baseEnv = (x, extra = {}) => ({
  PATH: `${x.bin}:${PATH_BASE}`, HOME: x.home, CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: x.sessions,
  CLI_DISPATCH_NO_GH_TOKEN: '1', CLI_DISPATCH_USERCONFIG_STATUS: path.join(x.root, 'no-ucs.json'),
  DEEPSEEK_API_KEY: 'dummy', OPENROUTER_API_KEY: 'dummy', COPILOT_GITHUB_TOKEN: 'dummy', CX_PARSER: path.join(SCRIPTS, 'cx-stream-parse.mjs'), ...extra,
})
function run(cmd, args, { env, cwd, input = '', timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env, cwd })
    let stdout = '', stderr = ''
    c.stdout.on('data', (d) => { stdout += d })
    c.stderr.on('data', (d) => { stderr += d })
    const t = setTimeout(() => c.kill('SIGKILL'), timeout)
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }) })
    c.stdin.end(input)
  })
}
const sessionDirs = (x) => (existsSync(x.sessions) ? readdirSync(x.sessions).filter((d) => !d.startsWith('.')) : [])

// Each stream with the stub CLI it needs and the final event that lets it finish and relocate.
const STREAMS = {
  ds: { file: 'claude-ds-stream', cli: 'claude', body: `cat >/dev/null; echo '{"type":"result","subtype":"success","result":"ok","session_id":"s"}'` },
  cx: { file: 'cx-stream', cli: 'codex', body: `cat >/dev/null; echo '{"type":"thread.started","thread_id":"thr-1"}'; echo '{"type":"turn.completed"}'` },
  cp: { file: 'cp-stream', cli: 'copilot', body: `echo '{"type":"result","sessionId":"cp-sess-1","exitCode":0}'` },
  oc: { file: 'oc-stream', cli: 'opencode', body: `echo '{"type":"step_start","sessionID":"oc-sess-1","part":{"type":"step-start"}}'` },
}
const streamArgs = (x) => ['--cwd', x.repo, '-p', 'x']
const runStream = (x, be, env = {}, args = streamArgs(x), scriptsDir = SCRIPTS) => {
  stub(x, STREAMS[be].cli, STREAMS[be].body)
  return run('bash', [path.join(scriptsDir, STREAMS[be].file), ...args], { env: baseEnv(x, env), cwd: x.root })
}

// ---- AC7: the streams wire the server only when told to --------------------------------------------

test('AC7: claude-ds-stream wires --mcp-config and the tool timeout; --read-only keeps zero MCP', async () => {
  const x = world()
  try {
    const r = await runStream(x, 'ds', { CLI_DISPATCH_ASK_DIR: x.ask })
    assert.equal(r.status, 0, r.stderr)
    const argv = argvOf(x, 'claude')
    const cfgArg = argv[argv.indexOf('--mcp-config') + 1]
    assert.ok(cfgArg.includes('cli_dispatch_ask'))
    assert.deepEqual(JSON.parse(cfgArg).mcpServers.cli_dispatch_ask.args, [path.join(SCRIPTS, 'cli-dispatch-ask.mjs'), x.ask])
    assert.equal(envOf(x, 'claude').MCP_TOOL_TIMEOUT, '600000')
    assert.ok(argv.includes('--strict-mcp-config'))
  } finally { rmrf(x.root) }
  const y = world()
  try {
    const r = await runStream(y, 'ds', { CLI_DISPATCH_ASK_DIR: y.ask }, ['--cwd', y.repo, '--read-only', '-p', 'x'])
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!argvOf(y, 'claude').join('\n').includes('cli_dispatch_ask'))
    assert.equal(envOf(y, 'claude').MCP_TOOL_TIMEOUT, undefined)
    assert.ok(!existsSync(path.join(y.sessions, ...sessionDirs(y).slice(0, 1), 'ask-dir')), 'no ask-dir link under --read-only')
  } finally { rmrf(y.root) }
})

test('AC7: ol (the same stream against Ollama) wires the same way', async () => {
  const x = world()
  const http = await import('node:http')
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(req.url === '/api/tags' ? JSON.stringify({ models: [{ name: 'm1', model: 'm1' }] }) : JSON.stringify({ models: [] }))
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const r = await runStream(x, 'ds', { CLI_DISPATCH_ASK_DIR: x.ask, CLAUDE_DS_BACKEND: 'ollama', OLLAMA_BASE_URL: `http://127.0.0.1:${srv.address().port}`, OL_MODEL: 'm1' })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(argvOf(x, 'claude').join('\n').includes('cli_dispatch_ask'))
    assert.equal(envOf(x, 'claude').MCP_TOOL_TIMEOUT, '600000')
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); rmrf(x.root) }
})

test('AC7: cx-stream passes the four -c pairs on a fresh run and on --resume', async () => {
  const want = (argv) => {
    const cs = argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : [])).filter((a) => a.startsWith('mcp_servers.cli_dispatch_ask.'))
    assert.equal(cs.length, 4, argv.join(' '))
    assert.ok(cs.includes('mcp_servers.cli_dispatch_ask.default_tools_approval_mode="approve"'))
    assert.ok(cs.includes('mcp_servers.cli_dispatch_ask.tool_timeout_sec=600'))
  }
  const x = world()
  try {
    const r = await runStream(x, 'cx', { CLI_DISPATCH_ASK_DIR: x.ask })
    assert.equal(r.status, 0, r.stderr)
    want(argvOf(x, 'codex'))
    assert.ok(argvOf(x, 'codex').includes('-s'), 'the fresh list')
  } finally { rmrf(x.root) }
  const y = world()
  try {
    mkdirSync(path.join(y.sessions, 'thr-9'), { recursive: true })
    const r = await runStream(y, 'cx', { CLI_DISPATCH_ASK_DIR: y.ask }, ['--cwd', y.repo, '--resume', 'thr-9', '-p', 'x'])
    assert.equal(r.status, 0, r.stderr)
    want(argvOf(y, 'codex'))
    assert.ok(argvOf(y, 'codex').includes('resume'), 'the resume list')
  } finally { rmrf(y.root) }
})

test('AC7: cp-stream gets --additional-mcp-config and oc-stream gets OPENCODE_CONFIG_CONTENT', async () => {
  const x = world()
  try {
    const r = await runStream(x, 'cp', { CLI_DISPATCH_ASK_DIR: x.ask })
    assert.equal(r.status, 0, r.stderr)
    const argv = argvOf(x, 'copilot')
    assert.ok(JSON.parse(argv[argv.indexOf('--additional-mcp-config') + 1]).mcpServers.cli_dispatch_ask)
  } finally { rmrf(x.root) }
  const y = world()
  try {
    const r = await runStream(y, 'oc', { CLI_DISPATCH_ASK_DIR: y.ask })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(JSON.parse(envOf(y, 'opencode').OPENCODE_CONFIG_CONTENT).mcp.cli_dispatch_ask)
  } finally { rmrf(y.root) }
})

test('AC7: without CLI_DISPATCH_ASK_DIR every stream is identical to the 7.2.0 stream', async () => {
  const base = mkdtemp('wq-base-')
  const tar = spawnSync('bash', ['-c', `git archive ${BASE_REF} plugins/cli-dispatch/scripts | tar -x -C "${base}"`], { cwd: path.join(SCRIPTS, '..', '..', '..'), encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)
  const baseScripts = path.join(base, 'plugins', 'cli-dispatch', 'scripts')
  const norm = (a) => a.map((l) => l.replace(/XXXXXX\.\w+/g, 'XXXXXX').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'))
  try {
    for (const be of ['ds', 'cx', 'cp', 'oc']) {
      const now = world(), old = world()
      try {
        // The same absolute cwd for both, so argv carries no difference of its own.
        const rn = await runStream(now, be, {}, ['--cwd', now.repo, '-p', 'x'])
        const ro = await runStream(old, be, {}, ['--cwd', old.repo, '-p', 'x'], baseScripts)
        assert.equal(rn.status, ro.status, `${be}: ${rn.stderr}\n${ro.stderr}`)
        const cli = STREAMS[be].cli
        assert.deepEqual(norm(argvOf(now, cli)).map((l) => l.replaceAll(now.root, '<root>')), norm(argvOf(old, cli)).map((l) => l.replaceAll(old.root, '<root>')), be)
        for (const k of ['MCP_TOOL_TIMEOUT', 'OPENCODE_CONFIG_CONTENT', 'CLI_DISPATCH_ASK_DIR']) assert.equal(envOf(now, cli)[k], undefined, `${be} ${k}`)
        assert.ok(!sessionDirs(now).some((d) => existsSync(path.join(now.sessions, d, 'ask-dir'))), `${be}: no ask-dir`)
      } finally { rmrf(now.root); rmrf(old.root) }
    }
  } finally { rmrf(base) }
})

// ---- AC8 / AC9 / AC23: the runner ---------------------------------------------------------------------

function runnerWorld({ stubBody = '' } = {}) {
  const x = world()
  for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
    writeFileSync(path.join(x.bin, f), readFileSync(path.join(SCRIPTS, f)))
    chmodSync(path.join(x.bin, f), 0o755)
  }
  const sid = 'ds-q-session'
  // The worker runner: records what the worker would see, then makes a finished session.
  writeFileSync(path.join(x.bin, 'ds-worktree-run.sh'), `#!/usr/bin/env bash
REPO="$1"; PROMPT_FILE="$3"
S="${x.sessions}/${sid}"
mkdir -p "$S"
printf '%s\\n' "\${CLI_DISPATCH_ASK_DIR-UNSET}" > "${x.rec}/ask-dir-env"
if [ -n "\${CLI_DISPATCH_ASK_DIR:-}" ]; then ls -ld "$CLI_DISPATCH_ASK_DIR" > "${x.rec}/ask-dir-ls"; cp "$CLI_DISPATCH_ASK_DIR/context.json" "${x.rec}/context.json"; fi
cp "$PROMPT_FILE" "${x.rec}/prompt"
${stubBody}
printf '{"state":"done","sessionId":"${sid}","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "claude-ds session: ${sid}" >&2
exit 0
`)
  chmodSync(path.join(x.bin, 'ds-worktree-run.sh'), 0o755)
  writeFileSync(path.join(x.bin, 'claude-ds-stream'), `#!/usr/bin/env bash
printf '%s\\n' "\${CLI_DISPATCH_ASK_DIR-UNSET}" >> "${x.rec}/resume-ask-dir"
: > fixed.txt
`)
  chmodSync(path.join(x.bin, 'claude-ds-stream'), 0o755)
  const env = { ...baseEnv(x), CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1' }
  delete env.DEEPSEEK_API_KEY
  return { x, sid, env, read: (n) => (existsSync(path.join(x.rec, n)) ? readFileSync(path.join(x.rec, n), 'utf8') : '') }
}
const runner = (w, extra = [], env = {}, backend = 'ds') =>
  run('bash', [path.join(w.x.bin, 'cli-dispatch-run'), '--backend', backend, '--cwd', w.x.repo, '--prompt', 'do it', ...extra], { env: { ...w.env, ...env } })
const askRootsLeft = (w) => (existsSync(path.join(w.x.sessions, '.ask')) ? readdirSync(path.join(w.x.sessions, '.ask')) : [])

test('AC8a: with CLI_DISPATCH_ASK=1 the runner makes a private ask dir, context.json and the brief block, and removes it after', async () => {
  const w = runnerWorld()
  try {
    const r = await runner(w, [], { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' })
    assert.equal(r.status, 0, r.stderr)
    const dir = w.read('ask-dir-env').trim()
    assert.match(dir, new RegExp(`^${w.x.sessions}/\\.ask/run-[A-Za-z0-9]+$`))
    assert.match(w.read('ask-dir-ls'), /^drwx------/)
    assert.deepEqual(JSON.parse(w.read('context.json')), { v: 1, parentSessionId: 'S', backend: 'ds', repo: w.x.repo })
    const prompt = w.read('prompt')
    assert.ok(prompt.includes('[cli-dispatch] Questions and messages:'))
    assert.ok(prompt.includes('use ONLY the ask_user tool'))
    assert.ok(prompt.includes('call check_messages'))
    assert.ok(!existsSync(dir), 'removed after the run')
  } finally { rmrf(w.x.root) }
})

test('AC8b: a --fix-attempts resume sees the same ask dir', async () => {
  const w = runnerWorld()
  try {
    const r = await runner(w, ['--fix-attempts', '1', '--verify', 'test -f fixed.txt'], { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' })
    assert.equal(r.status, 0, r.stderr.slice(-400))
    assert.equal(w.read('resume-ask-dir').trim(), w.read('ask-dir-env').trim())
    assert.notEqual(w.read('resume-ask-dir').trim(), 'UNSET')
  } finally { rmrf(w.x.root) }
})

const OFF = [
  ['AC8c: no CLI_DISPATCH_ASK', {}],
  ['AC8d: CLI_DISPATCH_NO_ASK=1 beside CLI_DISPATCH_ASK=1', { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S', CLI_DISPATCH_NO_ASK: '1' }],
  ['AC8e: no CLAUDE_CODE_SESSION_ID', { CLI_DISPATCH_ASK: '1' }],
  ['AC8c: an inherited CLI_DISPATCH_ASK_DIR is dropped', { CLI_DISPATCH_ASK_DIR: '/tmp/inherited' }],
]
for (const [name, env] of OFF) {
  test(`${name}: no dir, no env var, no block, no ask-dir link (AC23)`, async () => {
    const w = runnerWorld()
    try {
      const r = await runner(w, [], { CLAUDE_CODE_SESSION_ID: '', ...env })
      assert.equal(r.status, 0, r.stderr)
      assert.equal(w.read('ask-dir-env').trim(), 'UNSET')
      assert.ok(!w.read('prompt').includes('Questions and messages'))
      assert.deepEqual(askRootsLeft(w), [])
      assert.ok(!sessionDirs(w.x).some((d) => existsSync(path.join(w.x.sessions, d, 'ask-dir'))))
    } finally { rmrf(w.x.root) }
  })
}

test('AC8f: ag without the global MCP entry is off, with a stderr note (AC23)', async () => {
  const w = runnerWorld()
  try {
    mkdirSync(path.join(w.x.home, '.gemini', 'config'), { recursive: true })
    writeFileSync(path.join(w.x.home, '.gemini', 'config', 'mcp_config.json'), '{"mcpServers":{}}')
    writeFileSync(path.join(w.x.bin, 'ag-worktree-run.sh'), `#!/usr/bin/env bash
printf '%s\\n' "\${CLI_DISPATCH_ASK_DIR-UNSET}" > "${w.x.rec}/ask-dir-env"
cp "$3" "${w.x.rec}/prompt"
S="${w.x.sessions}/ag-s"; mkdir -p "$S"
printf '{"state":"done","sessionId":"ag-s","backend":"antigravity"}' > "$S/status.json"
printf '{"backend":"antigravity","cwd":"%s"}' "$1" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "  conv:   ag-s" >&2
`)
    chmodSync(path.join(w.x.bin, 'ag-worktree-run.sh'), 0o755)
    const r = await runner(w, [], { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' }, 'ag')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(w.read('ask-dir-env').trim(), 'UNSET')
    assert.ok(!w.read('prompt').includes('Questions and messages'))
    assert.match(r.stderr, /questions are off for ag/)
    assert.deepEqual(askRootsLeft(w), [])
  } finally { rmrf(w.x.root) }
})

test('AC8g: SIGTERM mid-run removes the ask dir', async () => {
  const w = runnerWorld({ stubBody: `: > "$CLI_DISPATCH_ASK_DIR/.started"; sleep 60` })
  try {
    const c = spawn('bash', [path.join(w.x.bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', w.x.repo, '--prompt', 'x'], { env: { ...w.env, CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' } })
    const closed = new Promise((r) => c.on('close', r))
    const dir = await waitFor(() => (existsSync(path.join(w.x.sessions, '.ask')) ? readdirSync(path.join(w.x.sessions, '.ask')).map((d) => path.join(w.x.sessions, '.ask', d)).find((d) => existsSync(path.join(d, '.started'))) : null), 15000)
    assert.ok(dir, 'the dir existed while the worker ran')
    c.kill('SIGTERM')
    await Promise.race([closed, sleep(20000)])
    assert.ok(!existsSync(dir), 'the dir is gone after SIGTERM')
  } finally { rmrf(w.x.root) }
})

// ---- AC9: verdict and summary -----------------------------------------------------------------------

const logLinesStub = (lines) => lines.map((l) => `printf '%s\\n' '${JSON.stringify(l)}' >> "$CLI_DISPATCH_ASK_DIR/log.jsonl"`).join('\n')
const summaryOf = (w) => {
  const v = path.join(w.x.sessions, w.sid, 'verdict.json')
  const s = spawnSync('bash', [path.join(w.x.bin, 'cli-dispatch-run-summary.sh'), v, '0'], { encoding: 'utf8' })
  return { verdict: JSON.parse(readFileSync(v, 'utf8')), summary: s.stdout }
}
const entry = (question, outcome) => ({ id: 'i', question, askedAt: 'a', endedAt: 'b', outcome })

test('AC9: log.jsonl becomes verdict.questions and one summary line; exitCode is unchanged', async () => {
  const w = runnerWorld({ stubBody: logLinesStub([entry('Which colour?', 'answered'), entry('Which port?', 'timeout')]) })
  const plain = runnerWorld()
  try {
    const r = await runner(w, [], { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' })
    const p = await runner(plain)
    assert.equal(r.status, 0, r.stderr)
    const { verdict, summary } = summaryOf(w)
    assert.deepEqual(verdict.questions, { asked: 2, unanswered: ['Which port?'] })
    assert.equal(verdict.exitCode, summaryOf(plain).verdict.exitCode)
    assert.equal(p.status, r.status)
    assert.ok(summary.includes('questions: 2 asked, 1 unanswered — "Which port?"'), summary)
    assert.ok(summary.includes('/cli-dispatch:resume'))
  } finally { rmrf(w.x.root); rmrf(plain.x.root) }
})

test('AC9: only answered or skipped lines read "all answered"; no log means no questions key and no line', async () => {
  const w = runnerWorld({ stubBody: logLinesStub([entry('A?', 'answered'), entry('B?', 'skipped')]) })
  const none = runnerWorld()
  try {
    await runner(w, [], { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' })
    const a = summaryOf(w)
    assert.deepEqual(a.verdict.questions, { asked: 2, unanswered: [] })
    assert.ok(a.summary.includes('questions: 2 asked, all answered'))
    await runner(none, [], { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' })
    const b = summaryOf(none)
    assert.ok(!('questions' in b.verdict))
    assert.ok(!b.summary.includes('questions:'))
  } finally { rmrf(w.x.root); rmrf(none.x.root) }
})

// ---- AC10: the idle watchdog treats a pending question as activity ------------------------------------

async function idleRun(be, withQuestion) {
  const x = world()
  try {
    if (withQuestion) writeFileSync(path.join(x.ask, '11111111-1111-1111-1111-111111111111.q.json'), '{}')
    const first = be === 'ds'
      ? `echo '{"type":"result","subtype":"success","result":"ok","session_id":"s"}'`
      : `echo '{"type":"thread.started","thread_id":"thr-1"}'`
    stub(x, STREAMS[be].cli, `cat >/dev/null; ${first}; sleep 8; touch "${x.root}/finished"`)
    const idleEnv = be === 'ds' ? { CLAUDE_DS_IDLE_TIMEOUT: '3' } : { CX_IDLE_TIMEOUT: '3' }
    const r = await run('bash', [path.join(SCRIPTS, STREAMS[be].file), ...streamArgs(x)], { env: baseEnv(x, { CLI_DISPATCH_ASK_DIR: x.ask, ...idleEnv }), cwd: x.root })
    const statuses = sessionDirs(x).map((d) => { try { return readFileSync(path.join(x.sessions, d, 'status.json'), 'utf8') } catch { return '' } }).join('\n')
    const out = r.stdout + r.stderr + statuses
    return { killed: /idle 3s/.test(out), finished: existsSync(path.join(x.root, 'finished')), out }
  } finally { rmrf(x.root) }
}
for (const be of ['ds', 'cx']) {
  test(`AC10: ${be}-stream: a pending question keeps the idle watchdog off; without one it fires`, async () => {
    const pending = await idleRun(be, true)
    assert.equal(pending.killed, false, pending.out)
    if (be === 'cx') assert.equal(pending.finished, true)
    const quiet = await idleRun(be, false)
    assert.equal(quiet.killed, true, quiet.out)
    if (be === 'cx') assert.equal(quiet.finished, false)
  })
}

// ---- AC11 / AC21 (ag): the print-timeout and the ask-dir link ------------------------------------------

async function agRun(env) {
  const x = world()
  const brain = path.join(x.home, '.gemini', 'antigravity-cli', 'brain', 'conv-1', '.system_generated', 'logs')
  stub(x, 'agy', `if [ "$1" = models ]; then exit 0; fi
if [ "$2" = ping ]; then echo ok; exit 0; fi
mkdir -p "${brain}"
printf '%s\\n' '{"type":"USER_INPUT","content":"x"}' > "${brain}/transcript_full.jsonl"
cp "${x.rec}/agy.argv" "${x.rec}/launch.argv"
sleep 1`)
  const r = await run('bash', [path.join(SCRIPTS, 'ag-stream'), ...streamArgs(x)], { env: baseEnv(x, env), cwd: x.root })
  return { x, r, launchArgv: existsSync(path.join(x.rec, 'launch.argv')) ? readFileSync(path.join(x.rec, 'launch.argv'), 'utf8').split('\n') : [] }
}
const printTimeout = (argv) => argv[argv.indexOf('--print-timeout') + 1]

test('AC11: ag print-timeout grows by one question ceiling only for the implicit cap', async () => {
  for (const [env, want] of [
    [{ CLI_DISPATCH_ASK_DIR: 'ASK' }, '900s'],
    [{}, '600s'],
    [{ AG_MAX_RUNTIME: '100', CLI_DISPATCH_ASK_DIR: 'ASK' }, '100s'],
    [{ AG_MAX_RUNTIME: '100' }, '100s'],
  ]) {
    const x0 = world()
    const e = env.CLI_DISPATCH_ASK_DIR ? { ...env, CLI_DISPATCH_ASK_DIR: x0.ask } : env
    const { x, r, launchArgv } = await agRun(e)
    try {
      assert.equal(printTimeout(launchArgv), want, r.stderr)
    } finally { rmrf(x.root); rmrf(x0.root) }
  }
})

test('AC21: ag leaves <session-dir>/ask-dir with exactly the dir and a newline, mode 0600', async () => {
  const x0 = world()
  const { x, r } = await agRun({ CLI_DISPATCH_ASK_DIR: x0.ask })
  try {
    const link = path.join(x.sessions, 'conv-1', 'ask-dir')
    assert.ok(existsSync(link), r.stderr)
    assert.equal(readFileSync(link, 'utf8'), `${x0.ask}\n`)
    assert.equal(mode(link), 0o600)
  } finally { rmrf(x.root); rmrf(x0.root) }
})

// ---- AC21: the ask-dir link for the other streams ---------------------------------------------------------

for (const be of ['ds', 'cx', 'cp', 'oc']) {
  test(`AC21: ${be}-stream leaves <session-dir>/ask-dir, 0600, and none without the variable`, async () => {
    const x = world()
    try {
      const r = await runStream(x, be, { CLI_DISPATCH_ASK_DIR: x.ask })
      assert.equal(r.status, 0, r.stderr)
      const dirs = sessionDirs(x)
      assert.equal(dirs.length, 1, dirs.join())
      if (be === 'cx') assert.equal(dirs[0], 'thr-1', 'the link moved with the relocated dir')
      const link = path.join(x.sessions, dirs[0], 'ask-dir')
      assert.equal(readFileSync(link, 'utf8'), `${x.ask}\n`)
      assert.equal(mode(link), 0o600)
    } finally { rmrf(x.root) }
    const y = world()
    try {
      await runStream(y, be, {})
      assert.ok(!sessionDirs(y).some((d) => existsSync(path.join(y.sessions, d, 'ask-dir'))))
    } finally { rmrf(y.root) }
  })
}

// ---- AC12: install ---------------------------------------------------------------------------------------------

const INSTALL = path.join(SCRIPTS, 'install.sh')
function install(home, args) {
  return spawnSync('bash', [INSTALL, ...args], { encoding: 'utf8', env: { PATH: `${home}/.local/bin:${PATH_BASE}`, HOME: home } })
}

test('AC12: install.sh installs the server (0644) and exits 0; antigravity alone never touches agy config', () => {
  const home = mkdtemp('wq-inst-')
  try {
    const r = install(home, ['--backends', 'codex', '--non-interactive'])
    assert.equal(r.status, 0, r.stdout.slice(-400) + r.stderr.slice(-400))
    const f = path.join(home, '.local', 'share', 'cli-dispatch', 'cli-dispatch-ask.mjs')
    assert.ok(existsSync(f))
    assert.equal(mode(f), 0o644)
    assert.equal(install(home, ['--backends', 'antigravity', '--non-interactive']).status, 0)
    assert.ok(!existsSync(path.join(home, '.gemini', 'config', 'mcp_config.json')), 'an absent file stays absent')
    mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true })
    const cfgPath = path.join(home, '.gemini', 'config', 'mcp_config.json')
    const before = '{"mcpServers":{"other":{"command":"x"}}}'
    writeFileSync(cfgPath, before)
    install(home, ['--backends', 'antigravity', '--non-interactive'])
    assert.equal(readFileSync(cfgPath, 'utf8'), before, 'an existing file is byte-identical')
  } finally { rmrf(home) }
})

test('AC12: --ag-ask-mcp merges one entry, keeps the rest and the mode, is idempotent, and refuses broken JSON', () => {
  const home = mkdtemp('wq-inst-')
  try {
    mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true })
    const cfgPath = path.join(home, '.gemini', 'config', 'mcp_config.json')
    writeFileSync(cfgPath, '{"mcpServers":{"other":{"command":"x"}},"keep":1}')
    chmodSync(cfgPath, 0o640)
    const r = install(home, ['--backends', 'antigravity', '--non-interactive', '--ag-ask-mcp'])
    assert.equal(r.status, 0, r.stdout.slice(-400) + r.stderr.slice(-400))
    const got = JSON.parse(readFileSync(cfgPath, 'utf8'))
    assert.deepEqual(got.mcpServers.other, { command: 'x' })
    assert.equal(got.keep, 1)
    const e = got.mcpServers.cli_dispatch_ask
    assert.equal(e.timeoutSeconds, 600)
    assert.ok(path.isAbsolute(e.command))
    assert.equal(e.args.length, 1, 'no dir arg: the run dir comes from the env')
    assert.equal(mode(cfgPath), 0o640)
    const once = readFileSync(cfgPath)
    install(home, ['--backends', 'antigravity', '--non-interactive', '--ag-ask-mcp'])
    assert.ok(readFileSync(cfgPath).equals(once), 'a second run leaves the bytes identical')
    writeFileSync(cfgPath, '{not json')
    const bad = install(home, ['--backends', 'antigravity', '--non-interactive', '--ag-ask-mcp'])
    assert.equal(bad.status, 0)
    assert.match(bad.stdout, /WARNING/)
    assert.equal(readFileSync(cfgPath, 'utf8'), '{not json')
  } finally { rmrf(home) }
})

test('AC12: --ag-ask-mcp fills the empty mcp_config.json a fresh agy install leaves', () => {
  const home = mkdtemp('wq-inst-')
  try {
    mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true })
    const cfgPath = path.join(home, '.gemini', 'config', 'mcp_config.json')
    writeFileSync(cfgPath, '')
    const r = install(home, ['--backends', 'antigravity', '--non-interactive', '--ag-ask-mcp'])
    assert.equal(r.status, 0, r.stdout.slice(-400) + r.stderr.slice(-400))
    assert.doesNotMatch(r.stdout, /not valid JSON/)
    assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).mcpServers.cli_dispatch_ask.timeoutSeconds, 600)
  } finally { rmrf(home) }
})

// ---- AC13: the setup consent step ------------------------------------------------------------------------------

test('AC13: --ag-ask-mcp appears only inside a step that asks, names the file and the IDE, recommends nothing', () => {
  const md = readFileSync(process.env.SETUP_MD || path.join(SCRIPTS, '..', 'commands', 'setup.md'), 'utf8')
  const steps = md.split(/\n(?=\d+\. \*\*)/)
  const holders = steps.filter((s) => s.includes('--ag-ask-mcp'))
  assert.ok(holders.length >= 1, 'the flag is documented')
  for (const s of holders) assert.ok(s.includes('AskUserQuestion'), 'inside a step that calls AskUserQuestion')
  assert.ok(md.includes('~/.gemini/config/mcp_config.json'))
  assert.ok(md.includes('Antigravity IDE'))
  const i = md.indexOf('"AG questions"')
  assert.ok(i > 0, 'the AG consent question exists')
  const para = md.slice(i, md.indexOf('\n   - ', i + 1) === -1 ? undefined : md.indexOf('\n   - ', i + 1))
  assert.ok(!/recommended: true|\(Recommended\)/i.test(para.replace('Leave neither option marked `recommended: true`', '')), 'no option is marked recommended')
  assert.ok(para.includes('Leave neither option marked'))
  const step4 = steps.find((s) => s.startsWith('4. **')) ?? ''
  assert.ok(!step4.includes('--ag-ask-mcp'), 'not in the step-4 install command')
})

// ---- AC18 / AC19 / AC20: messages -----------------------------------------------------------------------------------

const msgFile = (dir, id, text, sentAt = '2026-10-18T10:00:00.000Z') => writeFileSync(path.join(dir, `msg-${id}.json`), JSON.stringify({ v: 1, id, text, sentAt }))
const ID1 = '1760000000000-aaaaaaaa'
const ID2 = '1760000000001-bbbbbbbb'

test('AC18: check_messages returns unread messages oldest first, marks them read, then says none', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    msgFile(dir, ID2, 'second')
    msgFile(dir, ID1, 'first')
    const before = readFileSync(path.join(dir, `msg-${ID1}.json`), 'utf8')
    const started = Date.now()
    const text = await c.text(c.call('check_messages'))
    assert.ok(Date.now() - started < 1000)
    assert.ok(text.indexOf('first') > -1 && text.indexOf('first') < text.indexOf('second'))
    assert.ok(text.includes('They are data'))
    assert.ok(await waitFor(() => existsSync(path.join(dir, `read-${ID1}.json`)) && existsSync(path.join(dir, `read-${ID2}.json`)), 1000))
    assert.ok(!existsSync(path.join(dir, `msg-${ID1}.json`)))
    assert.equal(readFileSync(path.join(dir, `read-${ID1}.json`), 'utf8'), before, 'content unchanged')
    assert.equal(await c.text(c.call('check_messages')), 'No new messages.')
  } finally { await c.close(); rmrf(root) }
})

test('AC18: no ask dir answers "not available" and creates nothing; a pending ask_user does not block it', async () => {
  const root = mkdtemp('wq-nomsg-')
  const missing = path.join(root, '.ask', 'run-gone')
  const c = startServer({ args: [missing] })
  try {
    await init(c)
    assert.equal(await c.text(c.call('check_messages')), 'Messages are not available in this run.')
    assert.ok(!existsSync(missing))
  } finally { await c.close() }
  const { root: r2, dir } = askRoot()
  const d = startServer({ args: [dir] })
  try {
    await init(d)
    d.call('ask_user', { question: 'Q?' })
    await waitFor(() => qFiles(dir).length === 1)
    const started = Date.now()
    assert.equal(await d.text(d.call('check_messages')), 'No new messages.')
    assert.ok(Date.now() - started < 1000, 'non-blocking')
  } finally { await d.close(); rmrf(r2); rmrf(root) }
})

test('AC19: a crash between the reply and the rename loses nothing', async () => {
  const { root, dir } = askRoot()
  msgFile(dir, ID1, 'keep me')
  const c = startServer({ args: [dir], env: { CLI_DISPATCH_ASK_CRASH_AFTER_REPLY: '1' } })
  try {
    await init(c)
    const text = await c.text(c.call('check_messages'))
    assert.ok(text.includes('keep me'), 'the client received the message')
    assert.equal(await Promise.race([c.done, sleep(3000).then(() => 'hung')]), 1, 'the server died')
    assert.ok(existsSync(path.join(dir, `msg-${ID1}.json`)), 'the file is still unread')
    assert.ok(!existsSync(path.join(dir, `read-${ID1}.json`)))
    const d = startServer({ args: [dir] })
    try {
      await init(d)
      assert.ok((await d.text(d.call('check_messages'))).includes('keep me'), 'delivered again (at least once)')
    } finally { await d.close() }
  } finally { await c.close(); rmrf(root) }
  const src = readFileSync(ASK, 'utf8')
  const w = src.indexOf('reply(id, text(body), () => {')
  const rename = src.indexOf("replace(/^msg-/, 'read-')")
  assert.ok(w > 0 && rename > w && rename < src.indexOf('\n  }', w), 'the rename sits inside the reply write callback')
})

test('AC20: the message helper stores a private file, cuts long text, and refuses bad input', () => {
  const { root, dir } = askRoot()
  try {
    const ok = helper('message', [dir], JSON.stringify({ v: 1, text: 'hi' }))
    assert.equal(ok.status, 0, ok.stderr)
    const id = ok.stdout.trim()
    assert.match(id, /^\d{13}-[0-9a-f]{8}$/)
    const f = path.join(dir, `msg-${id}.json`)
    assert.equal(mode(f), 0o600)
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).text, 'hi')
    const long = helper('message', [dir], JSON.stringify({ v: 1, text: 'y'.repeat(5000) }))
    assert.equal(JSON.parse(readFileSync(path.join(dir, `msg-${long.stdout.trim()}.json`), 'utf8')).text.length, 2000)
    for (const text of ['', '   \n']) assert.equal(helper('message', [dir], JSON.stringify({ v: 1, text })).status, 2)
    const plain = path.join(root, 'plain')
    mkdirSync(plain)
    assert.equal(helper('message', [plain], JSON.stringify({ v: 1, text: 'x' })).status, 2)
    assert.deepEqual(readdirSync(plain), [])
    const gone = path.join(root, '.ask', 'run-gone')
    assert.equal(helper('message', [gone], JSON.stringify({ v: 1, text: 'x' })).status, 3)
    assert.ok(!existsSync(gone))
    const secret = 'MESSAGE-NOT-ON-ARGV'
    const r = spawnSync('node', [ASK, 'message', dir], { input: JSON.stringify({ v: 1, text: secret }), encoding: 'utf8' })
    assert.equal(r.status, 0)
  } finally { rmrf(root) }
})

// ---- (rev.2, 7.5.0) AC24 / AC25: the audience of a question ---------------------------------------

test('AC24: ask_user takes to: "orchestrator"; the q file carries it only for that exact value', async () => {
  const { root, dir } = askRoot()
  const c = startServer({ args: [dir] })
  try {
    await init(c)
    const list = await c.request('tools/list')
    const tool = list.result.tools.find((t) => t.name === 'ask_user')
    assert.deepEqual(tool.inputSchema.properties.to.enum, ['user', 'orchestrator'])
    assert.deepEqual(tool.inputSchema.required, ['question'])
    const asked = []
    for (const to of ['orchestrator', undefined, 'x']) {
      const before = qFiles(dir)
      const call = c.call('ask_user', { question: 'Q?', ...(to ? { to } : {}) })
      const f = await waitFor(() => qFiles(dir).find((n) => !before.includes(n)), 2000)
      assert.ok(f, `q file for to=${to}`)
      const q = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
      asked.push({ to, q, call })
    }
    assert.equal(asked[0].q.to, 'orchestrator')
    assert.ok(!('to' in asked[1].q))
    assert.ok(!('to' in asked[2].q), 'an unknown to is not written')
    // by: "orchestrator" changes the reply and is stored; anything else reads as the user.
    const ans = (a, payload) => {
      const r = helper('answer', [dir, a.q.id], JSON.stringify(payload))
      assert.equal(r.status, 0, r.stderr)
      return JSON.parse(readFileSync(path.join(dir, `${a.q.id}.a.json`), 'utf8'))
    }
    const a0 = ans(asked[0], { v: 1, answer: '8123', by: 'orchestrator' })
    assert.equal(a0.by, 'orchestrator')
    assert.equal(await c.text(asked[0].call), 'The orchestrator answered: 8123')
    const a1 = ans(asked[1], { v: 1, answer: '8123', by: 'user' })
    assert.ok(!('by' in a1))
    assert.equal(await c.text(asked[1].call), 'The user answered: 8123')
    const a2 = ans(asked[2], { v: 1, answer: '8123' })
    assert.ok(!('by' in a2))
    assert.equal(await c.text(asked[2].call), 'The user answered: 8123')
    const logText = readFileSync(path.join(dir, 'log.jsonl'), 'utf8')
    assert.ok(!logText.includes('8123') && !logText.includes('"by"'), 'log.jsonl has neither the answer nor by')
  } finally { await c.close(); rmrf(root) }
})

test('AC25: a detached run writes runId into context.json and the brief names to: "orchestrator"; a plain run writes none', async () => {
  const env = { CLI_DISPATCH_ASK: '1', CLAUDE_CODE_SESSION_ID: 'S' }
  const w = runnerWorld()
  try {
    const r = await runner(w, ['--detach'], env)
    assert.equal(r.status, 0, r.stderr)
    const id = /^run: (\S+)$/m.exec(r.stdout)?.[1]
    assert.ok(id, r.stdout)
    const wr = await run('bash', [path.join(w.x.bin, 'cli-dispatch-wait'), '--run', id, '--timeout', '60'], { env: w.env })
    assert.equal(wr.status, 0, wr.stdout + wr.stderr)
    assert.equal(JSON.parse(w.read('context.json')).runId, id)
    const prompt = w.read('prompt')
    assert.ok(prompt.includes('to: "orchestrator"'))
    assert.ok(prompt.includes('use ONLY the ask_user tool'))
    assert.ok(prompt.includes('call check_messages'))
  } finally { rmrf(w.x.root) }
  const p = runnerWorld()
  try {
    const r = await runner(p, [], env)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!('runId' in JSON.parse(p.read('context.json'))))
  } finally { rmrf(p.x.root) }
})
