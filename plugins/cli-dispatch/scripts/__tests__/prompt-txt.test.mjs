// prompt-txt.test.mjs — every bash stream saves the exact prompt it sent as <session-dir>/prompt.txt (0600),
// and a resume leaves the original alone. Stub CLIs record what they received; no network, no real worker.
import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PATH_BASE = (process.env.PATH || '').split(':').filter((p) => p && !p.includes('/.local/bin')).join(':')
const PROMPT = 'line one\n\n  indented "quoted" $HOME `x` ünï\nlast line, no trailing newline'

function world() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ptxt-')))
  const x = { root, bin: path.join(root, 'bin'), home: path.join(root, 'home'), sessions: path.join(root, 'sessions'), repo: path.join(root, 'repo'), got: path.join(root, 'got') }
  for (const d of [x.bin, x.home, x.repo]) mkdirSync(d, { recursive: true })
  execSync('git init -q && echo seed > seed.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed', { cwd: x.repo })
  return x
}
function stub(x, name, body) {
  writeFileSync(path.join(x.bin, name), `#!/bin/bash\n${body}\n`)
  chmodSync(path.join(x.bin, name), 0o755)
}
const env = (x, extra = {}) => ({
  PATH: `${x.bin}:${PATH_BASE}`, HOME: x.home, CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: x.sessions,
  CLI_DISPATCH_NO_GH_TOKEN: '1', CLI_DISPATCH_USERCONFIG_STATUS: path.join(x.root, 'no-ucs.json'),
  DEEPSEEK_API_KEY: 'dummy', OPENROUTER_API_KEY: 'dummy', COPILOT_GITHUB_TOKEN: 'dummy', CX_PARSER: path.join(SCRIPTS, 'cx-stream-parse.mjs'), ...extra,
})
function run(x, file, args, extra) {
  return new Promise((resolve) => {
    const c = spawn('bash', [path.join(SCRIPTS, file), ...args], { env: env(x, extra), cwd: x.root })
    let stderr = ''
    c.stderr.on('data', (d) => { stderr += d })
    const t = setTimeout(() => c.kill('SIGKILL'), 60000)
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stderr }) })
    c.stdin.end('')
  })
}
const sessionDirs = (x) => (existsSync(x.sessions) ? readdirSync(x.sessions).filter((d) => !d.startsWith('.')) : [])
const mode = (p) => statSync(p).mode & 0o777
const args = (x, ...more) => ['--cwd', x.repo, ...more, '-p', PROMPT]

// What each stub does with the prompt: stdin for ds/cx, an argv element for cp/oc/ag. All write it to x.got.
const CASES = {
  ds: { file: 'claude-ds-stream', cli: 'claude', final: null, body: (x) => `cat > "${x.got}"; echo '{"type":"result","subtype":"success","result":"ok","session_id":"s"}'` },
  cx: { file: 'cx-stream', cli: 'codex', final: 'thr-1', body: (x) => `cat > "${x.got}"; echo '{"type":"thread.started","thread_id":"thr-1"}'; echo '{"type":"turn.completed"}'` },
  cp: { file: 'cp-stream', cli: 'copilot', final: 'cp-sess-1', body: (x) => `while [ $# -gt 0 ]; do if [ "$1" = -p ]; then printf '%s' "$2" > "${x.got}"; fi; shift; done; echo '{"type":"result","sessionId":"cp-sess-1","exitCode":0}'` },
  oc: { file: 'oc-stream', cli: 'opencode', final: 'oc-sess-1', body: (x) => `printf '%s' "\${@: -1}" > "${x.got}"; echo '{"type":"step_start","sessionID":"oc-sess-1","part":{"type":"step-start"}}'` },
}

async function ollamaServer() {
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(req.url === '/api/tags' ? JSON.stringify({ models: [{ name: 'm', model: 'm' }] }) : '{"models":[]}')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()) }) }
}

function check(x, r, dir) {
  assert.equal(r.status, 0, r.stderr)
  const f = path.join(x.sessions, dir, 'prompt.txt')
  assert.ok(existsSync(f), `${f} missing; dirs: ${sessionDirs(x)}`)
  assert.equal(mode(f), 0o600)
  assert.equal(readFileSync(f, 'utf8'), readFileSync(x.got, 'utf8'), 'prompt.txt differs from what the worker received')
  assert.equal(readFileSync(f, 'utf8'), PROMPT)
}

for (const [be, c] of Object.entries(CASES)) {
  test(`${be}-stream: prompt.txt is the prompt the worker received, 0600, in the final dir`, async () => {
    const x = world()
    try {
      stub(x, c.cli, c.body(x))
      const r = await run(x, c.file, args(x))
      const dirs = sessionDirs(x)
      assert.equal(dirs.length, 1, dirs.join())
      if (c.final) assert.equal(dirs[0], c.final)
      check(x, r, dirs[0])
    } finally { rmSync(x.root, { recursive: true, force: true }) }
  })
}

test('ol (ds pipeline on Ollama): prompt.txt is the prompt the worker received, 0600', async () => {
  const x = world()
  const srv = await ollamaServer()
  try {
    stub(x, 'claude', CASES.ds.body(x))
    const r = await run(x, 'claude-ds-stream', args(x), { CLAUDE_DS_BACKEND: 'ollama', OL_MODEL: 'm', OLLAMA_BASE_URL: srv.url })
    check(x, r, sessionDirs(x)[0])
  } finally { await srv.close(); rmSync(x.root, { recursive: true, force: true }) }
})

test('ag-stream: prompt.txt is the prompt the worker received, 0600', async () => {
  const x = world()
  try {
    const logs = path.join(x.home, '.gemini', 'antigravity-cli', 'brain', 'conv-1', '.system_generated', 'logs')
    stub(x, 'agy', `if [ "$1" = models ]; then exit 0; fi
if [ "$2" = ping ]; then echo ok; exit 0; fi
while [ $# -gt 0 ]; do if [ "$1" = -p ]; then printf '%s' "$2" > "${x.got}"; fi; shift; done
mkdir -p "${logs}"
node -e 'process.stdout.write(JSON.stringify({ type: "USER_INPUT", content: require("fs").readFileSync(process.argv[1], "utf8") }) + "\\n")' "${x.got}" > "${logs}/transcript_full.jsonl"
sleep 1`)
    const r = await run(x, 'ag-stream', args(x))
    check(x, r, 'conv-1')
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

for (const be of ['ds', 'cx']) {
  test(`${be}-stream --resume leaves an existing prompt.txt unchanged`, async () => {
    const x = world()
    try {
      const c = CASES[be]
      const id = c.final || 'sid-1'
      mkdirSync(path.join(x.sessions, id), { recursive: true })
      writeFileSync(path.join(x.sessions, id, 'prompt.txt'), 'ORIGINAL')
      stub(x, c.cli, c.body(x))
      const r = await run(x, c.file, args(x, '--resume', id))
      assert.equal(r.status, 0, r.stderr)
      assert.equal(readFileSync(path.join(x.sessions, id, 'prompt.txt'), 'utf8'), 'ORIGINAL')
    } finally { rmSync(x.root, { recursive: true, force: true }) }
  })
}
