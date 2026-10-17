import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { SetupState, Worker } from '../types'

// cli-dispatch mod (Claude Code 2.1.287+): a band above the prompt with this session's workers;
// a guard that keeps Edit/Write out of a repo while a worktree run for it is live — the run's
// leak check would otherwise blame the worker and skip verify; and the `dispatch` tool, which
// runs cli-dispatch-run and waits for it in one call, with no forwarding subagent; and
// /cli-dispatch-config, a setup pane (which worker CLIs, wrappers and keys are in place, model
// names, install). A key value is never drawn, stored in state or typed into the pane: the pane
// only knows whether one is set.

const workers = atom({ plugin: 'cli-dispatch', key: 'workers' } as const, [])
const setup = atom({ plugin: 'cli-dispatch', key: 'setup' } as const, null as SetupState | null)

const STALE_SECS = 90 // same liveness window as cli-dispatch-statusline.sh
const RECENT_SECS = 600 // a finished run stays on the band this long
const TICK_MS = 4000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const BACKENDS: Record<string, string> = { deepseek: 'ds', antigravity: 'ag', codex: 'cx', opencode: 'oc', copilot: 'cp' }
// The userConfig field (a sensitive key) of each backend, and the variable name the config file uses.
const KEY_FIELD: Record<string, string> = { ds: 'deepseek_api_key', ag: 'gemini_api_key', cx: 'codex_api_key', oc: 'openrouter_api_key', cp: 'copilot_github_token' }

async function readJson($: EngineInterface, path: string): Promise<any> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

// Session-dir root resolution: CLI_DISPATCH_SESSIONS_DIR → ~/.cache/cli-dispatch/sessions → legacy claude-ds.
async function sessionsRoot($: EngineInterface): Promise<string> {
  const override = await $.env.get('CLI_DISPATCH_SESSIONS_DIR')
  if (override) return override
  const cache = (await $.env.get('XDG_CACHE_HOME')) || `${await $.env.get('HOME')}/.cache`
  const root = `${cache}/cli-dispatch/sessions`
  return (await $.fs.exists(root)) ? root : `${cache}/claude-ds/sessions`
}

type Live = { dir: string; meta: any; status: any; mtimeMs: number }

// Only sessions whose status.json changed within maxAgeMs are read: the root holds up to
// CLI_DISPATCH_MAX_SESSIONS dirs and this runs every few seconds.
async function scan($: EngineInterface, now: number, maxAgeMs: number, runningOnly = false): Promise<Live[]> {
  const root = await sessionsRoot($)
  let entries
  try {
    entries = await $.fs.list(root)
  } catch {
    return []
  }
  const out: Live[] = []
  for (const ent of entries) {
    if (ent.kind !== 'dir' || ent.name.startsWith('.') || ent.name === 'verdict-archive') continue
    const dir = `${root}/${ent.name}`
    let mtimeMs = 0
    try {
      mtimeMs = (await $.fs.stat(`${dir}/status.json`)).mtimeMs
    } catch {
      continue
    }
    if (now - mtimeMs > maxAgeMs) continue
    const status = await readJson($, `${dir}/status.json`)
    if (!status || (runningOnly && status.state !== 'running')) continue
    out.push({ dir, meta: (await readJson($, `${dir}/meta.json`)) ?? {}, status, mtimeMs })
  }
  return out
}

const isLive = (s: Live, now: number) => s.status.state === 'running' && now - s.mtimeMs <= STALE_SECS * 1000

async function refresh($: EngineInterface) {
  const sid = await $.session.id()
  const now = await $.clock.now()
  const mine = (await scan($, now, RECENT_SECS * 1000)).filter(s => s.meta.parentSessionId === sid)
  const list: Worker[] = []
  for (const s of mine) {
    const backend = BACKENDS[s.meta.backend] ?? s.meta.backend ?? '?'
    if (await isRunAlive($, s, now)) {
      list.push({ id: s.status.sessionId ?? '', backend, state: 'running', startedAt: s.meta.startedAt ?? '' })
    } else if (s.status.state !== 'running' && now - s.mtimeMs <= RECENT_SECS * 1000) {
      const v = await readJson($, `${s.dir}/verdict.json`)
      const verify = !v ? undefined : v.leak ? 'LEAK' : v.verify?.exitCode == null ? 'no verify' : v.verify.exitCode === 0 ? 'PASS' : 'FAIL'
      list.push({ id: s.status.sessionId ?? '', backend, state: s.status.state, startedAt: s.meta.startedAt ?? '', verify })
    }
  }
  await update($, workers, () => list)
}

