import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

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
    if (isLive(s, now)) {
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

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.every(TICK_MS, () => refresh($))
    // A worker can itself be a Claude Code session with this plugin (DeepSeek runs claude):
    // it must do its task, not delegate it again.
    if ((await $.env.get('CLI_DISPATCH_WORKER')) !== '1') await $.tool.register(DISPATCH)
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
