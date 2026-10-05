// setup-form.mjs replaces "open the config in Notepad/TextEdit" with a one-shot local web form.
// It writes API keys into a file that every *-stream SOURCES as bash, on a port any local process
// can reach — so these tests pin the security contract as much as the happy path: a request
// without the per-run token, or with a foreign Host header, never reads or writes anything, and
// a value that could execute when sourced is refused without touching the file.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FORM = path.join(HERE, '..', 'setup-form.mjs')

const CONFIG = [
  '# cli-dispatch config — DO NOT COMMIT.',
  '',
  '# --- DeepSeek backend (claude-ds) --- add your DeepSeek API key below.',
  'DEEPSEEK_API_KEY="sk-existing-ds"',
  'DS_MODEL="deepseek-v4-pro"',
  'DS_FLASH_MODEL="deepseek-v4-flash"',
  '',
  '# --- OpenCode backend --- OPTIONAL.',
  'OPENROUTER_API_KEY=""',
  'OC_MODEL=""',
  'OC_MODELS=""',
  '',
].join('\n')

// Starts the form against a fresh config; resolves once it prints its URL.
function start({ backends = 'deepseek,opencode', timeout = 30, config = CONFIG } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'setup-form-'))
  const cfg = path.join(dir, 'config')
  writeFileSync(cfg, config, { mode: 0o644 })
  const child = spawn(process.execPath, [FORM, '--config', cfg, '--backends', backends, '--timeout', String(timeout), '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  const ready = new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/([A-Za-z0-9_-]{20,})\//)
      if (m) resolve({ port: Number(m[1]), token: m[2], url: m[0] })
    })
    child.on('exit', (code) => reject(new Error(`setup-form exited ${code} before printing a URL: ${out}`)))
  })
  return { dir, cfg, child, exited, ready, cleanup: () => { child.kill(); rmSync(dir, { recursive: true, force: true }) } }
}