function elapsed(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`
}

// A worker running a long silent command (a test suite) writes no status for minutes, so the
// guard also asks whether worker.pid is still alive before it calls a quiet run finished.
async function isRunAlive($: EngineInterface, s: Live, now: number): Promise<boolean> {
  if (s.status.state !== 'running') return false
  if (isLive(s, now)) return true
  let pid = ''
  try {
    pid = (await $.fs.read(`${s.dir}/worker.pid`)).trim()
  } catch {
    return false
  }
  return /^\d+$/.test(pid) && (await $.process.run(['kill', '-0', pid])).exitCode === 0
}

// The main repo of a live worktree run: the worktree's git common dir, one level up.
async function liveRepos($: EngineInterface): Promise<{ repo: string; backend: string }[]> {
  const now = await $.clock.now()
  const out: { repo: string; backend: string }[] = []
  for (const s of await scan($, now, Infinity, true)) {
    if (!s.meta.cwd || !(await isRunAlive($, s, now))) continue
    const r = await $.process.run(['git', '-C', s.meta.cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (r.exitCode !== 0) continue
    const common = r.stdout.trim().replace(/\/\.git\/?$/, '')
    if (common && common !== s.meta.cwd) out.push({ repo: common, backend: BACKENDS[s.meta.backend] ?? s.meta.backend })
  }
  return out
}

async function realPath($: EngineInterface, path: string): Promise<string> {
  // Resolve the deepest existing ancestor so a file Write is about to create still maps.
  let p = path
  for (let i = 0; i < 64 && p && p !== '/'; i++) {
    try {
      const st = await $.fs.stat(p, { resolve: true })
      return st.realPath + path.slice(p.length)
    } catch {
      p = p.slice(0, p.lastIndexOf('/')) || '/'
    }
  }
  return path
}

const DISPATCH = {
  name: 'dispatch',
  description:
    "Delegate a coding task to an external worker CLI through cli-dispatch's deterministic runner and wait for its verdict. " +
    'The worker runs in a git worktree of `cwd`; your `verify` commands decide pass/fail; a failing verify is retried once. ' +
    'Returns the runner summary verbatim (session id, verify result, diff, stranded worktree, patch path). It does not apply the patch.',
  inputSchema: {
    type: 'object',
    properties: {
      backend: { type: 'string', enum: ['ds', 'ag', 'cx', 'oc', 'cp'] },
      cwd: { type: 'string', description: 'Absolute path of the git repo to work in.' },
      task: { type: 'string', description: 'The full, self-contained brief for the worker.' },
      verify: { type: 'array', items: { type: 'string' }, description: 'Shell commands run in the worktree after the worker; all must exit 0.' },
      model: { type: 'string', description: "The worker's model slug; omit for the backend default." },
      scope: {
        type: 'array',
        items: { type: 'string' },
        description: 'Repo-relative globs the worker may change (`**` crosses directories; a plain path covers everything under it). A change outside all of them fails the run.',
      },
    },
    required: ['backend', 'cwd', 'task'],
  },
} as const

type DispatchInput = { backend: string; cwd: string; task: string; verify?: string[]; model?: string; scope?: string[] }

// cli-dispatch-run from PATH, else the copy in this plugin (#150: a new binary not yet installed).
async function runner($: EngineInterface, args: string[], init: { env: Record<string, string>; timeoutMs: number }) {
  try {
    return await $.process.run(args, init)
  } catch {
    return $.process.run(['bash', `${$.plugin.root}/scripts/${args[0]}`, ...args.slice(1)], init)
  }
}

async function dispatch($: EngineInterface, input: DispatchInput, signal: AbortSignal, options: PluginOptions): Promise<string> {
  if (!['ds', 'ag', 'cx', 'oc', 'cp'].includes(input.backend)) return `dispatch: backend must be one of ds, ag, cx, oc, cp (got ${input.backend})`
  if (!input.cwd?.startsWith('/')) return 'dispatch: cwd must be an absolute path'
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/$/, '')
  const brief = `${tmp}/cli-dispatch-brief-${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  await $.fs.write(brief, input.task)
  const argv = ['cli-dispatch-run', '--detach', '--backend', input.backend, '--cwd', input.cwd, '--prompt-file', brief, '--fix-attempts', '1']
  for (const v of input.verify ?? []) argv.push('--verify', v)
  for (const g of input.scope ?? []) argv.push('--scope', g)
  if (input.model) argv.push('--model', input.model)
  // The parsers read the parent session from this; it is what scopes the band to this session.
  const env = { CLAUDE_CODE_SESSION_ID: await $.session.id() }
  // The dispatched backend's plugin-config key rides on the run call only, in a private name that
  // cli-dispatch-run takes out of the environment and exports to the worker alone. The wait calls
  // and everything else get `env`, without it.
  const key = options[KEY_FIELD[input.backend] ?? '']
  const runEnv = typeof key === 'string' && key !== '' ? { ...env, CLI_DISPATCH_RUN_KEY: key } : env
  const started = await runner($, argv, { env: runEnv, timeoutMs: 60_000 })
  const runId = /^run: (\S+)/m.exec(started.stdout)?.[1]
  if (!runId) return `cli-dispatch-run did not start (exit ${started.exitCode}):\n${started.stdout}${started.stderr}`
  await refresh($)
  let last = started
  for (let i = 0; i < 6 && !signal.aborted; i++) {
    last = await runner($, ['cli-dispatch-wait', '--run', runId, '--timeout', '570'], { env, timeoutMs: 600_000 })
    if (last.exitCode !== 124) break
  }
  await refresh($)
  if (signal.aborted || last.exitCode === 124) return `run ${runId} is still running — wait with: cli-dispatch-wait --run ${runId}`
  return last.stdout || last.stderr
}


// ---- /cli-dispatch-config: the setup pane -------------------------------------------------

const PLUGIN_CONFIGURE = '/plugin configure cli-dispatch@cli-dispatch'

// Display order: the login-first backends on top, the paste-a-key ones (OpenCode, DeepSeek) last.
// `install` is the name install.sh --backends knows it by.
const SETUP_BACKENDS = [
  { id: 'ag', name: 'Antigravity', install: 'antigravity', cli: 'agy', wrapper: 'ag-agent', keyVar: 'GEMINI_API_KEY', required: false, hint: 'sign in with agy', models: ['AG_MODEL'] },
  { id: 'cx', name: 'Codex', install: 'codex', cli: 'codex', wrapper: 'cx-agent', keyVar: 'CODEX_API_KEY', required: false, hint: 'codex login', models: ['CX_MODEL'] },
  { id: 'cp', name: 'Copilot', install: 'copilot', cli: 'copilot', wrapper: 'cp-agent', keyVar: 'COPILOT_GITHUB_TOKEN', required: false, hint: 'gh auth login', models: ['CP_MODEL'] },
  { id: 'oc', name: 'OpenCode', install: 'opencode', cli: 'opencode', wrapper: 'oc-agent', keyVar: 'OPENROUTER_API_KEY', required: true, hint: '', models: ['OC_MODEL'] },
  { id: 'ds', name: 'DeepSeek', install: 'deepseek', cli: 'claude', wrapper: 'ds-agent', keyVar: 'DEEPSEEK_API_KEY', required: true, hint: '', models: ['DS_MODEL', 'DS_FLASH_MODEL'] },
] as const
// install.sh --backends takes them in this order.
const INSTALL_ORDER = ['deepseek', 'antigravity', 'codex', 'opencode', 'copilot']

const PROBE = `for c in ${SETUP_BACKENDS.map(b => `${b.cli} ${b.wrapper}`).join(' ')}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done`

const configScript = ($: EngineInterface) => `${$.plugin.root}/scripts/config-file.mjs`

// Booleans and model names only: this crosses the hook chain (state.set), and a key never does.
async function computeSetup($: EngineInterface, options: PluginOptions, selected: string[]): Promise<SetupState> {
  let found: Set<string> | null = null
  try {
    const r = await $.process.run(['sh', '-c', PROBE])
    found = new Set(r.stdout.split('\n').map(l => l.trim()).filter(Boolean))
  } catch {
    found = null // no sh (native Windows)
  }
  let cfg: any = null
  try {
    const r = await $.process.run(['node', configScript($), 'status'])
    if (r.exitCode === 0) cfg = JSON.parse(r.stdout)
  } catch {
    cfg = null
  }
  return {
    installable: found !== null,
    configKnown: cfg !== null,
    configPath: cfg?.path ?? '',
    configExists: cfg?.exists === true,
    selected,
    backends: SETUP_BACKENDS.map(b => {
      const field = KEY_FIELD[b.id] ?? ''
      const uc = options[field]
      const models: Record<string, string> = {}
      for (const m of b.models) models[m] = String(cfg?.models?.[m] ?? '')
      return {
        id: b.id,
        cliOk: found === null ? null : found.has(b.cli),
        wrapperOk: found === null ? null : found.has(b.wrapper),
        userConfig: typeof uc === 'string' && uc !== '',
        configFile: cfg === null ? null : cfg.keys?.[b.keyVar] === true,
        models,
      }
    }),
  }
}

async function refreshSetup($: EngineInterface, options: PluginOptions, selected?: string[]) {
  const keep = selected ?? (await read($, setup))?.selected ?? []
  const next = await computeSetup($, options, keep)
  await update($, setup, () => next)
}

async function saveModel($: EngineInterface, options: PluginOptions, name: string, value: string) {
  let msg: string
  try {
    const r = await $.process.run(['node', configScript($), 'set', name, value])
    msg =
      r.exitCode === 0 ? `${name} saved`
      : r.exitCode === 3 ? `${name}: not saved, that value has a character that is not allowed`
      : r.exitCode === 4 ? 'no config file yet: run /cli-dispatch:setup or install a backend first'
      : `${name}: not saved (exit ${r.exitCode})`
  } catch {
    msg = `${name}: not saved (node is not available)`
  }
  $.ui.toast(msg)
  await refreshSetup($, options)
}

// The same installer /cli-dispatch:setup runs, without its form or editor, and never with
// --install-missing: running a vendor's install script needs the person's consent each time.
async function installSelected($: EngineInterface, options: PluginOptions) {
  const state = await read($, setup)
  const names = INSTALL_ORDER.filter(n => SETUP_BACKENDS.some(b => b.install === n && state?.selected.includes(b.id)))
  if (names.length === 0) {
    $.ui.toast('cli-dispatch: select at least one backend to install')
    return
  }
  let msg: string
  try {
    const res = await $.process.run(['bash', `${$.plugin.root}/scripts/resolve-plugin-root.sh`, $.plugin.root])
    const root = res.stdout.trim() || $.plugin.root
    const r = await $.process.run(['bash', `${root}/scripts/install.sh`, '--backends', names.join(','), '--non-interactive'], { timeoutMs: 300_000 })
    const lines = r.stdout.split('\n').map(l => l.trim()).filter(l => l === 'Done.' || l.startsWith('WARNING'))
    msg = `install ${names.join(',')}: exit ${r.exitCode}${lines.length ? `\n${lines.join('\n')}` : ''}`
  } catch (err) {
    msg = `install ${names.join(',')} failed: ${err instanceof Error ? err.message : String(err)}`
  }
  $.ui.toast(msg)
  await refreshSetup($, options)
}

const mark = (ok: boolean | null) => (ok === null ? '?' : ok ? '✓' : '✗')

function keyCell(b: (typeof SETUP_BACKENDS)[number], s: SetupState['backends'][number]): string {
  if (s.userConfig && s.configFile) return '✓ plugin config (overrides the config file for dispatch)'
  if (s.userConfig) return '✓ plugin config'
  if (s.configFile) return '✓ config file'
  if (s.configFile === null) return `? config file unreadable — keys: ${PLUGIN_CONFIGURE}`
  return b.required ? `✗ missing — run: ${PLUGIN_CONFIGURE}` : `– optional (${b.hint}) — or run: ${PLUGIN_CONFIGURE}`
}

// ---- /cli-dispatch-runs: the run monitor pane ------------------------------------------------

const PANE_ID = 'cli-dispatch-runs'
const PANE_TICK_MS = 1000
const SUMMARY_WINDOW = 256 * 1024
const FLOW_WINDOW = 512 * 1024
const MASK = '••••'
// One drawing draws 100000 characters in all (anything past it is cut, and the cut is the newest
// end), so a view draws the newest entries that fit DRAW_MAX and an event is shown in pages.
const DRAW_MAX = 90_000
const EVENT_PAGE = 80_000
// The userConfig fields whose configured values are masked wherever they would be drawn.
const SECRET_OPTIONS = ['deepseek_api_key', 'openrouter_api_key', 'gemini_api_key', 'codex_api_key', 'copilot_github_token']

// Escape sequences and control characters out; a secret cannot hide behind one.
function sanitize(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
}

const SHAPES: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{16,}/g, `sk-ant-${MASK}`],
  [/sk-[A-Za-z0-9_-]{16,}/g, `sk-${MASK}`],
  [/(gh[pousr]_)[A-Za-z0-9]{20,}/g, `$1${MASK}`],
  [/(github_pat_)[A-Za-z0-9_]{20,}/g, `$1${MASK}`],
  [/AKIA[0-9A-Z]{16}/g, `AKIA${MASK}`],
  [/AIza[0-9A-Za-z_-]{35}/g, `AIza${MASK}`],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${MASK}`],
  [/\b([A-Za-z0-9_]*(?:API_KEY|_TOKEN|_SECRET|PASSWORD))(["']?\s*[=:]\s*["']?)[^\s"']+/gi, `$1$2${MASK}`],
]
// A scalar whose own key name says it is a secret (an `env` object's field).
const SECRET_KEY = /(?:^|_)(?:api_?key|token|secret|password)$/i

// The configured values are literal, longest first, and live only in this closure.
function makeClean(options: PluginOptions): (s: string) => string {
  const exact = SECRET_OPTIONS.map(k => options[k]).filter((v): v is string => typeof v === 'string' && v !== '').sort((a, b) => b.length - a.length)
  return s => {
    let out = sanitize(s)
    for (const v of exact) out = out.split(v).join(MASK)
    for (const [re, to] of SHAPES) out = out.replace(re, to)
    return out
  }
}

// One event, every field in order, nothing cut: `path: value`, a multi-line string as its lines.
function renderEvent(ev: unknown): string {
  const out: string[] = []
  const walk = (val: unknown, path: string, key: string) => {
    if (val !== null && typeof val === 'object') {
      const arr = Array.isArray(val)
      const entries: [string, unknown][] = arr ? val.map((x, i) => [`[${i}]`, x]) : Object.entries(val)
      if (entries.length === 0) out.push(`${path || 'value'}: ${arr ? '[]' : '{}'}`)
      for (const [k, x] of entries) walk(x, path ? (arr ? `${path}${k}` : `${path}.${k}`) : k, arr ? '' : k)
      return
    }
    const name = path || 'value'
    if (typeof val === 'string' && key && SECRET_KEY.test(key)) out.push(`${name}: ${MASK}`)
    else if (typeof val === 'string' && val.includes('\n')) out.push(`${name}:`, ...val.split('\n').map(l => `  ${l}`))
    else out.push(`${name}: ${String(val)}`)
  }
  walk(ev, '', '')
  return out.join('\n')
}

// ds and ol share claude's stream-json; the streaming rules key on the format, not the name.
const CLAUDE_STREAM = new Set(['deepseek', 'ollama'])

type Rec = { o: number; t: string; l?: number; big?: true }
type Line = { o: number; t: string }
type Tag = 'model' | 'komut' | 'other'
// `key` + `pending`: a started/running record that a later finished one with the same key replaces.
type Entry = { o: number; kind: 'event' | 'skip' | 'delta' | 'hidden'; type: string; head: string; text: string; l?: number; big?: boolean; tag: Tag; exit?: number; key?: string; pending?: boolean }
type Block = { o: number; n: number; head: string; text: string; l?: number; big?: boolean; skipped?: number; tag: Tag; exit?: number }
// n0: how many records before items[0] were dropped from the front while following; the ordinal of items[i] is n0 + i + 1.
type Win<T> = { from: number; to: number; size: number; follow: boolean; items: T[]; n0?: number }
type Run = {
  name: string
  dir: string
  sessionId: unknown // meta.sessionId: with parentSessionId, what identifies a run across a dir rename
  parentSessionId: unknown
  backend: string // the stream format, meta.backend
  label: string // the band's short name
  model: string
  branch: string
  repo: string // basename of the main repo (the worktree's, else meta.cwd's)
  origName: string // the dir name at creation: a detached run's `session` file keeps it after a rename
  runDir: string // the detached run's bookkeeping dir, once found
  runScanAt: number
  verifying: boolean // the worker is done, no verdict yet, and the run process is alive
  prompt: string
  startedAt: string
  status: any
  statusM: number
  verdict: any
  verdictM: number
  alive: boolean
}
type Tab = 'summary' | 'flow'

const verifyOf = (v: any): string | undefined =>
  !v || (v.error !== undefined && v.state === undefined) ? undefined : v.leak ? 'LEAK' : v.verify?.exitCode == null ? 'no verify' : v.verify.exitCode === 0 ? 'PASS' : 'FAIL'

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

let clean = makeClean({})
const seen = new Map<string, Run | 'other'>()
let rows: Run[] = []
let view: 'list' | 'run' = 'list'
let sel: Run | null = null
let tab: Tab = 'summary'
let sum: Win<Line> | null = null
let flow: Win<Entry> | null = null
let flowBlocks: Block[] = []
let event: { o: number; n?: number; pages: string[]; page: number } | null = null
let gone = false
let timer: Timer | null = null
let busy = false

const helperPath = ($: EngineInterface) => `${$.plugin.root}/scripts/cli-dispatch-pane-read.mjs`

async function helper($: EngineInterface, mode: string, ...args: (string | number)[]): Promise<any[] | null> {
  try {
    const r = await $.process.run(['node', helperPath($), mode, ...args.map(String)], { timeoutMs: 10_000 })
    if (r.exitCode !== 0) return null
    return r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch {
    return null
  }
}

// ---- the run list ----

// Status and verdict are re-read only when their mtime moved; the worker pid answers for a quiet run.
async function sync($: EngineInterface, r: Run, now: number): Promise<boolean> {
  let st
  try {
    st = await $.fs.stat(`${r.dir}/status.json`)
  } catch {
    return false
  }
  if (st.mtimeMs !== r.statusM) {
    const s = await readJson($, `${r.dir}/status.json`)
    if (s) {
      r.status = s
      r.statusM = st.mtimeMs
    }
  }
  try {
    const v = await $.fs.stat(`${r.dir}/verdict.json`)
    if (v.mtimeMs !== r.verdictM) {
      r.verdict = await readJson($, `${r.dir}/verdict.json`)
      r.verdictM = v.mtimeMs
    }
  } catch {
    /* no verdict yet */
  }
  if (r.status) r.alive = await isRunAlive($, { dir: r.dir, meta: {}, status: r.status, mtimeMs: r.statusM }, now)
  return true
}

// A linked worktree's `.git` is a file, `gitdir: <main>/.git/worktrees/<name>`; meta and verdict carry
// no field for the main repo, and reading this file spawns nothing. Null for anything else.
async function mainRepoOf($: EngineInterface, cwd: string): Promise<string | null> {
  if (!cwd) return null
  try {
    const m = /^gitdir:\s*(\/.+?)\/\.git\/worktrees\/[^/\n]+\/?\s*$/m.exec(await $.fs.read(`${cwd}/.git`))
    return m ? m[1]! : null
  } catch {
    return null
  }
}

async function refreshList($: EngineInterface) {
  const root = await sessionsRoot($)
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(root)
  } catch {
    entries = []
  }
  const sid = await $.session.id()
  const now = await $.clock.now()
  const names = new Set<string>()
  for (const ent of entries) {
    if (ent.kind !== 'dir' || ent.name.startsWith('.') || ent.name === 'verdict-archive') continue
    names.add(ent.name)
    let r = seen.get(ent.name)
    if (r === 'other') continue
    const dir = `${root}/${ent.name}`
    if (!r) {
      const meta = await readJson($, `${dir}/meta.json`)
      if (!meta) continue // the parser is still starting: ask again next time
      if (meta.parentSessionId !== sid) {
        seen.set(ent.name, 'other')
        continue
      }
      const one = (s: unknown) => clean(String(s ?? '')).replace(/\s+/g, ' ').trim()
      r = {
        name: ent.name,
        dir,
        sessionId: meta.sessionId,
        parentSessionId: meta.parentSessionId,
        backend: String(meta.backend ?? ''),
        label: BACKENDS[meta.backend] ?? one(meta.backend ?? '?'),
        model: one(meta.model),
        branch: one(meta.branch),
        repo: one(String((await mainRepoOf($, String(meta.cwd ?? ''))) ?? meta.cwd ?? '').split('/').filter(Boolean).pop() ?? ''),
        origName: ent.name,
        runDir: '',
        runScanAt: -Infinity,
        verifying: false,
        prompt: one(meta.promptPreview),
        startedAt: String(meta.startedAt ?? ''),
        status: null,
        statusM: -1,
        verdict: null,
        verdictM: -1,
        alive: false,
      }
      seen.set(ent.name, r)
    }
    await sync($, r, now)
  }
  for (const k of [...seen.keys()]) if (!names.has(k)) seen.delete(k)
  rows = [...seen.values()].filter((r): r is Run => r !== 'other' && r.status !== null).sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.name < b.name ? 1 : -1))
}

// ---- windows over progress.log and transcript.jsonl ----

const fileOf = (r: Run, t: Tab) => `${r.dir}/${t === 'summary' ? 'progress.log' : 'transcript.jsonl'}`
const budgetOf = (t: Tab) => (t === 'summary' ? SUMMARY_WINDOW : FLOW_WINDOW)

// One transcript line becomes one entry the moment it arrives; only masked text is kept.
function toEntry(r: Run, rec: Rec): Entry {
  let ev: any
  try {
    ev = rec.big ? undefined : JSON.parse(rec.t)
  } catch {
    ev = undefined
  }
  const base = { o: rec.o, l: rec.l, big: rec.big === true }
  if (ev === undefined || ev === null || typeof ev !== 'object') return { ...base, kind: 'event', type: '?', head: '', text: clean(rec.t), tag: 'other' }
  const type = String(ev.type ?? ev.kind ?? '?')
  const { tag, exit } = classify(type, ev)
  if (CLAUDE_STREAM.has(r.backend) && type === 'stream_event') return { ...base, kind: 'skip', type, head: '', text: '', tag }
  if (r.label === 'cp' && type === 'assistant.message_delta') return { ...base, kind: 'skip', type, head: '', text: '', tag }
  if (r.label === 'cp' && type.endsWith('_delta')) return { ...base, kind: 'delta', type, head: '', text: clean(String(ev.deltaContent ?? ev.data?.deltaContent ?? '')), tag }
  const shown = contentOf(type, ev)
  if (shown === 'hide') return { ...base, kind: 'hidden', type, head: '', text: '', tag }
  if (shown) return { ...base, kind: 'event', type, head: clean(shown.head), text: clean(shown.text), tag: shown.tag, exit: shown.exit, key: shown.key, pending: shown.pending }
  return { ...base, kind: 'event', type, head: clean(type), text: clean(renderEvent(ev)), tag, exit }
}

// ---- Full flow content: what an event SAYS, not its fields ----
// Shapes are the ones the parsers read: codex item.*, claude stream-json (deepseek, ollama), copilot
// assistant.*/tool.*, opencode part events, antigravity transcript steps. null = unknown shape, which
// falls back to renderEvent's field listing; 'hide' = an event with no content.
type Shown = { tag: Tag; head: string; text: string; exit?: number; key?: string; pending?: boolean }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const lines = (...parts: string[]) => parts.filter(p => p !== '').join('\n')
const indented = (s: string) => s.split('\n').map(l => `  ${l}`).join('\n')

// A tool's input: its command line when that is all there is, else its fields.
function inputText(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || typeof v !== 'object') return v === undefined || v === null ? '' : String(v)
  const o = v as Record<string, unknown>
  if (typeof o.command === 'string' && Object.keys(o).length === 1) return o.command
  return Object.keys(o).length ? renderEvent(o) : ''
}

// A result's content: a string, or a list of text parts.
function contentText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(x => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : renderEvent(x))).join('\n')
  if (c !== null && typeof c === 'object') return renderEvent(c)
  return c === undefined || c === null ? '' : String(c)
}

function contentOf(type: string, ev: any): Shown | 'hide' | null {
  const model = (text: string): Shown | 'hide' => (text.trim() ? { tag: 'model', head: 'model', text } : 'hide')
  const tool = (name: string, text: string, extra: Partial<Shown> = {}): Shown | 'hide' => (text.trim() || name ? { tag: 'other', head: `tool ${name}`.trim(), text, ...extra } : 'hide')

  // codex
  if (/^(thread|turn)\.(started|completed)$/.test(type)) return 'hide'
  const item = ev.item
  if (/^item\.(started|updated|completed)$/.test(type) && item && typeof item === 'object') {
    const pending = type !== 'item.completed'
    const key = item.id != null ? `${item.type}:${item.id}` : undefined
    switch (item.type) {
      case 'agent_message':
      case 'reasoning': {
        const m = model(str(item.text) || str(item.summary))
        return m === 'hide' ? m : { ...m, key, pending }
      }
      case 'command_execution': {
        const out = str(item.aggregated_output)
        const x = item.exit_code ?? item.exitCode
        return { tag: 'komut', head: 'komut', text: lines(`$ ${str(item.command ?? item.cmd)}`, out), exit: typeof x === 'number' ? x : undefined, key, pending }
      }
      case 'file_change': {
        const ch = Array.isArray(item.changes) ? item.changes : []
        return { tag: 'other', head: 'file_change', text: ch.map((c: any) => `${str(c?.kind)} ${str(c?.path ?? c?.file)}`.trim()).join('\n') || str(item.path), key, pending }
      }
      case 'mcp_tool_call':
        return { tag: 'other', head: `tool ${item.server ? `${item.server}/` : ''}${str(item.tool ?? item.name)}`, text: lines(inputText(item.arguments ?? item.input), contentText(item.result?.content ?? item.result ?? item.error?.message ?? '')), key, pending }
      case 'web_search':
        return { tag: 'other', head: 'web_search', text: str(item.query ?? item.q), key, pending }
      case 'todo_list': {
        const li = Array.isArray(item.items) ? item.items : Array.isArray(item.todos) ? item.todos : []
        return { tag: 'other', head: 'todo_list', text: li.map((t: any) => `[${t?.completed ? 'x' : ' '}] ${str(t?.text)}`).join('\n'), key, pending }
      }
      case 'error':
        return { tag: 'other', head: 'error', text: str(item.message) || str(item.error?.message) || str(item.error) }
      default:
        return null
    }
  }

  // claude stream-json
  if ((type === 'assistant' || type === 'user') && ev.message && typeof ev.message === 'object') {
    const c = ev.message.content
    const blocks: any[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []
    if (blocks.length === 0) return null
    if (type === 'assistant') {
      const say: string[] = []
      const tools: string[] = []
      const names: string[] = []
      for (const b of blocks) {
        if (b?.type === 'text') say.push(str(b.text))
        else if (b?.type === 'thinking') say.push(`✻ ${str(b.thinking)}`)
        else if (b?.type === 'tool_use') {
          names.push(str(b.name))
          tools.push(lines(`▸ ${str(b.name)}`, indented(inputText(b.input))))
        } else return null
      }
      const text = lines(...say, ...tools)
      if (say.length) return model(text)
      return tool(names.join(', '), tools.length === 1 ? inputText(blocks[0].input) : text)
    }
    const out: string[] = []
    let head = 'result'
    for (const b of blocks) {
      if (b?.type === 'tool_result') {
        out.push(contentText(b.content))
        if (b.is_error) head = 'result (error)'
      } else if (b?.type === 'text') {
        out.push(str(b.text))
        head = 'user'
      } else return null
    }
    return { tag: 'other', head, text: out.join('\n') }
  }
  if (type === 'system') return 'hide'

  // copilot
  const d = ev.data && typeof ev.data === 'object' ? ev.data : {}
  if (/^session\./.test(type) || /^assistant\.turn_(start|end)$/.test(type)) return 'hide'
  if (type === 'assistant.message') return model(str(d.content))
  if (type === 'assistant.reasoning') return model(str(d.content) ? `✻ ${str(d.content)}` : '')
  if (type === 'user.message') return str(d.content) ? { tag: 'other', head: 'user', text: str(d.content) } : 'hide'
  if (type === 'tool.execution_start') return tool(str(d.toolName ?? d.name), inputText(d.arguments ?? d.input))
  if (type === 'tool.execution_complete') {
    const res = d.result
    const body = typeof res === 'string' ? res : res && typeof res === 'object' ? contentText(res.content ?? res.detailedContent ?? res) : contentText(d.error?.message ?? d.error ?? '')
    return { tag: 'other', head: d.success === false ? 'result (error)' : 'result', text: body }
  }

  // opencode
  if (type === 'step_start' || type === 'step_finish') return 'hide'
  if (type === 'text' && ev.part && typeof ev.part === 'object') return model(str(ev.part.text))
  if (type === 'tool_use' && ev.part && typeof ev.part === 'object') {
    const p = ev.part
    const st = p.state && typeof p.state === 'object' ? p.state : {}
    const name = str(p.tool) || 'tool'
    const key = p.callID ? `oc:${p.callID}` : undefined
    if (st.status === 'error') return tool(`${name} (error)`, contentText(st.error ?? st.output ?? ''), { key })
    const done = st.status === 'completed'
    return tool(name, lines(inputText(st.input), done ? contentText(st.output ?? '') : ''), { key, pending: !done })
  }

  // antigravity
  if (ev.source !== undefined && typeof ev.type === 'string' && /^[A-Z_]+$/.test(ev.type)) {
    if (ev.type === 'USER_INPUT' || ev.type === 'CONVERSATION_HISTORY' || ev.type === 'CHECKPOINT') return 'hide'
    if (ev.type === 'PLANNER_RESPONSE') {
      const calls = (Array.isArray(ev.tool_calls) ? ev.tool_calls : []).map((tc: any) => `▸ ${str(tc?.name) || 'tool'}${str(tc?.args?.toolSummary ?? tc?.args?.toolAction) ? ` ${str(tc?.args?.toolSummary ?? tc?.args?.toolAction)}` : ''}`)
      const text = lines(...(str(ev.thinking) ? [`✻ ${str(ev.thinking)}`] : []), str(ev.content), ...calls)
      if (str(ev.content).trim() || str(ev.thinking).trim()) return model(text)
      return calls.length ? { tag: 'other', head: 'tool', text: calls.join('\n') } : 'hide'
    }
    if (ev.type === 'CODE_ACTION') return str(ev.content) ? { tag: 'other', head: 'result', text: str(ev.content) } : 'hide'
  }
  return null
}

// What a full-flow block is called: a command (with its exit code, once known), a model turn, or
// anything else under its own type name.
function classify(type: string, ev: any): { tag: Tag; exit?: number } {
  const item = ev?.item
  if (item?.type === 'command_execution' || /tool|command|exec/i.test(type)) {
    const x = item?.exit_code ?? ev?.exit_code ?? ev?.exitCode ?? ev?.data?.exitCode
    return { tag: 'komut', exit: typeof x === 'number' ? x : undefined }
  }
  if (item?.type === 'agent_message' || item?.type === 'reasoning' || /assistant|message|reasoning|thinking|text/i.test(type)) return { tag: 'model' }
  return { tag: 'other' }
}

// progress.log writes `$ cmd` when a command starts and `$ cmd (exit K)` when it ends. The pane shows
// one line per command: a start line gives way to the next completion of the same command (FIFO),
// and a start with no completion yet stays, dim, as the running one.
function mergeCommands(ls: Line[]): Line[] {
  const open = new Map<string, number[]>()
  const drop = new Set<number>()
  ls.forEach((l, i) => {
    const done = /^\$ (.*) \(exit [^)]*\)\s*$/.exec(l.t)
    if (done) {
      const q = open.get(done[1]!)
      if (q?.length) drop.add(q.shift()!)
    } else if (l.t.startsWith('$ ')) {
      const q = open.get(l.t.slice(2)) ?? []
      q.push(i)
      open.set(l.t.slice(2), q)
    }
  })
  return drop.size ? ls.filter((_, i) => !drop.has(i)) : ls
}

// Skipped runs become one dim row; consecutive deltas of one kind become one block. Hidden events
// draw nothing (and do not split a skipped run); a started record gives way to its finished one.
// A block's n is the ordinal of its first event among the loaded ones (n0 for those dropped before).
function blocksOf(items: Entry[], n0 = 0): Block[] {
  const numbered = items.map((e, i) => ({ e, n: n0 + i + 1 })).filter(x => x.e.kind !== 'hidden')
  const finished = new Set(numbered.filter(x => x.e.key && !x.e.pending).map(x => x.e.key))
  const shown = numbered.filter(x => !(x.e.pending && x.e.key && finished.has(x.e.key)))
  const out: Block[] = []
  let i = 0
  while (i < shown.length) {
    const { e, n } = shown[i]!
    if (e.kind === 'skip') {
      let c = 0
      while (i < shown.length && shown[i]!.e.kind === 'skip') { c++; i++ }
      out.push({ o: e.o, n, head: '', text: '', skipped: c, tag: 'other' })
    } else if (e.kind === 'delta') {
      let text = ''
      while (i < shown.length && shown[i]!.e.kind === 'delta' && shown[i]!.e.type === e.type) { text += shown[i]!.e.text; i++ }
      out.push({ o: e.o, n, head: clean(`${e.type} (merged)`), text: clean(text), tag: e.tag })
    } else {
      out.push({ o: e.o, n, head: e.head, text: e.text, l: e.l, big: e.big, tag: e.tag, exit: e.exit })
      i++
    }
  }
  return out
}

function setWin(t: Tab, w: Win<any>) {
  if (t === 'summary') sum = w
  else {
    flow = w
    flowBlocks = blocksOf(w.items, w.n0 ?? 0)
  }
}
const winOf = (t: Tab): Win<any> | null => (t === 'summary' ? sum : flow)
const convert = (r: Run, t: Tab, rec: Rec) => (t === 'summary' ? ({ o: rec.o, t: clean(rec.t) } as Line) : toEntry(r, rec))

async function loadBack($: EngineInterface, r: Run, t: Tab, end: number, follow: boolean) {
  const res = await helper($, 'back', fileOf(r, t), end, budgetOf(t))
  if (!res) return
  const [h, ...rows] = res
  setWin(t, { from: h.from, to: h.to, size: h.size, follow, items: rows.map((x: Rec) => convert(r, t, x)) })
}

async function openTab($: EngineInterface, r: Run, t: Tab) {
  if (winOf(t)) return
  let size = 0
  try {
    size = (await $.fs.stat(fileOf(r, t))).size
  } catch {
    /* not written yet: the tick picks it up */
  }
  if (size > 0) await loadBack($, r, t, size, true)
  else setWin(t, { from: 0, to: 0, size: 0, follow: true, items: [] })
}

// The shown tab's file only; nothing is read when its size has not moved.
async function followTab($: EngineInterface, r: Run, t: Tab) {
  const w = winOf(t)
  if (!w || !w.follow) return
  let size: number
  try {
    size = (await $.fs.stat(fileOf(r, t))).size
  } catch {
    return
  }
  if (size < w.to) return loadBack($, r, t, size, true) // rewritten by a fresh run in a reused dir
  if (size === w.size) return
  const res = await helper($, 'fwd', fileOf(r, t), w.to, budgetOf(t))
  if (!res) return
  const [h, ...rows] = res
  const items = [...w.items, ...rows.map((x: Rec) => convert(r, t, x))]
  let n0 = w.n0 ?? 0
  while (items.length > 1 && h.to - items[0]!.o > budgetOf(t)) { items.shift(); n0++ }
  setWin(t, { from: items.length ? items[0]!.o : h.to, to: h.to, size: h.size, follow: true, items, n0 })
}

// The Codex stream renames its provisional dir to the real thread id when the worker finishes;
// meta.json comes along unchanged, so sessionId + parentSessionId find the run under its new name.
async function reresolve($: EngineInterface, r: Run): Promise<boolean> {
  if (r.sessionId == null || r.parentSessionId == null) return false
  const root = await sessionsRoot($)
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(root)
  } catch {
    return false
  }
  for (const ent of entries) {
    if (ent.kind !== 'dir' || ent.name.startsWith('.') || ent.name === 'verdict-archive' || ent.name === r.name || seen.get(ent.name) === 'other') continue
    const meta = await readJson($, `${root}/${ent.name}/meta.json`)
    if (!meta || meta.sessionId !== r.sessionId || meta.parentSessionId !== r.parentSessionId) continue
    seen.delete(r.name)
    r.name = ent.name
    r.dir = `${root}/${ent.name}`
    r.statusM = -1
    r.verdictM = -1
    seen.set(r.name, r)
    sum = null
    flow = null
    flowBlocks = []
    return true
  }
  return false
}

async function refreshRun($: EngineInterface) {
  const r = sel
  if (!r || gone) return
  let present = await sync($, r, await $.clock.now())
  if (!present && (await reresolve($, r))) {
    present = await sync($, r, await $.clock.now())
    if (present) await openTab($, r, tab)
  }
  if (!present) {
    gone = true
    return
  }
  await checkVerifying($, r, await $.clock.now())
  await followTab($, r, tab)
}

async function tick($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    if (view === 'list') await refreshList($)
    else if (view === 'run') await refreshRun($)
  } catch {
    /* the next tick tries again */
  } finally {
    busy = false
  }
  $.ui.invalidate('ui.render')
}

// ---- events ----

function setEvent(o: number, text: string, n?: number) {
  const pages: string[] = []
  let rest = text
  while (rest.length > EVENT_PAGE) {
    const nl = rest.lastIndexOf('\n', EVENT_PAGE)
    const cut = nl < EVENT_PAGE / 2 ? EVENT_PAGE : nl
    pages.push(rest.slice(0, cut))
    rest = rest.slice(cut === nl ? cut + 1 : cut)
  }
  pages.push(rest)
  event = { o, n, pages, page: 0 }
}

// The newest entries whose text fits one drawing (at least one).
function tailFit<T>(items: T[], size: (x: T) => number): T[] {
  let used = 0
  let i = items.length
  while (i > 0 && (used + size(items[i - 1]!) <= DRAW_MAX || i === items.length)) used += size(items[--i]!)
  return items.slice(i)
}

async function range($: EngineInterface, file: string, off: number, len: number, first = ''): Promise<string | null> {
  let out = first
  let cur = off
  for (let i = 0; i < 64 && cur < off + len; i++) {
    const res = await helper($, 'chunk', file, cur, off + len - cur)
    if (!res) return null
    out += res[1].t
    if (res[0].next == null) break
    cur = res[0].next
  }
  return out
}

// Masking runs on the assembled text, so a key split across a chunk edge is still caught.
function showRaw(o: number, raw: string, n?: number) {
  let text: string
  try {
    // The same content view as Full flow; an unknown shape keeps the field listing.
    const ev = JSON.parse(raw)
    const shown = ev && typeof ev === 'object' ? contentOf(String(ev.type ?? ev.kind ?? '?'), ev) : null
    text = shown && shown !== 'hide' ? `${shown.text}${shown.exit !== undefined ? `\n\nexit ${shown.exit}` : ''}` : renderEvent(ev)
  } catch {
    text = raw
  }
  setEvent(o, clean(text), n)
}

async function openLine($: EngineInterface, r: Run, o: number) {
  const res = await helper($, 'event', r.dir, o)
  const first = res?.[0]
  if (!res || !first || first.none) return setEvent(o, 'No full event recorded for this line.')
  if (typeof first.text === 'string') return setEvent(o, clean(first.text))
  const part = res[1] ?? { t: '', next: null }
  const raw = part.next == null ? part.t : await range($, `${r.dir}/transcript.jsonl`, part.next, first.o + first.l - part.next, part.t)
  if (raw === null) setEvent(o, 'The event could not be read.')
  else showRaw(o, raw)
}

async function openBig($: EngineInterface, r: Run, b: Block) {
  const raw = await range($, `${r.dir}/transcript.jsonl`, b.o, b.l ?? 0)
  if (raw === null) setEvent(b.o, 'The event could not be read.', b.n)
  else showRaw(b.o, raw, b.n)
}

// The worker is done but the run is still verifying: no verdict yet and the detached runner's process
// is alive. The run's bookkeeping dir is found by its `session` file; a scan costs one listing, at most
// every 5 s, and only for a finished run without a verdict.
async function checkVerifying($: EngineInterface, r: Run, now: number) {
  r.verifying = false
  if (r.status?.state === 'running' || r.verdict) return
  const root = await sessionsRoot($)
  if (!r.runDir && now - r.runScanAt >= 5000) {
    r.runScanAt = now
    let ents: { name: string; kind: string }[] = []
    try {
      ents = await $.fs.list(`${root}/.runs`)
    } catch {
      return
    }
    for (const ent of ents) {
      if (ent.kind !== 'dir') continue
      const sess = ((await readText($, `${root}/.runs/${ent.name}/session`)) ?? '').trim().split('/').pop()
      if (sess && [r.name, r.origName, String(r.sessionId)].includes(sess)) {
        r.runDir = `${root}/.runs/${ent.name}`
        break
      }
    }
  }
  if (!r.runDir || (await readText($, `${r.runDir}/exit`)) !== null) return
  const pid = ((await readText($, `${r.runDir}/pid`)) ?? '').trim()
  r.verifying = /^\d+$/.test(pid) && (await $.process.run(['kill', '-0', pid])).exitCode === 0
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// ---- entry points ----

async function openRuns($: EngineInterface) {
  view = 'list'
  sel = null
  sum = null
  flow = null
  flowBlocks = []
  event = null
  gone = false
  await refreshList($)
  if (!timer) timer = $.clock.every(PANE_TICK_MS, () => void tick($))
}

function closeRuns() {
  timer?.cancel()
  timer = null
}

// Table columns, in characters; the hotkey prefix a plain Button draws ("1: ") is three more.
const COLS = [12, 16, 9, 10] as const
const PREFIX = '   '
const FOOTER = '↑↓ / tık: run seç · satır: tam metin · b: geri · Esc: kapat'
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const cell = (s: string, i: number) => clip(s, COLS[i]! - 1).padEnd(COLS[i]!)

async function renderRuns($: EngineInterface, e: any) {
  const now = await $.clock.now()
  const { Box, Text, Button } = $.ui.resolve(e)
  const redraw = () => $.ui.invalidate('ui.render')
  const go = (fn: () => Promise<void> | void) => async () => {
    await fn()
    redraw()
  }
  const rule = <Text dimColor>{'─'.repeat(60)}</Text>
  const footer = <Text dimColor>{FOOTER}</Text>

  // The run table: one selectable row per run, the open run inverted, its prompt dim beneath.
  const table = (
    <Box flexDirection="column">
      <Text dimColor>{`${PREFIX}${'BACKEND'.padEnd(COLS[0])}${'REPO'.padEnd(COLS[1])}${'STATE'.padEnd(COLS[2])}${'VERIFY'.padEnd(COLS[3])}SÜRE`}</Text>
      {rows.length === 0 ? <Text>No cli-dispatch runs in this session yet.</Text> : null}
      {rows.map((r, i) => {
        const running = r.status.state === 'running'
        const live = running && r.alive
        const verify = running ? '…' : (verifyOf(r.verdict) ?? '–')
        const vcolor = verify === 'PASS' ? 'green' : verify === 'FAIL' || verify === 'LEAK' ? 'red' : undefined
        const on = sel === r
        const prompt = r.prompt.length > 60 ? `${r.prompt.slice(0, 60)}…` : r.prompt
        return (
          <Box key={`row:${r.name}`} flexDirection="column">
            <Button
              key={`run:${r.name}`}
              plain
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={go(async () => {
                sel = r
                tab = 'summary'
                sum = null
                flow = null
                flowBlocks = []
                event = null
                gone = false
                view = 'run'
                await openTab($, r, 'summary')
                await checkVerifying($, r, await $.clock.now())
              })}
            >
              {i < 9 ? '' : PREFIX}
              <Text inverse={on} bold={on} color={live ? 'yellow' : undefined} dimColor={running && !live}>{cell(`${live ? '▶' : running ? '?' : '■'} ${r.label}`, 0)}</Text>
              <Text inverse={on} bold={on}>{cell(r.repo, 1)}</Text>
              <Text inverse={on} bold={on}>{cell(running ? (live ? 'running' : 'stale') : String(r.status.state ?? '?'), 2)}</Text>
              <Text inverse={on} bold={on} color={vcolor} dimColor={vcolor === undefined}>{cell(verify, 3)}</Text>
              <Text inverse={on} bold={on}>{elapsed(r.startedAt, running ? now : Math.max(r.startedAt ? Date.parse(r.startedAt) : 0, r.statusM))}</Text>
            </Button>
            {prompt ? <Text dimColor wrap="truncate-end">{`${PREFIX}${prompt}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )

  if (view === 'list') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {table}
        {footer}
      </Box>
    )
  }

  const r = sel
  if (!r) return <Box flexDirection="column" />
  const kv = (k: string, ...vals: any[]) => (
    <Box key={`kv:${k}`} flexDirection="row">
      <Text dimColor>{k.padEnd(14)}</Text>
      {vals}
    </Box>
  )
  const back = (
    <Button key="back" plain hotkey="b" onPress={go(() => { if (event) event = null; else view = 'list' })}>
      geri
    </Button>
  )

  // Run detail: header and facts, the view switch, the opened event, the shown view, the verdict once there is one.
  const st = r.status ?? {}
  const running = st.state === 'running'
  const counts = Object.entries(st.toolCounts ?? {}).map(([k, n]) => `${k}×${n}`)
  const commands = Object.values(st.toolCounts ?? {}).reduce((a: number, n) => a + (typeof n === 'number' ? n : 0), 0)
  const idle = st.lastActivityAt ? `${ago(now - Date.parse(st.lastActivityAt))} önce` : '–'
  const hasTokens = st.usage && (st.usage.input_tokens != null || st.usage.output_tokens != null)
  const facts = [
    kv('session', <Text>{clean(String(st.sessionId ?? r.name))}</Text>),
    kv('olay', <Text>{String(st.events ?? 0)}</Text>, <Text dimColor>{' · komut '}</Text>, <Text>{String(commands)}</Text>, counts.length ? <Text dimColor>{` (${clean(counts.join(' '))})`}</Text> : null),
    kv('son aktivite', <Text>{running ? clean(idle) : r.verifying && !r.verdict ? 'verify sürüyor' : 'bitti'}</Text>, running && st.lastTool ? <Text dimColor>{clean(` · ${st.lastTool}`)}</Text> : null),
    hasTokens ? kv('tokens', <Text>{`in ${st.usage.input_tokens ?? '?'} · out ${st.usage.output_tokens ?? '?'}`}</Text>) : null,
    st.toolErrors ? kv('tool errors', <Text color="red">{String(st.toolErrors)}</Text>) : null,
  ]

  const v = r.verdict
  const verdict: any[] = []
  if (v) {
    if (v.error !== undefined && v.state === undefined) verdict.push(<Text key="verr" color="red">{clean(`verdict not built: ${v.error}`)}</Text>)
    else {
      const label = verifyOf(v)
      const color = label === 'PASS' ? 'green' : label === 'FAIL' || label === 'LEAK' ? 'red' : undefined
      const fail = label === 'FAIL' && v.verify?.exitCode ? ` (cmd ${Number.isInteger(v.verify.failedAt) ? v.verify.failedAt + 1 : '?'}: ${v.verify.commands?.[v.verify.failedAt] ?? '?'})` : ''
      verdict.push(kv('verify', <Text bold color={color}>{String(label)}</Text>, fail ? <Text>{clean(fail)}</Text> : null))
      if (v.verify?.exitCode != null) verdict.push(kv('exit', <Text>{String(v.verify.exitCode)}</Text>))
      if (v.diffstat) verdict.push(kv('diff', <Text>{clean(String(v.diffstat))}</Text>))
      if (v.stranded) verdict.push(kv('stranded', <Text>{clean(String(v.worktree ?? 'the worktree'))}</Text>))
      const bad = Array.isArray(v.scopeViolations) && v.scopeViolations.length > 0
      if (bad) verdict.push(kv('scope', <Text color="red">{clean(v.scopeViolations.join(' '))}</Text>, Array.isArray(v.scope) ? <Text dimColor>{clean(` (${v.scope.join(' ')})`)}</Text> : null))
      else if (Array.isArray(v.scope)) verdict.push(kv('scope', <Text>{clean(v.scope.join(' '))}</Text>))
      if (v.fixAttempts) verdict.push(kv('fix attempts', <Text>{`${v.fixAttempts.used}/${v.fixAttempts.max}`}</Text>))
      if (v.exitCode !== undefined) verdict.push(kv('runner exit', <Text>{String(v.exitCode)}</Text>))
    }
  }

  const w = winOf(tab)
  const merged = tab === 'summary' ? mergeCommands(sum?.items ?? []) : []
  const shownLines = tab === 'summary' ? tailFit(merged, l => l.t.length + 1) : []
  const shownBlocks = tab === 'flow' ? tailFit(flowBlocks, b => b.head.length + b.text.length + 40) : []
  // Entries above the drawn ones are reached with `earlier`, which ends where the drawn ones begin.
  const shownFrom = tab === 'summary' ? shownLines[0]?.o : shownBlocks[0]?.o
  const hidden = tab === 'summary' ? shownLines.length < merged.length : shownBlocks.length < flowBlocks.length
  const nav = (
    <Box flexDirection="row" gap={2}>
      {w && (w.from > 0 || hidden) && shownFrom !== undefined && shownFrom > 0 ? (
        <Button key="earlier" plain hotkey="e" onPress={go(async () => {
          const res = await helper($, 'back', fileOf(r, tab), shownFrom, budgetOf(tab))
          if (!res) return
          const [h, ...rs] = res
          setWin(tab, { from: h.from, to: h.to, size: h.size, follow: false, items: rs.map((x: Rec) => convert(r, tab, x)) })
        })}>
          earlier
        </Button>
      ) : null}
      {w && !w.follow ? (
        <Button key="latest" plain hotkey="l" onPress={go(async () => {
          let size = 0
          try { size = (await $.fs.stat(fileOf(r, tab))).size } catch { /* gone */ }
          await loadBack($, r, tab, size, true)
        })}>
          latest
        </Button>
      ) : null}
    </Box>
  )

  const streaming = running && r.alive ? <Text color="yellow">▍ akış sürüyor…</Text> : null
  const lineView = (l: Line) => {
    const exit = /\(exit (\d+)\)\s*$/.exec(l.t)
    const cmd = l.t.startsWith('$ ')
    const color = !cmd ? undefined : exit ? (exit[1] === '0' ? 'green' : 'red') : undefined
    return (
      <Button key={`line:${l.o}`} plain onPress={go(() => openLine($, r, l.o))}>
        {l.t.startsWith('· ') ? <Text dimColor>{'· '}</Text> : null}
        <Text wrap="truncate-end" color={color} dimColor={cmd && !exit}>{l.t.startsWith('· ') ? l.t.slice(2) : l.t}</Text>
      </Button>
    )
  }
  const blockHead = (b: Block) =>
    b.tag === 'model' ? (
      <Box flexDirection="row">
        <Text color="cyan">model</Text>
        <Text dimColor>{` · olay ${b.n}`}</Text>
      </Box>
    ) : b.tag === 'komut' ? (
      <Box flexDirection="row">
        <Text color="yellow">komut</Text>
        <Text dimColor>{` · olay ${b.n}`}</Text>
        {b.exit !== undefined ? <Text dimColor>{' · exit '}</Text> : null}
        {b.exit !== undefined ? <Text color={b.exit === 0 ? 'green' : 'red'}>{String(b.exit)}</Text> : null}
      </Box>
    ) : (
      <Text dimColor>{`${b.head ? `${b.head} · ` : ''}olay ${b.n}`}</Text>
    )

  const ev = event
  const pages = ev?.pages ?? ['']
  const at = ev?.page ?? 0
  const turn = (by: number) => go(() => { if (event) event.page = Math.min(pages.length - 1, Math.max(0, at + by)) })
  const eventBox = ev ? (
    <Box key="eventbox" flexDirection="column" borderStyle="round" paddingX={1}>
      <Box flexDirection="row" gap={2}>
        <Text bold>{`Tam metin${ev.n ? ` · olay ${ev.n}` : ''} · transcript.jsonl`}</Text>
        <Button key="event-back" plain hotkey="g" onPress={go(() => { event = null })}>
          geri
        </Button>
        {pages.length > 1 ? (
          <Button key="prev" plain hotkey="p" onPress={turn(-1)}>
            previous page
          </Button>
        ) : null}
        {pages.length > 1 ? (
          <Button key="next" plain hotkey="n" onPress={turn(1)}>
            next page
          </Button>
        ) : null}
      </Box>
      {pages.length > 1 ? <Text dimColor>{`page ${at + 1}/${pages.length}`}</Text> : null}
      <Text wrap="wrap">{pages[at] ?? ''}</Text>
    </Box>
  ) : null

  const pick = (t: Tab) => go(async () => { tab = t; event = null; await openTab($, r, t) })
  return (
    <Box flexDirection="column" paddingX={1}>
      {table}
      {rule}
      <Box key="detail" flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text bold>{`${r.label} · ${r.repo}`}</Text>
          <Text dimColor>{clean(`${r.model} ${r.branch}`.trim())}</Text>
        </Box>
        {facts}
        {gone ? <Text color="red">session dir is gone</Text> : null}
        <Box flexDirection="row" gap={2} marginTop={1}>
          {back}
          <Button key="tab:summary" hotkey="s" variant={tab === 'summary' ? 'primary' : 'secondary'} onPress={pick('summary')}>
            {tab === 'summary' ? '● Özet' : 'Özet'}
          </Button>
          <Button key="tab:flow" hotkey="f" variant={tab === 'flow' ? 'primary' : 'secondary'} onPress={pick('flow')}>
            {tab === 'flow' ? '● Tüm akış' : 'Tüm akış'}
          </Button>
        </Box>
        {eventBox}
        {nav}
        {tab === 'summary' ? (
          <Box flexDirection="column">
            <Text dimColor>Özet (progress.log) · satıra tıklayınca o olayın tam hali açılır</Text>
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              {shownLines.map(lineView)}
              {streaming}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>Tüm akış (transcript.jsonl) · her olay kırpılmadan, sırayla</Text>
            {shownBlocks.map(b =>
              b.skipped ? (
                <Text key={`skip:${b.o}`} dimColor>{`${b.skipped} stream events skipped`}</Text>
              ) : (
                <Box key={`blk:${b.o}`} flexDirection="column" marginTop={1}>
                  {blockHead(b)}
                  <Text wrap="wrap">{b.text}</Text>
                  {b.big ? (
                    <Button key={`big:${b.o}`} plain onPress={go(() => openBig($, r, b))}>
                      {`open full event (${Math.ceil((b.l ?? 0) / 1024)} KiB)`}
                    </Button>
                  ) : null}
                </Box>
              ),
            )}
            {streaming}
          </Box>
        )}
        {verdict.length ? rule : null}
        {verdict}
      </Box>
      {footer}
    </Box>
  )
}

