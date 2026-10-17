#!/usr/bin/env node
// The cli-dispatch config file's rules, shared by setup-form.mjs and the mod's setup pane. The
// file is SOURCED by bash, so what may be written into it is an allowlist, never an escape.
//
//   node config-file.mjs status            -> {path, exists, keys: {VAR: bool}, models: {VAR: "..."}}
//   node config-file.mjs set <VAR> <VALUE> -> rewrites one model variable (never a key)
//
// Exit codes (set): 0 saved, 3 refused (bad variable or value), 4 no config file.
// Keys appear in `status` as booleans only; `set` cannot write a key at all.
//
// Not installed to ~/.local: run straight from the plugin's scripts dir, like setup-form.mjs.
import { chmodSync, existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const KEY_VARS = ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'CODEX_API_KEY', 'OPENROUTER_API_KEY', 'COPILOT_GITHUB_TOKEN']
export const MODEL_VARS = ['DS_MODEL', 'DS_FLASH_MODEL', 'AG_MODEL', 'CX_MODEL', 'OC_MODEL', 'CP_MODEL']

// Lines are split on \n only, as bash does: JS `^`/`$` with the m flag also break on U+2028/U+2029,
// which once let a value smuggle a second assignment into its own line (security review).
export const keyLine = (key) => new RegExp(`^([ \\t]*)(export[ \\t]+)?${key}=(.*)$`)

// Current value of KEY in the config (last assignment wins, as when sourced), or ''.
export function currentValue(text, key) {
  let v = ''
  for (const l of text.split('\n')) {
    const m = keyLine(key).exec(l)
    if (m) v = m[3].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return v
}

// Allowlist, not blocklist: printable ASCII minus what is live inside bash double quotes.
export const isForbiddenValue = (value) => /[^\x20-\x7E]|["$`\\]/.test(value)

// Replace EVERY line assigning KEY (keeping any indent/export prefix) — bash keeps the last
// assignment, so rewriting only the first would save a key that never takes effect — or append
// it. All other bytes are untouched.
export function applyValues(text, values) {
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
export function writeConfig(configPath, text) {
  const target = existsSync(configPath) ? realpathSync(configPath) : configPath
  const tmp = path.join(path.dirname(target), `.config.${process.pid}.tmp`)
  writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' })
  renameSync(tmp, target)
  chmodSync(target, 0o600)
}

// Config path order mirrors stream-utils.sh source_config: CLI_DISPATCH_CONFIG, CLAUDE_DS_CONFIG,
// ~/.config/cli-dispatch/config, then the legacy ~/.config/claude-ds/config only when the new one
// is absent and the legacy one exists.
export function resolveConfigPath(env = process.env, home = os.homedir()) {
  if (env.CLI_DISPATCH_CONFIG) return env.CLI_DISPATCH_CONFIG
  if (env.CLAUDE_DS_CONFIG) return env.CLAUDE_DS_CONFIG
  const cfg = path.join(home, '.config', 'cli-dispatch', 'config')
  const legacy = path.join(home, '.config', 'claude-ds', 'config')
  return !existsSync(cfg) && existsSync(legacy) ? legacy : cfg
}

function status(configPath) {
  const exists = existsSync(configPath)
  const text = exists ? readFileSync(configPath, 'utf8') : ''
  const keys = {}
  for (const k of KEY_VARS) keys[k] = currentValue(text, k) !== ''
  const models = {}
  for (const m of MODEL_VARS) models[m] = currentValue(text, m)
  return { path: configPath, exists, keys, models }
}

function main(argv) {
  const configPath = resolveConfigPath()
  if (argv[0] === 'status') {
    process.stdout.write(JSON.stringify(status(configPath)))
    return 0
  }
  if (argv[0] === 'set' && argv.length === 3) {
    const [, name, value] = argv
    if (!MODEL_VARS.includes(name)) { console.error(`config-file: ${name} is not a model variable`); return 3 }
    if (isForbiddenValue(value)) { console.error(`config-file: the value for ${name} contains a character that is not allowed`); return 3 }
    if (!existsSync(configPath)) { console.error(`config-file: no config file at ${configPath}`); return 4 }
    writeConfig(configPath, applyValues(readFileSync(configPath, 'utf8'), { [name]: value }))
    return 0
  }
  console.error('usage: config-file.mjs status | set <MODEL_VAR> <VALUE>')
  return 3
}

const entryPath = process.argv[1]
let entryRealPath = entryPath
try { entryRealPath = realpathSync(entryPath) } catch {}
if (entryPath && import.meta.url === pathToFileURL(entryRealPath).href) process.exit(main(process.argv.slice(2)))
