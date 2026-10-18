// The DeepSeek key reaches `claude` through its environment only. `env VAR=key claude` would put
// the key in env(1)'s argv, readable by `ps` until exec, so neither launcher may use env(1) for it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(HERE, '..')
const KEY = 'sk-deepseek-argv-canary-0123456789'

// A stub claude that records its argv and the token it was given, and a stub env(1) that records
// the argv it was launched with before handing over to the real one.
function setup() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ds-argv-')))
  const bin = path.join(root, 'bin')
  for (const d of [bin, path.join(root, 'home'), path.join(root, 'sessions')]) mkdirSync(d)
  writeFileSync(path.join(bin, 'claude'), `#!/bin/bash
printf '%s\\n' "$@" > "${root}/claude-argv"
printf '%s' "$ANTHROPIC_AUTH_TOKEN" > "${root}/claude-token"
echo '{"type":"result","subtype":"success","result":"ok","session_id":"s"}'
`)
  writeFileSync(path.join(bin, 'env'), `#!/bin/bash
printf '%s\\n' "$@" >> "${root}/env-argv"
exec /usr/bin/env "$@"
`)
  chmodSync(path.join(bin, 'claude'), 0o755)
  chmodSync(path.join(bin, 'env'), 0o755)
  return { root, bin }
}

function run(x, script, args) {
  return spawnSync('bash', [path.join(SCRIPTS, script), ...args], {
    cwd: x.root, encoding: 'utf8', timeout: 60000,
    env: { PATH: `${x.bin}:${process.env.PATH}`, HOME: path.join(x.root, 'home'), DEEPSEEK_API_KEY: KEY,
      CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: path.join(x.root, 'sessions') },
  })
}
const read = (x, f) => { try { return readFileSync(path.join(x.root, f), 'utf8') } catch { return '' } }

for (const [script, args] of [['claude-ds', ['-p', 'x']], ['claude-ds-stream', ['-p', 'x']]]) {
  test(`${script}: the key is in claude's environment, and in no argv`, () => {
    const x = setup()
    try {
      const r = run(x, script, args)
      assert.equal(read(x, 'claude-token'), KEY, `claude did not get the token; stderr: ${r.stderr}`)
      assert.ok(!read(x, 'claude-argv').includes(KEY), "the key is in claude's argv")
      assert.ok(!read(x, 'env-argv').includes(KEY), "the key was passed through env(1)'s argv")
    } finally { rmSync(x.root, { recursive: true, force: true }) }
  })

  test(`${script}: static gate, ANTHROPIC_AUTH_TOKEN is only ever exported`, () => {
    const text = readFileSync(path.join(SCRIPTS, script), 'utf8')
    for (const l of text.split('\n')) {
      if (l.includes('ANTHROPIC_AUTH_TOKEN=')) assert.match(l, /^\s*export ANTHROPIC_AUTH_TOKEN=/, l)
    }
    assert.doesNotMatch(text, /\benv\s*\\\n(?:[^\n]*\\\n)*[^\n]*AUTH_TOKEN=/)
  })
}

// 7.1.0: the Ollama branch of claude-ds-stream (CLAUDE_DS_BACKEND=ollama) exports its token the
// same way. The fixture Ollama answers only while the event loop runs, so this one spawns async.
test('claude-ds-stream (ollama): the token is in claude\'s environment, and no AUTH_TOKEN rides on env(1)', async () => {
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const x = setup()
  const srv = createServer((req, res) => res.end(JSON.stringify({ models: [{ name: 'm', model: 'm' }] })))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const status = await new Promise((resolve) => {
      const c = spawn('bash', [path.join(SCRIPTS, 'claude-ds-stream'), '-p', 'x'], {
        cwd: x.root,
        env: { PATH: `${x.bin}:${process.env.PATH}`, HOME: path.join(x.root, 'home'), CLAUDE_DS_BACKEND: 'ollama',
          OLLAMA_BASE_URL: `http://127.0.0.1:${srv.address().port}`, OL_MODEL: 'm', CLI_DISPATCH_NO_GH_TOKEN: '1',
          CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: path.join(x.root, 'sessions') },
      })
      c.on('close', resolve)
      c.stdin.end()
    })
    assert.equal(status, 0)
    assert.equal(read(x, 'claude-token'), 'ollama')
    assert.ok(!read(x, 'env-argv').includes('AUTH_TOKEN'), 'the token was passed through env(1)\'s argv')
  } finally { srv.closeAllConnections?.(); srv.close(); rmSync(x.root, { recursive: true, force: true }) }
})