// A fresh module (or a reload on a changed option) starts with nothing cached and its own mask.
function resetRuns(options: PluginOptions) {
  clean = makeClean(options)
  seen.clear()
  rows = []
  view = 'list'
  sel = null
  sum = null
  flow = null
  flowBlocks = []
  event = null
  gone = false
  timer = null
  busy = false
}


export const register: Register = (on, options) => {
  resetRuns(options)
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.every(TICK_MS, () => refresh($))
    // A worker can itself be a Claude Code session with this plugin (DeepSeek runs claude):
    // it must do its task, not delegate it again.
    const inWorker = (await $.env.get('CLI_DISPATCH_WORKER')) === '1'
    if (!inWorker) await $.tool.register(DISPATCH)
    // The run monitor drives no worker and holds no key, but a worker has no use for it.
    if (!inWorker) {
      try {
        await $.command.register({ name: PANE_ID, description: "Live view of this session's cli-dispatch runs", immediate: true })
      } catch {
        /* the command is a convenience */
      }
    }
    // The pane holds no key and cannot delegate, so it is offered inside a worker too. A refused
    // name must not take the dispatch tool down with it.
    try {
      await $.command.register({ name: 'cli-dispatch-config', description: 'cli-dispatch setup: backends, key status, models, install' })
    } catch {
      /* the command is a convenience */
    }
    return result
  })

  on('command.run', { command: 'cli-dispatch-config' }, async ($, e, next) => {
    await refreshSetup($, options, [])
    const opened = await $.ui.open({ id: 'setup', title: 'cli-dispatch setup', focus: true, closeOnEscape: true })
    return { text: opened.isPlaced ? 'cli-dispatch setup is open in a pane.' : `cli-dispatch setup could not be drawn: ${opened.reason}` }
  })

  on('command.run', { command: PANE_ID }, async ($, e, next) => {
    await openRuns($)
    const opened = await $.ui.open({ id: PANE_ID, title: 'cli-dispatch runs', focus: true, closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `cli-dispatch runs could not be drawn: ${opened.reason}` }
  })

  // Polling stops with the pane, however it closes (Esc, the close mark, an unload).
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE_ID) closeRuns()
    return result
  })

  on('tool.call', { tool: 'mcp__cli-dispatch__dispatch' }, async ($, e, next) => ({
    result: await dispatch($, e as unknown as DispatchInput, next.signal, options),
  })).catch(($, e, next) => (next.called ? next(e) : { deny: 'cli-dispatch: the dispatch tool failed before it could start a run.' }))

  on('tool.call', async ($, e, next) => {
    if (!EDIT_TOOLS.has(e.tool)) return next(e)
    const target = String((e as any).file_path ?? (e as any).notebook_path ?? '')
    if (!target.startsWith('/')) return next(e)
    const repos = await liveRepos($)
    if (repos.length === 0) return next(e)
    const path = await realPath($, target)
    for (const { repo, backend } of repos) {
      const root = await realPath($, repo)
      if (path === root || path.startsWith(`${root}/`)) {
        return {
          deny:
            `cli-dispatch: a ${backend} worktree run for ${root} is live. Editing that repo now makes the run's leak check ` +
            'blame the worker and skip verify. Wait for the run to finish (or kill it), then edit.',
        }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a broken guard must never block edits

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'setup') return next(e)
    const state = await read($, setup)
    if (!state || e.surface === 'mobile') return next(e) // mobile has no Input
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const toggle = (id: string) =>
      update($, setup, s => (s ? { ...s, selected: s.selected.includes(id) ? s.selected.filter(x => x !== id) : [...s.selected, id] } : s))
    const rows = SETUP_BACKENDS.map(b => {
      const s = state.backends.find(x => x.id === b.id)
      if (!s) return null
      const picked = state.selected.includes(b.id)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={2}>
            <Text bold>{b.name.padEnd(12)}</Text>
            <Text>{`${b.cli} ${mark(s.cliOk)}`}</Text>
            <Text>{`${b.wrapper} ${mark(s.wrapperOk)}`}</Text>
            {state.installable ? (
              <Button key={`install:${b.id}`} variant={picked ? 'primary' : 'secondary'} onPress={() => toggle(b.id)}>
                {picked ? 'install ✓' : 'install'}
              </Button>
            ) : null}
          </Box>
          <Text>{`  key: ${keyCell(b, s)}`}</Text>
          {state.configExists ? (
            <Box flexDirection="row" gap={2}>
              {b.models.map(m => (
                <Input key={m} label={m} value={s.models[m] ?? ''} placeholder="(default)" onSubmit={v => saveModel($, options, m, v.trim())} />
              ))}
            </Box>
          ) : null}
        </Box>
      )
    })
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Worker CLI and cli-dispatch wrapper installed? Key set? Keys are never shown.</Text>
        {rows}
        <Box flexDirection="column" marginTop={1}>
          {state.installable ? (
            <Box flexDirection="row" gap={2}>
              <Button key="install" variant="primary" onPress={() => installSelected($, options)}>
                {`Install selected (${state.selected.length})`}
              </Button>
              <Text dimColor>runs install.sh; it may add a PATH line to ~/.zshenv</Text>
            </Box>
          ) : (
            <Text dimColor>Install backends with /cli-dispatch:setup.</Text>
          )}
          <Text>{`Keys: set only in Claude Code's dialog — ${PLUGIN_CONFIGURE}`}</Text>
          <Text>{state.configExists ? `Models: saved to ${state.configPath}; every delegation path reads it.` : 'Models: no config file yet — run /cli-dispatch:setup.'}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    return renderRuns($, e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, workers)
    if (e.props.hasSurvey || list.length === 0) return next(e)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const parts = list.map(w => {
      if (w.state === 'running') return <Text color="yellow">{` ▶ ${w.backend} ${elapsed(w.startedAt, now)}`}</Text>
      const color = w.verify === 'PASS' ? 'green' : w.verify === 'FAIL' || w.verify === 'LEAK' ? 'red' : undefined
      return <Text color={color}>{` ■ ${w.backend} ${w.verify ?? w.state}`}</Text>
    })
    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color="cyan" bold>
          [CD]
        </Text>
        {parts}
      </Box>
    )
  })
}
