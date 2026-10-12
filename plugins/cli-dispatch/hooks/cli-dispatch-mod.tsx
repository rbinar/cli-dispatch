import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Worker } from '../types'

// cli-dispatch mod (Claude Code 2.1.287+): a band above the prompt with this session's workers;
// a guard that keeps Edit/Write out of a repo while a worktree run for it is live — the run's
// leak check would otherwise blame the worker and skip verify; and the `dispatch` tool, which
// runs cli-dispatch-run and waits for it in one call, with no forwarding subagent.

const workers = atom({ plugin: 'cli-dispatch', key: 'workers' } as const, [])

const STALE_SECS = 90 // same liveness window as cli-dispatch-statusline.sh
const RECENT_SECS = 600 // a finished run stays on the band this long
const TICK_MS = 4000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const BACKENDS: Record<string, string> = { deepseek: 'ds', antigravity: 'ag', codex: 'cx', opencode: 'oc', copilot: 'cp' }

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
    },
    required: ['backend', 'cwd', 'task'],
  },
} as const

type DispatchInput = { backend: string; cwd: string; task: string; verify?: string[]; model?: string }

// cli-dispatch-run from PATH, else the copy in this plugin (#150: a new binary not yet installed).
async function runner($: EngineInterface, args: string[], init: { env: Record<string, string>; timeoutMs: number }) {
  try {
    return await $.process.run(args, init)
  } catch {
    return $.process.run(['bash', `${$.plugin.root}/scripts/${args[0]}`, ...args.slice(1)], init)
  }
}

async function dispatch($: EngineInterface, input: DispatchInput, signal: AbortSignal): Promise<string> {
  if (!['ds', 'ag', 'cx', 'oc', 'cp'].includes(input.backend)) return `dispatch: backend must be one of ds, ag, cx, oc, cp (got ${input.backend})`
  if (!input.cwd?.startsWith('/')) return 'dispatch: cwd must be an absolute path'
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/$/, '')
  const brief = `${tmp}/cli-dispatch-brief-${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  await $.fs.write(brief, input.task)
  const argv = ['cli-dispatch-run', '--detach', '--backend', input.backend, '--cwd', input.cwd, '--prompt-file', brief, '--fix-attempts', '1']
  for (const v of input.verify ?? []) argv.push('--verify', v)
  if (input.model) argv.push('--model', input.model)
  // The parsers read the parent session from this; it is what scopes the band to this session.
  const env = { CLAUDE_CODE_SESSION_ID: await $.session.id() }
  const started = await runner($, argv, { env, timeoutMs: 60_000 })
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.every(TICK_MS, () => refresh($))
    // A worker can itself be a Claude Code session with this plugin (DeepSeek runs claude):
    // it must do its task, not delegate it again.
    if ((await $.env.get('CLI_DISPATCH_WORKER')) !== '1') await $.tool.register(DISPATCH)
    return result
  })

  on('tool.call', { tool: 'mcp__cli-dispatch__dispatch' }, async ($, e, next) => ({
    result: await dispatch($, e as unknown as DispatchInput, next.signal),
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
