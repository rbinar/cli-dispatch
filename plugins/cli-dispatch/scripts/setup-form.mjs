#!/usr/bin/env node
// One-shot local web form for the cli-dispatch config (API keys + model names). It replaces
// "open the config in Notepad/TextEdit/xdg-open": a plain text editor shows every key in clear
// text, and the alternative — pasting a key into the Claude chat — would route it through the
// model. Here the key goes browser -> this process -> the config file and nowhere else.
//
//   node setup-form.mjs --config <path> --backends <deepseek,antigravity,codex,opencode,copilot|all>
//                       [--timeout SECS (default 600)] [--no-open]
//
// Exit codes: 0 saved, 2 timed out with nothing saved, 1 usage error.
//
// Not installed to ~/.local: install.sh/install.ps1 and commands/setup.md run it straight from
// the plugin's scripts dir, so it can never go stale relative to the plugin.
//
// Security model. The config is SOURCED by bash, and the port is reachable by any local process
// (and, via DNS rebinding, by any web page), so: loopback-only bind on a random port; a random
// per-run token in the URL path; Host and Origin must be loopback with our port; a value that
// could execute when sourced (" $ ` \ CR LF) is refused, never escaped; secrets are never
// rendered or echoed (only a set/not-set badge); one-shot — the server exits after one save.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { chmodSync, existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const BACKENDS = {
  deepseek: {
    title: 'DeepSeek',
    note: 'API key from <b>platform.deepseek.com</b> (API keys).',
    fields: [['DEEPSEEK_API_KEY', 'API key', true], ['DS_MODEL', 'Model', false], ['DS_FLASH_MODEL', 'Flash model', false]],
  },
  antigravity: {
    title: 'Antigravity (Gemini)',
    note: 'Sign in with Google via <code>agy</code>; the key is optional.',
    fields: [['GEMINI_API_KEY', 'API key', true], ['AG_MODEL', 'Model', false], ['AG_MODELS', 'Models', false]],
  },
  codex: {
    title: 'Codex',
    note: 'Run <code>codex login</code> (preferred); the key is optional.',
    fields: [['CODEX_API_KEY', 'API key', true], ['CX_MODEL', 'Model', false], ['CX_MODELS', 'Models', false]],
  },
  opencode: {
    title: 'OpenCode (OpenRouter)',
    note: 'API key from <b>openrouter.ai/keys</b>.',
    fields: [['OPENROUTER_API_KEY', 'API key', true], ['OC_MODEL', 'Model', false], ['OC_MODELS', 'Models', false]],
  },
  copilot: {
    title: 'GitHub Copilot',
    note: 'The <code>gh auth</code> token is reused automatically; the token is optional.',
    fields: [['COPILOT_GITHUB_TOKEN', 'Token', true], ['CP_MODEL', 'Model', false], ['CP_MODELS', 'Models', false]],
  },
}

function parseArgs(argv) {
  const o = { timeout: 600, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--config') o.config = argv[++i]
    else if (a === '--backends') o.backends = argv[++i]
    else if (a === '--timeout') o.timeout = Number(argv[++i])
    else if (a === '--no-open') o.open = false
  }
  return o
}

const args = parseArgs(process.argv.slice(2))
const names = args.backends === 'all' ? Object.keys(BACKENDS) : String(args.backends || '').split(',').map((s) => s.trim()).filter(Boolean)
if (!args.config || !names.length || names.some((n) => !BACKENDS[n]) || !(args.timeout > 0)) {
  console.error('usage: setup-form.mjs --config <path> --backends <deepseek,antigravity,codex,opencode,copilot|all> [--timeout SECS] [--no-open]')
  process.exit(1)
}
const FIELDS = new Map() // key -> { secret }
for (const n of names) for (const [key, , secret] of BACKENDS[n].fields) FIELDS.set(key, { secret })

const token = crypto.randomBytes(32).toString('base64url')
const tokenBuf = Buffer.from(token)
let port = 0

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Lines are split on \n only, as bash does: JS `^`/`$` with the m flag also break on U+2028/U+2029,
// which once let a value smuggle a second assignment into its own line (security review).
const keyLine = (key) => new RegExp(`^([ \\t]*)(export[ \\t]+)?${key}=(.*)$`)

