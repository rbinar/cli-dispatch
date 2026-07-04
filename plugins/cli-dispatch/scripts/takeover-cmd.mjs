// takeover-cmd.mjs — pure builder for the human-takeover interactive resume command.
//
// buildTakeoverCommand(backend, meta) -> { cmd, args, env, cwd }
//
// This module is the ONLY place that decides how a worker's underlying CLI is spawned
// in interactive-resume mode for the browser-terminal takeover feature (see
// .specs/dev/sdd/human-takeover.md). It is a PURE function: zero I/O, zero client input
// ever reaches its output. Its only inputs are `backend` (a string) and `meta` (the
// object the caller — dashboard-server.mjs — has already read from that session's own
// meta.json on disk). This function must NEVER see raw HTTP request data; the caller is
// responsible for keeping the client at arm's length from this boundary.
//
// The returned `args` is always an array (never a shell string), and `cwd` is returned
// as an opaque value for the caller to pass as a child_process spawn option (never
// concatenated into a command line). This closes the shell-injection surface
// structurally: whatever garbage lives in meta.threadId/meta.cwd is passed to
// child_process as inert argv/option values, never interpreted by a shell.
//
// Phase 1 (this file, previously): `codex` branch was implemented first (pilot backend,
// see SDD "Fazlar" §Faz 1). The other 4 backends (deepseek, antigravity, opencode,
// copilot) were stubbed in the SAME dispatch table shape.
//
// Phase 2 (this file, current): the remaining 4 backends (deepseek, antigravity,
// opencode, copilot) are filled in additively below, per SDD "Fazlar" §Faz 2 and the
// "takeover-cmd.mjs iç sözleşme (saf)" table. The dispatch table shape/keys are
// unchanged; `buildCodex` is untouched.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ---- codex (Phase 1 — fully implemented) ----
//
// `codex resume <threadId>` is the plain interactive TUI resume (NOT `codex exec --json
// resume`, which is the headless mode cx-stream uses elsewhere). codex's `resume`
// subcommand does not support -C/--cwd, so cwd must be supplied via the spawn option,
// not as an arg.
function buildCodex(meta) {
  if (!meta || typeof meta.threadId !== 'string' || meta.threadId.length === 0) {
    throw new Error('buildTakeoverCommand: codex requires meta.threadId')
  }
  if (!meta || typeof meta.cwd !== 'string' || meta.cwd.length === 0) {
    throw new Error('buildTakeoverCommand: codex requires meta.cwd')
  }
  return {
    cmd: 'codex',
    args: ['resume', meta.threadId],
    // Nothing special beyond whatever auth is already in the environment
    // (CODEX_API_KEY or OAuth session) — no overrides needed for codex.
    env: {},
    cwd: meta.cwd,
  }
}

// ---- config loader (Phase 2 addition) ----
//
// The bash `*-stream` wrappers get their API keys/model overrides via stream-utils.sh's
// `source_config()`, which sources `~/.config/cli-dispatch/config` (or
// `~/.config/claude-ds/config` as a legacy fallback) into the shell environment before
// exec'ing the underlying CLI. dashboard-server.mjs, however, is launched by
// `cli-dispatch-dashboard` via a bare `exec node "$SERVER" "$@"` that never sources that
// config file — so on a freshly-started dashboard-server process, process.env simply
// won't have DEEPSEEK_API_KEY/DS_MODEL/OPENROUTER_API_KEY/etc. set, even though the user
// has them correctly configured for the bash workers. Without this loader, buildDeepseek
// et al. below would silently produce `undefined` env values the first time a real
// takeover happens against a fresh dashboard-server — a real account/billing-safety bug
// for the deepseek branch specifically (falls back to the user's real Claude account).
//
// This is a minimal reimplementation of the same trivial `KEY=value` (optionally
// `export KEY=value`) line format the bash side already parses via `. "$config"` — not a
// new config mechanism. It deliberately mirrors `source_config()`'s resolution order:
//   ${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-$HOME/.config/cli-dispatch/config}}
// falling back to `~/.config/claude-ds/config` (legacy) if the primary path doesn't
// exist as a file.
let _configLoaded = false // memoized: file I/O happens at most once per process