function request({ port, method = 'GET', pathname, host, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: pathname,
      headers: {
        Host: host ?? `127.0.0.1:${port}`,
        ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const form = (fields) => new URLSearchParams(fields).toString()

test('prints a loopback URL carrying a random token and serves the form there', async () => {
  const s = start()
  try {
    const { port, token } = await s.ready
    const res = await request({ port, pathname: `/${token}/` })
    assert.equal(res.status, 200)
    for (const key of ['DEEPSEEK_API_KEY', 'DS_MODEL', 'OPENROUTER_API_KEY', 'OC_MODEL']) {
      assert.match(res.body, new RegExp(`name="${key}"`), `form must have a ${key} field`)
    }
    // Secrets are never echoed back, not even the existing one.
    assert.doesNotMatch(res.body, /sk-existing-ds/)
    // Non-secret values are prefilled so the user sees what is configured.
    assert.match(res.body, /deepseek-v4-pro/)
    // Only the selected backends are offered.
    assert.doesNotMatch(res.body, /name="CODEX_API_KEY"/)
  } finally { s.cleanup() }
})

test('a request without the right token reads and writes nothing', async () => {
  const s = start()
  try {
    const { port, token } = await s.ready
    for (const pathname of ['/', '/nope/', `/${token.slice(0, -1)}x/`]) {
      const res = await request({ port, pathname })
      assert.equal(res.status, 403, `GET ${pathname}`)
    }
    const res = await request({ port, method: 'POST', pathname: '/nope/save', body: form({ DS_MODEL: 'evil' }) })
    assert.equal(res.status, 403)
    assert.equal(readFileSync(s.cfg, 'utf8'), CONFIG)
  } finally { s.cleanup() }
})

test('a foreign Host header is refused even with the token (DNS rebinding)', async () => {
  const s = start()
  try {
    const { port, token } = await s.ready
    const get = await request({ port, pathname: `/${token}/`, host: `evil.example:${port}` })
    assert.equal(get.status, 403)
    const post = await request({ port, method: 'POST', pathname: `/${token}/save`, host: `evil.example:${port}`, body: form({ DS_MODEL: 'evil' }) })
    assert.equal(post.status, 403)
    assert.equal(readFileSync(s.cfg, 'utf8'), CONFIG)
  } finally { s.cleanup() }
})

test('saving updates only the submitted lines, keeps everything else byte-identical, sets 0600, and exits 0', async () => {
  const s = start()
  try {
    const { port, token } = await s.ready
    const res = await request({
      port, method: 'POST', pathname: `/${token}/save`,
      body: form({ DEEPSEEK_API_KEY: 'sk-new-ds', DS_MODEL: 'deepseek-v4-flash', OPENROUTER_API_KEY: 'sk-or-1', OC_MODEL: 'openai/gpt-5' }),
    })
    assert.equal(res.status, 200)
    assert.doesNotMatch(res.body, /sk-new-ds|sk-or-1/, 'the response must not echo secrets')
    assert.equal(await s.exited, 0)
    const want = CONFIG
      .replace('DEEPSEEK_API_KEY="sk-existing-ds"', 'DEEPSEEK_API_KEY="sk-new-ds"')
      .replace('DS_MODEL="deepseek-v4-pro"', 'DS_MODEL="deepseek-v4-flash"')
      .replace('OPENROUTER_API_KEY=""', 'OPENROUTER_API_KEY="sk-or-1"')
      .replace('OC_MODEL=""', 'OC_MODEL="openai/gpt-5"')
    assert.equal(readFileSync(s.cfg, 'utf8'), want)
    if (process.platform !== 'win32') assert.equal(statSync(s.cfg).mode & 0o777, 0o600)
  } finally { s.cleanup() }
})

test('an empty secret field leaves the stored key alone', async () => {
  const s = start()
  try {
    const { port, token } = await s.ready
    const res = await request({ port, method: 'POST', pathname: `/${token}/save`, body: form({ DEEPSEEK_API_KEY: '', DS_MODEL: 'deepseek-v4-pro' }) })
    assert.equal(res.status, 200)
    assert.equal(await s.exited, 0)
    assert.match(readFileSync(s.cfg, 'utf8'), /^DEEPSEEK_API_KEY="sk-existing-ds"$/m)
  } finally { s.cleanup() }
})

test('a value that would execute when the config is sourced is refused and nothing is written', async () => {
  const s = start()
  try {
    const { port, token } = await s.ready
    const marker = path.join(s.dir, 'pwned')
    for (const evil of [`$(touch ${marker})`, '`id`', 'a"; touch x; "', 'back\\slash', 'line\nNEXT=1']) {
      const res = await request({ port, method: 'POST', pathname: `/${token}/save`, body: form({ DEEPSEEK_API_KEY: evil }) })
      assert.equal(res.status, 400, `must refuse ${JSON.stringify(evil)}`)
    }
    assert.equal(readFileSync(s.cfg, 'utf8'), CONFIG)
    assert.equal(existsSync(marker), false)
    // The server stays up after a refused save so the user can correct the field.
    const again = await request({ port, pathname: `/${token}/` })
    assert.equal(again.status, 200)
  } finally { s.cleanup() }
})

test('fields for keys that are not in the config are appended, unknown field names are ignored', async () => {
  const s = start({ backends: 'deepseek', config: '# header\nDEEPSEEK_API_KEY=""\n' })
  try {
    const { port, token } = await s.ready
    const res = await request({ port, method: 'POST', pathname: `/${token}/save`, body: form({ DEEPSEEK_API_KEY: 'sk-x', DS_MODEL: 'deepseek-v4-pro', PATH: '/evil', BASH_ENV: '/evil' }) })
    assert.equal(res.status, 200)
    assert.equal(await s.exited, 0)
    const out = readFileSync(s.cfg, 'utf8')
    assert.match(out, /^DEEPSEEK_API_KEY="sk-x"$/m)
    assert.match(out, /^DS_MODEL="deepseek-v4-pro"$/m)
    assert.doesNotMatch(out, /PATH=|BASH_ENV=/)
  } finally { s.cleanup() }
})

test('exits 2 when nobody saves before the timeout, leaving the config untouched', async () => {
  const s = start({ timeout: 1 })
  try {
    await s.ready
    assert.equal(await s.exited, 2)
    assert.equal(readFileSync(s.cfg, 'utf8'), CONFIG)
  } finally { s.cleanup() }
})

test('non-printable-ASCII values (U+2028, NUL, NBSP) are refused — JS line anchors treat U+2028 as a newline, bash does not', async () => {
  // Security review probe: `DEEPSEEK_API_KEY=a<U+2028>DS_MODEL=` let a later DS_MODEL update match
  // INSIDE the first value's line, unbalancing the quotes so a later `;touch …;#` value ran when
  // the config was sourced. NUL made macOS bash 3.2 drop the whole file.
  const s = start()
  try {
    const { port, token } = await s.ready
    for (const evil of ['a DS_MODEL=', 'a b', 'a\u0000b', 'a b', 'tab\there']) {
      const res = await request({ port, method: 'POST', pathname: `/${token}/save`, body: form({ DEEPSEEK_API_KEY: evil, DS_MODEL: 'q', OC_MODEL: ';touch PWNED;#' }) })
      assert.equal(res.status, 400, `must refuse ${JSON.stringify(evil)}`)
    }
    assert.equal(readFileSync(s.cfg, 'utf8'), CONFIG)
  } finally { s.cleanup() }
})

test('a key assigned twice is rewritten everywhere, so the value bash ends up with is the new one', async () => {
  const s = start({ backends: 'deepseek', config: 'DEEPSEEK_API_KEY="old1"\n# again\nDEEPSEEK_API_KEY="old2"\n' })
  try {
    const { port, token } = await s.ready
    const res = await request({ port, method: 'POST', pathname: `/${token}/save`, body: form({ DEEPSEEK_API_KEY: 'sk-new' }) })
    assert.equal(res.status, 200)
    assert.equal(await s.exited, 0)
    assert.equal(readFileSync(s.cfg, 'utf8'), 'DEEPSEEK_API_KEY="sk-new"\n# again\nDEEPSEEK_API_KEY="sk-new"\n')
  } finally { s.cleanup() }
})

test('a symlinked config is written through the link, not replaced by a regular file', { skip: process.platform === 'win32' }, async () => {
  const s = start({ backends: 'deepseek' })
  try {
    const { port, token } = await s.ready
    const real = path.join(s.dir, 'dotfiles-config')
    writeFileSync(real, CONFIG)
    rmSync(s.cfg)
    symlinkSync(real, s.cfg)
    const res = await request({ port, method: 'POST', pathname: `/${token}/save`, body: form({ DEEPSEEK_API_KEY: 'sk-link' }) })
    assert.equal(res.status, 200)
    assert.equal(await s.exited, 0)
    assert.equal(lstatSync(s.cfg).isSymbolicLink(), true)
    assert.match(readFileSync(real, 'utf8'), /^DEEPSEEK_API_KEY="sk-link"$/m)
  } finally { s.cleanup() }
})

test('the page lets the browser send its real Origin on the form POST', async () => {
  // Found in a real Chrome run: under `Referrer-Policy: no-referrer` Chrome posts the form with
  // `Origin: null`, the Origin check refuses it, and the form can never be saved.
  const s = start()
  try {
    const { port, token } = await s.ready
    const get = await request({ port, pathname: `/${token}/` })
    assert.equal(get.headers['referrer-policy'], 'same-origin')
    const nul = await request({ port, method: 'POST', pathname: `/${token}/save`, headers: { Origin: 'null' }, body: form({ DS_MODEL: 'x' }) })
    assert.equal(nul.status, 403, 'a null Origin (sandboxed iframe, file://) stays refused')
    const ok = await request({ port, method: 'POST', pathname: `/${token}/save`, headers: { Origin: `http://127.0.0.1:${port}` }, body: form({ DS_MODEL: 'x' }) })
    assert.equal(ok.status, 200)
    assert.equal(await s.exited, 0)
  } finally { s.cleanup() }
})