// Current value of KEY in the config (last assignment wins, as when sourced), or ''.
function currentValue(text, key) {
  let v = ''
  for (const l of text.split('\n')) {
    const m = keyLine(key).exec(l)
    if (m) v = m[3].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return v
}

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--mut:#6e6e73;--bd:#d2d2d7;--ac:#0a64d6}
@media(prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f5f5f7;--mut:#a1a1a6;--bd:#3a3a3c;--ac:#4c9aff}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:34rem;margin:2rem auto;padding:0 1rem}
fieldset{border:1px solid var(--bd);border-radius:8px;margin:1rem 0;padding:.5rem 1rem 1rem}
legend{font-weight:600;padding:0 .4rem}.note{color:var(--mut);font-size:13px;margin:.2rem 0 .6rem}
label{display:block;margin-top:.6rem;font-size:13px}input{width:100%;box-sizing:border-box;padding:.4rem;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
.badge{font-size:12px;color:var(--mut)}button{background:var(--ac);color:#fff;border:0;border-radius:6px;padding:.5rem 1.2rem;font:inherit;cursor:pointer}.err{color:#c62828}`

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`

function renderForm(text) {
  const sections = names.map((n) => {
    const b = BACKENDS[n]
    const rows = b.fields.map(([key, label, secret]) => {
      const cur = currentValue(text, key)
      if (secret) {
        return `<label>${esc(label)} (${key}) <span class="badge">${cur ? 'set' : 'not set'} — leave empty to keep</span><input type="password" name="${key}" value="" autocomplete="new-password"></label>`
      }
      return `<label>${esc(label)} (${key})<input type="text" name="${key}" value="${esc(cur)}" autocomplete="off"></label>`
    }).join('')
    return `<fieldset><legend>${esc(b.title)}</legend><div class="note">${b.note}</div>${rows}</fieldset>`
  }).join('')
  return page('cli-dispatch setup', `<h1>cli-dispatch setup</h1><p class="note">Values are written to your local config file only. This page works once.</p><form method="post" action="save">${sections}<button type="submit">Save</button></form>`)
}

// Replace EVERY line assigning KEY (keeping any indent/export prefix) — bash keeps the last
// assignment, so rewriting only the first would save a key that never takes effect — or append
// it. All other bytes are untouched.
function applyValues(text, values) {
  const lines = text.split('\n')
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}="${value}"`
    let hit = false
    for (let i = 0; i < lines.length; i++) {
      const m = keyLine(key).exec(lines[i])
      if (m) { lines[i] = `${m[1]}${m[2] || ''}${line}`; hit = true }
    }
    if (!hit) {
      if (lines[lines.length - 1] !== '') lines.push('')
      lines[lines.length - 1] = line
      lines.push('')
    }
  }
  return lines.join('\n')
}

// Write through a symlinked config (a dotfiles setup) instead of replacing the link.
function writeConfig(text) {
  const target = existsSync(args.config) ? realpathSync(args.config) : args.config
  const tmp = path.join(path.dirname(target), `.config.${process.pid}.tmp`)
  writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' })
  renameSync(tmp, target)
  chmodSync(target, 0o600)
}

const readConfig = () => (existsSync(args.config) ? readFileSync(args.config, 'utf8') : '')

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    // Not no-referrer: with it Chrome sends `Origin: null` on the form's own POST, which the
    // Origin check (rightly) refuses. same-origin still never sends the tokened URL elsewhere.
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}
const deny = (res) => send(res, 403, page('Forbidden', '<p>Forbidden.</p>'))

const server = http.createServer((req, res) => {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return deny(res)
  const origin = req.headers.origin
  if (req.method === 'POST' && origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return deny(res)

  const m = /^\/([^/]*)\/(save)?$/.exec((req.url || '').split('?')[0])
  const given = Buffer.from(m ? m[1] : '')
  if (!m || given.length !== tokenBuf.length || !crypto.timingSafeEqual(given, tokenBuf)) return deny(res)

  if (req.method === 'GET' && !m[2]) return send(res, 200, renderForm(readConfig()))
  if (req.method !== 'POST' || !m[2]) return deny(res)

  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > 65536) {
      if (res.headersSent) return
      req.removeAllListeners('data'); req.resume()
      res.setHeader('Connection', 'close')
      send(res, 413, page('Too large', '<p>Request too large.</p>'))
    } else chunks.push(c)
  })
  req.on('end', () => {
    if (size > 65536) return
    const values = {}
    for (const [key, value] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) {
      const f = FIELDS.get(key)
      if (!f) continue
      // Allowlist, not blocklist: printable ASCII minus what is live inside bash double quotes.
      if (/[^\x20-\x7E]|["$`\\]/.test(value)) {
        return send(res, 400, page('Refused', `<p class="err">The field <b>${esc(key)}</b> contains a character that is not allowed (<code>" $ \` \\</code>, a line break, or anything outside printable ASCII). Go back and fix it; nothing was saved.</p>`))
      }
      if (f.secret && value === '') continue
      values[key] = value
    }
    try { writeConfig(applyValues(readConfig(), values)) } catch (e) {
      return send(res, 500, page('Error', `<p class="err">Could not write the config: ${esc(e.message)}</p>`))
    }
    send(res, 200, page('Saved', '<h1>Saved</h1><p>You can close this tab.</p>'))
    res.on('finish', () => { server.close(); process.exit(0) })
  })
})

function openBrowser(url) {
  let cmd
  if (process.platform === 'darwin') cmd = ['open', [url]]
  else if (process.platform === 'win32') cmd = ['rundll32', ['url.dll,FileProtocolHandler', url]]
  else if (process.env.WSL_DISTRO_NAME || /microsoft/i.test(existsSync('/proc/version') ? readFileSync('/proc/version', 'utf8') : '')) cmd = ['explorer.exe', [url]]
  else cmd = ['xdg-open', [url]]
  try {
    const c = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' })
    c.on('error', () => {})
    c.unref()
  } catch { /* best effort */ }
}

server.listen(0, '127.0.0.1', () => {
  port = server.address().port
  const url = `http://127.0.0.1:${port}/${token}/`
  console.log(`setup-form: ${url}`)
  console.log('Open the URL above in your browser if it did not open on its own; the form works once.')
  if (args.open) openBrowser(url)
  setTimeout(() => {
    console.log(`setup-form: timed out after ${args.timeout}s with nothing saved; config untouched.`)
    process.exit(2)
  }, args.timeout * 1000).unref()
})