const CONFIG_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

function resolveConfigPath() {
  const primary =
    process.env.CLI_DISPATCH_CONFIG ||
    process.env.CLAUDE_DS_CONFIG ||
    path.join(os.homedir(), '.config', 'cli-dispatch', 'config')
  if (fs.existsSync(primary)) return primary
  const legacy = path.join(os.homedir(), '.config', 'claude-ds', 'config')
  if (fs.existsSync(legacy)) return legacy
  return primary // doesn't exist either; caller no-ops on missing file
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

// loadConfigDefaults() — best-effort, side-effecting (sets process.env). Never overrides
// an already-set process.env key (real env vars always win — this matters both for
// correctness in real deployments and for unit tests that stub via process.env directly).
export function loadConfigDefaults() {
  if (_configLoaded) return
  _configLoaded = true
  const configPath = resolveConfigPath()
  let contents
  try {
    contents = fs.readFileSync(configPath, 'utf8')
  } catch {
    return // config file doesn't exist (or unreadable) — nothing to load
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const match = CONFIG_LINE_RE.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue
    process.env[key] = stripQuotes(rawValue.trim())
  }
}

// ---- deepseek (Phase 2) ----
//
// `claude --resume <sessionId> --add-dir <cwd>` is the plain interactive resume, mirroring
// claude-ds-stream's own launch shape. The env block below is replicated VERBATIM from
// claude-ds-stream's `env ANTHROPIC_BASE_URL=... claude ...` launch line — all 7 keys are
// required; omitting/misordering any of them silently authenticates the interactive
// session against the user's REAL personal Claude account instead of DeepSeek (a real
// billing/account-safety bug, not a cosmetic one). Deliberately NOT included:
// MAX_THINKING_TOKENS — that var is derived from a `--effort` CLI flag on the headless
// `claude-ds-stream` path, which has no equivalent in an interactive takeover resume
// (a deliberate scope narrowing, not an oversight).
function buildDeepseek(meta) {
  if (!meta || typeof meta.sessionId !== 'string' || meta.sessionId.length === 0) {
    throw new Error('buildTakeoverCommand: deepseek requires meta.sessionId')
  }
  if (!meta || typeof meta.cwd !== 'string' || meta.cwd.length === 0) {
    throw new Error('buildTakeoverCommand: deepseek requires meta.cwd')
  }
  // Security review (dev-security, Phase 2): if DEEPSEEK_API_KEY is unresolved after
  // loadConfigDefaults() (neither real env nor the config-file fallback set it), the
  // ANTHROPIC_AUTH_TOKEN key below would silently become `undefined` and get dropped
  // from the spawned child's environment entirely — while ANTHROPIC_BASE_URL still
  // unconditionally points at the DeepSeek endpoint. Worst case, the `claude` CLI falls
  // back to an OAuth/session credential found on the host (the user's REAL Anthropic
  // account) and sends it to DeepSeek's endpoint instead — a silent billing/account-safety
  // failure. Fail loud instead, matching every other required field in this function.
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('buildTakeoverCommand: deepseek requires DEEPSEEK_API_KEY (env or config)')
  }
  const dsModel = process.env.DS_MODEL || 'deepseek-v4-pro'
  const dsFlashModel = process.env.DS_FLASH_MODEL || 'deepseek-v4-flash'
  return {
    cmd: 'claude',
    args: ['--resume', meta.sessionId, '--add-dir', meta.cwd],
    env: {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: process.env.DEEPSEEK_API_KEY,
      ANTHROPIC_MODEL: dsModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: dsModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: dsModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: dsFlashModel,
      CLAUDE_CODE_SUBAGENT_MODEL: dsFlashModel,
    },
    cwd: meta.cwd,
  }
}

// ---- antigravity (Phase 2) ----
//
// `agy --conversation <convId>` — interactive mode, no `-p` flag (a real PTY already
// provides a TTY, so the headless `-p` mode used by ag-stream doesn't apply here). Env
// forwards GEMINI_API_KEY/ANTIGRAVITY_API_KEY from process.env only if actually set,
// mirroring ag-stream's own `[ -n "${GEMINI_API_KEY:-}" ] && export GEMINI_API_KEY` guard
// — never inject a key with value `undefined`.
function buildAntigravity(meta) {
  if (!meta || typeof meta.convId !== 'string' || meta.convId.length === 0) {
    throw new Error('buildTakeoverCommand: antigravity requires meta.convId')
  }
  if (!meta || typeof meta.cwd !== 'string' || meta.cwd.length === 0) {
    throw new Error('buildTakeoverCommand: antigravity requires meta.cwd')
  }
  const env = {}
  if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY
  if (process.env.ANTIGRAVITY_API_KEY) env.ANTIGRAVITY_API_KEY = process.env.ANTIGRAVITY_API_KEY
  return {
    cmd: 'agy',
    args: ['--conversation', meta.convId],
    env,
    cwd: meta.cwd,
  }
}

// ---- opencode (Phase 2) ----
//
// `opencode --session <threadId> --continue` — mirrors oc-stream's own verified resume
// invocation exactly (oc-stream:127, confirmed 2026-07-02 against a live OPENROUTER_API_KEY).
// cwd is supplied via the spawn option, NOT a `--dir` arg. Env forwards OPENROUTER_API_KEY
// only if actually set (omit the key entirely if unset, never inject `undefined`).
function buildOpencode(meta) {
  if (!meta || typeof meta.threadId !== 'string' || meta.threadId.length === 0) {
    throw new Error('buildTakeoverCommand: opencode requires meta.threadId')
  }
  if (!meta || typeof meta.cwd !== 'string' || meta.cwd.length === 0) {
    throw new Error('buildTakeoverCommand: opencode requires meta.cwd')
  }
  const env = {}
  if (process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  return {
    cmd: 'opencode',
    args: ['--session', meta.threadId, '--continue'],
    env,
    cwd: meta.cwd,
  }
}

// ---- copilot (Phase 2) ----
//
// `copilot --resume <threadId>` — interactive default. Env token precedence:
// COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN.
function buildCopilot(meta) {
  if (!meta || typeof meta.threadId !== 'string' || meta.threadId.length === 0) {
    throw new Error('buildTakeoverCommand: copilot requires meta.threadId')
  }
  if (!meta || typeof meta.cwd !== 'string' || meta.cwd.length === 0) {
    throw new Error('buildTakeoverCommand: copilot requires meta.cwd')
  }
  const token =
    process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  return {
    cmd: 'copilot',
    args: ['--resume', meta.threadId],
    env: token ? { COPILOT_GITHUB_TOKEN: token } : {},
    cwd: meta.cwd,
  }
}

// ---- dispatch table ----
//
// Keyed by the exact lowercase backend-id strings written into meta.json elsewhere in
// this codebase (see e.g. cx-stream-parse.mjs `backend:'codex'`, ag-transcript-parse.mjs
// `backend:'antigravity'`, cp-stream-parse.mjs `backend:'copilot'`,
// oc-stream-parse.mjs `backend:'opencode'`, and dashboard-server.mjs's 'deepseek'
// fallback for the claude-ds backend).
const BUILDERS = {
  codex: buildCodex,
  deepseek: buildDeepseek,
  antigravity: buildAntigravity,
  opencode: buildOpencode,
  copilot: buildCopilot,
}

// buildTakeoverCommand(backend, meta) -> { cmd, args, env, cwd }
//
// Looks up `backend` in the dispatch table and invokes its builder with `meta`.
// Throws a clear "unknown backend" error (distinct message from the per-backend
// "not yet implemented" stubs) for any backend string not in the table at all.
export function buildTakeoverCommand(backend, meta) {
  // Lazily fill in process.env defaults from the on-disk config file (see
  // loadConfigDefaults above) before any builder reads process.env for API keys/models.
  // Memoized internally, so this is a no-op after the first call in this process.
  loadConfigDefaults()
  const builder = BUILDERS[backend]
  if (!builder) {
    throw new Error(`buildTakeoverCommand: unknown backend "${backend}"`)
  }
  return builder(meta)
}
