import { describe, expect, mock, test } from 'claude-code/testing'

const ROOT = '/sessions'
const NOW = Date.parse('2026-10-12T10:00:00Z')
const SID = 'parent-1'
const ALIVE_PID = '4242'
const RECYCLED_PID = '7777' // alive for `kill -0`, but its command line is not a worker's
const KILL_THROWS_PID = '6666' // stubRuns: `kill -0 6666` throws, as with no kill binary

// What `kill -0 <pid>` answers: the stubs' alive pids (the worker's and the recycled one's).
const killAnswer = (pid: string) => ({ value: { exitCode: pid === ALIVE_PID || pid === RECYCLED_PID ? 0 : 1, stdout: '', stderr: '' } })
// What `ps -o command= -p <pid>` answers.
const psAnswer = (pid: string) => ({ value: { exitCode: 0, stdout: pid === RECYCLED_PID ? 'sleep 60\n' : 'node /p/cx-stream-parse.mjs\n', stderr: '' } })

type Fixture = Record<string, { meta: object; status: object; mtimeMs: number; verdict?: object; pid?: string }>

// Everything the mod reaches through $ is stubbed here: the kit has no fs, env, clock or process beneath.
function stubHost(on: any, sessions: Fixture, repoOf: Record<string, string> = {}) {
  const files: Record<string, string> = {}
  const mtimes: Record<string, number> = {}
  for (const [id, s] of Object.entries(sessions)) {
    files[`${ROOT}/${id}/meta.json`] = JSON.stringify(s.meta)
    files[`${ROOT}/${id}/status.json`] = JSON.stringify(s.status)
    mtimes[`${ROOT}/${id}/status.json`] = s.mtimeMs
    if (s.verdict) files[`${ROOT}/${id}/verdict.json`] = JSON.stringify(s.verdict)
    if (s.pid) files[`${ROOT}/${id}/worker.pid`] = `${s.pid}\n`
  }
  on('env.get', ($: any, e: any) => ({ value: e.name === 'CLI_DISPATCH_SESSIONS_DIR' ? ROOT : undefined }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SID }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__cli-dispatch__${e.name}` } }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path in files }))
  on('fs.list', () => ({ value: Object.keys(sessions).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.read', ($: any, e: any) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] }
  })
  on('fs.stat', ($: any, e: any) => {
    if (e.path in mtimes) return { value: { kind: 'file', size: 1, mtimeMs: mtimes[e.path], realPath: e.path } }
    if (e.path.startsWith('/repo') || e.path.startsWith('/other') || e.path.startsWith('/tmp')) return { value: { kind: 'directory', size: 0, mtimeMs: 0, realPath: e.path } }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('process.run', ($: any, e: any) => {
    if (e.argv[0] === 'kill') return killAnswer(e.argv[2])
    if (e.argv[0] === 'ps') return psAnswer(e.argv[4])
    const wt = e.argv[2]
    return { value: wt in repoOf ? { exitCode: 0, stdout: `${repoOf[wt]}/.git\n`, stderr: '' } : { exitCode: 128, stdout: '', stderr: 'not a repo' } }
  })
}

const running = (backend: string, cwd = '/tmp/cx-wt-1', parent = SID) => ({
  meta: { backend, parentSessionId: parent, cwd, startedAt: new Date(NOW - 125_000).toISOString() },
  status: { sessionId: 'w', state: 'running' },
  mtimeMs: NOW - 5_000,
})

describe('cli-dispatch mod', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`band shows this session's live worker and a finished verdict (${surface})`, async ($, on) => {
      stubHost(on, {
        a: running('codex'),
        b: { meta: { backend: 'deepseek', parentSessionId: SID }, status: { state: 'done' }, mtimeMs: NOW - 60_000, verdict: { verify: { exitCode: 1 } } },
        c: running('copilot', '/tmp/cp-wt-1', 'someone-else'),
        d: { meta: { backend: 'opencode', parentSessionId: SID }, status: { state: 'running' }, mtimeMs: NOW - 300_000 },
      })
      await $.session.start({ surface, isInteractive: true, cwd: '/work' } as any)
      const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
      expect(await ui.find({ type: 'Text', text: /▶ cx 2m05s/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /■ ds FAIL/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /cp/ })).toBeUndefined() // another session's worker
      expect(await ui.find({ type: 'Text', text: /oc/ })).toBeUndefined() // stale "running" = dead
      await ui.unmount()
    })
  }

  test('band stays out of the way with no workers', async ($, on) => {
    stubHost(on, {})
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({}))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    expect(await ui.find({ type: 'Text', text: /\[CD\]/ })).toBeUndefined()
    await ui.unmount()
  })

  test('guard denies Edit/Write inside a repo with a live worktree run, and only there', async ($, on) => {
    stubHost(on, { a: running('codex', '/tmp/cx-wt-1') }, { '/tmp/cx-wt-1': '/repo' })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const blocked = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' } as any)
    expect((blocked as any).isError ?? (blocked as any).deny).toBeTruthy()
    expect(String((blocked as any).text ?? (blocked as any).deny)).toMatch(/cx worktree run for \/repo is live/)
    const elsewhere = await $.tool.call({ tool: 'Write', file_path: '/other/b.ts', content: 'x' } as any)
    expect((elsewhere as any).isError).toBeUndefined()
    const inWorktree = await $.tool.call({ tool: 'Edit', file_path: '/tmp/cx-wt-1/a.ts', old_string: 'a', new_string: 'b' } as any)
    expect((inWorktree as any).isError).toBeUndefined()
  })

  test('guard still holds a quiet run whose worker is alive (a long silent test command)', async ($, on) => {
    stubHost(on, { a: { ...running('codex'), mtimeMs: NOW - 300_000, pid: ALIVE_PID } }, { '/tmp/cx-wt-1': '/repo' })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.tool.call({ tool: 'Write', file_path: '/repo/new.ts', content: 'x' } as any)
    expect(String((r as any).text ?? (r as any).deny)).toMatch(/cx worktree run for \/repo is live/)
  })

  test('a quiet run whose worker.pid now belongs to an unrelated process is not live (#208)', async ($, on) => {
    stubHost(on, { a: { ...running('codex'), mtimeMs: NOW - 300_000, pid: RECYCLED_PID } }, { '/tmp/cx-wt-1': '/repo' })
    on('tool.call', () => ({ result: 'ran' }))
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({})) // nothing drawn when no worker is live
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    expect(await band.find({ type: 'Text', text: /▶ cx/ })).toBeUndefined()
    const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' } as any)
    expect((r as any).isError).toBeUndefined()
    await band.unmount()
  })

  test('guard lets edits through when no run is live', async ($, on) => {
    stubHost(on, { a: { ...running('codex'), mtimeMs: NOW - 300_000, pid: '999' } }, { '/tmp/cx-wt-1': '/repo' })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' } as any)
    expect((r as any).isError).toBeUndefined()
  })
})

// The dispatch tool: every host call is scripted, so the test sees the exact argv and env.
function stubDispatch(on: any, opts: { worker?: boolean; noPath?: boolean; waits?: number[] } = {}) {
  const calls: { argv: string[]; env?: Record<string, string> }[] = []
  const registered: string[] = []
  const written: Record<string, string> = {}
  const waits = [...(opts.waits ?? [0])]
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('env.get', ($: any, e: any) => ({
    value: e.name === 'CLI_DISPATCH_SESSIONS_DIR' ? ROOT : e.name === 'TMPDIR' ? '/tmp/' : e.name === 'CLI_DISPATCH_WORKER' && opts.worker ? '1' : undefined,
  }))
  on('session.id', () => ({ value: SID }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.register', ($: any, e: any) => {
    registered.push(e.name)
    return { value: { tool: `mcp__cli-dispatch__${e.name}` } }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', ($: any, e: any) => {
    written[e.path] = e.content ?? e.text ?? e.data
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    calls.push({ argv: [...e.argv], env: e.init?.env })
    const name = e.argv[0] === 'bash' ? e.argv[1].split('/').pop() : e.argv[0]
    if (opts.noPath && e.argv[0] !== 'bash') throw new Error(`spawn ${e.argv[0]} ENOENT`)
    if (name === 'cli-dispatch-run') return { value: { exitCode: 0, stdout: 'run: run-7\n', stderr: '' } }
    if (name === 'cli-dispatch-wait') {
      const code = waits.shift() ?? 0
      return { value: { exitCode: code, stdout: code === 124 ? '' : 'exit: 0  session: s-1  state: done  verify: pass\n', stderr: '' } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  return { calls, registered, written }
}

describe('dispatch tool', () => {
  test('runs the runner detached with the brief, verify and session id, waits through a timeout, returns the summary', async ($, on) => {
    const h = stubDispatch(on, { waits: [124, 0] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect(h.registered).toEqual(['dispatch'])
    const r: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 'fix it', verify: ['node --test', "echo 'a b'"], scope: ['src/**', 'package.json'] } as any)
    expect(String(r.result ?? r.text)).toMatch(/verify: pass/)
    const run = h.calls[0]!
    expect(run.argv.slice(0, 6)).toEqual(['cli-dispatch-run', '--detach', '--backend', 'cx', '--cwd', '/repo'])
    expect(run.argv).toContain('--fix-attempts')
    expect(run.argv.filter((a, i) => run.argv[i - 1] === '--verify')).toEqual(['node --test', "echo 'a b'"])
    expect(run.argv.filter((a, i) => run.argv[i - 1] === '--scope')).toEqual(['src/**', 'package.json'])
    expect(run.env?.CLAUDE_CODE_SESSION_ID).toBe(SID)
    const briefPath = run.argv[run.argv.indexOf('--prompt-file') + 1]!
    expect(h.written[briefPath]).toBe('fix it')
    expect(h.calls.filter(c => c.argv[0] === 'cli-dispatch-wait').length).toBe(2)
  })

  test('the brief file is removed once the run is over (#214)', async ($, on) => {
    const h = stubDispatch(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 'fix it' } as any)
    const brief = h.calls[0]!.argv[h.calls[0]!.argv.indexOf('--prompt-file') + 1]!
    const last = h.calls[h.calls.length - 1]!
    expect(last.argv).toEqual(['rm', '-f', brief])
    expect(h.calls.findIndex(c => c.argv[0] === 'rm')).toBeGreaterThan(h.calls.findIndex(c => c.argv[0] === 'cli-dispatch-wait')) // after the wait, not before
  })

  test('falls back to the plugin copy of the runner when it is not on PATH', async ($, on) => {
    const h = stubDispatch(on, { noPath: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'ds', cwd: '/repo', task: 't' } as any)
    expect(String(r.result ?? r.text)).toMatch(/verify: pass/)
    const viaBash = h.calls.filter(c => c.argv[0] === 'bash').map(c => c.argv[1])
    expect(viaBash.some(p => /\/scripts\/cli-dispatch-run$/.test(p!))).toBe(true)
    expect(viaBash.some(p => /\/scripts\/cli-dispatch-wait$/.test(p!))).toBe(true)
  })

  test('rejects a bad backend or a relative cwd without starting anything', async ($, on) => {
    const h = stubDispatch(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const bad: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'zz', cwd: '/repo', task: 't' } as any)
    expect(String(bad.result ?? bad.text)).toMatch(/backend must be one of/)
    const rel: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'ds', cwd: 'repo', task: 't' } as any)
    expect(String(rel.result ?? rel.text)).toMatch(/absolute path/)
    expect(h.calls.length).toBe(0)
  })

  test('is not offered inside a worker session', async ($, on) => {
    const h = stubDispatch(on, { worker: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect(h.registered).toEqual([])
  })
})

// ---- plugin-config keys: which one reaches which call ----------------------------------------

describe('dispatch key hand-off', () => {
  const KEYS = { codex_api_key: 'cx-S', deepseek_api_key: 'ds-S' }
  const REAL_VARS = /DEEPSEEK_API_KEY|CODEX_API_KEY|GEMINI_API_KEY|OPENROUTER_API_KEY|COPILOT_GITHUB_TOKEN/

  test('the dispatched backend key rides on the run call only, as the private variable', { options: KEYS }, async ($, on) => {
    const h = stubDispatch(on, { waits: [124, 0] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 'fix it', verify: ['true'] } as any)
    const run = h.calls.find(c => c.argv[0] === 'cli-dispatch-run')!
    expect(run.env?.CLI_DISPATCH_RUN_KEY).toBe('cx-S')
    expect(run.env?.CLAUDE_CODE_SESSION_ID).toBe(SID)
    expect(Object.values(run.env ?? {})).not.toContain('ds-S')
    expect(Object.keys(run.env ?? {}).filter(k => REAL_VARS.test(k))).toEqual([])
    const waits = h.calls.filter(c => c.argv[0] === 'cli-dispatch-wait')
    expect(waits.length).toBe(2)
    for (const w of waits) expect(w.env).toEqual({ CLAUDE_CODE_SESSION_ID: SID })
    // The key is in no argv, no written file and not in what the tool returns.
    expect(JSON.stringify(h.calls.map(c => c.argv))).not.toContain('cx-S')
    expect(JSON.stringify(h.written)).not.toContain('cx-S')
    expect(JSON.stringify(r)).not.toContain('cx-S')
  })

  test('the plugin-copy fallback keeps the same scope', { options: KEYS }, async ($, on) => {
    const h = stubDispatch(on, { noPath: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 't' } as any)
    const withKey = h.calls.filter(c => c.env?.CLI_DISPATCH_RUN_KEY !== undefined)
    expect(withKey.length).toBeGreaterThan(0)
    for (const c of withKey) expect((c.argv[0] === 'bash' ? c.argv[1] : c.argv[0]) as string).toMatch(/cli-dispatch-run$/)
  })

  test('another backend gets no key, and an empty key injects nothing', { options: { codex_api_key: '', deepseek_api_key: 'ds-S' } }, async ($, on) => {
    const h = stubDispatch(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 't' } as any)
    expect(h.calls.find(c => c.argv[0] === 'cli-dispatch-run')!.env).toEqual({ CLAUDE_CODE_SESSION_ID: SID })
  })
})

// ---- /cli-dispatch-config: the setup pane -----------------------------------------------------

const STATUS = (keys: Record<string, boolean>) =>
  JSON.stringify({ path: '/home/u/.config/cli-dispatch/config', exists: true, keys: { DEEPSEEK_API_KEY: false, GEMINI_API_KEY: false, CODEX_API_KEY: false, OPENROUTER_API_KEY: false, COPILOT_GITHUB_TOKEN: false, ...keys }, models: { DS_MODEL: 'deepseek-v4-pro', AG_MODEL: 'gemini-x' } })
const PANE: any = { title: 'cli-dispatch setup', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { bodyRows: 20, offset: 0, total: 20 }, view: {} }

function stubSetup(on: any, opts: { sh?: string; shThrows?: boolean; status?: string; worker?: boolean } = {}) {
  const calls: { argv: string[]; init?: any }[] = []
  const opened: any[] = []
  const toasts: string[] = []
  const registeredCommands: string[] = []
  const stateWrites: unknown[] = []
  on('state.set', ($: any, e: any, next: any) => {
    stateWrites.push(e.value)
    return next(e)
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'CLI_DISPATCH_WORKER' && opts.worker ? '1' : undefined }))
  on('session.id', () => ({ value: SID }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__cli-dispatch__${e.name}` } }))
  on('command.register', ($: any, e: any) => {
    registeredCommands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($: any, e: any) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    calls.push({ argv: [...e.argv], init: e.init })
    const [a0, a1] = e.argv as string[]
    if (a0 === 'sh') {
      if (opts.shThrows) throw new Error('spawn sh ENOENT')
      return { value: { exitCode: 0, stdout: opts.sh ?? '', stderr: '' } }
    }
    if (a0 === 'node') return { value: { exitCode: 0, stdout: opts.status ?? STATUS({}), stderr: '' } }
    if (a0 === 'bash' && a1!.endsWith('resolve-plugin-root.sh')) return { value: { exitCode: 0, stdout: '/resolved/root\n', stderr: '' } }
    if (a0 === 'bash' && a1!.endsWith('install.sh')) return { value: { exitCode: 0, stdout: 'noise\nDone.\n', stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  return { calls, opened, toasts, registeredCommands, stateWrites }
}

describe('setup pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows CLI, wrapper, key and model state per backend (${surface})`, { options: { deepseek_api_key: 'x' } }, async ($, on) => {
      const h = stubSetup(on, { sh: 'claude\ncodex\nds-agent\ncx-agent\n', status: STATUS({ CODEX_API_KEY: true }) })
      await $.session.start({ surface, isInteractive: true, cwd: '/work' } as any)
      expect([...h.registeredCommands].sort()).toEqual(['cli-dispatch-config', 'cli-dispatch-runs'])
      await $.command.run({ command: 'cli-dispatch-config' } as any)
      expect(h.opened.map(o => o.id)).toEqual(['setup'])
      const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface, component: 'Pane', requestId: 'setup', props: PANE })
      expect(await ui.find({ type: 'Text', text: /agy ✗/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /codex ✓/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /✓ plugin config/ })).toBeDefined() // DeepSeek
      expect(await ui.find({ type: 'Text', text: /✓ config file/ })).toBeDefined() // Codex
      expect(await ui.find({ type: 'Text', text: /missing.*\/plugin configure cli-dispatch@cli-dispatch/ })).toBeDefined() // OpenCode
      expect(await ui.find({ type: 'Input', key: 'DS_MODEL' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a key value is never drawn, stored, or typed into an Input', { options: { deepseek_api_key: 'SENTINEL-UC', codex_api_key: 'SENTINEL-UC2' } }, async ($, on) => {
    const h = stubSetup(on, { sh: 'claude\nds-agent\n', status: STATUS({}) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'cli-dispatch-config' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'Pane', requestId: 'setup', props: PANE })
    expect(JSON.stringify(await ui.drawn())).not.toMatch(/SENTINEL/)
    expect(await ui.find({ type: 'Text', text: /SENTINEL/ })).toBeUndefined()
    // The kit's key matcher takes a string, not a pattern: list every Input and look at the keys.
    expect((await ui.findAll({ type: 'Input' })).filter(i => /API_KEY|TOKEN/.test(i.key ?? ''))).toEqual([])
    expect(h.stateWrites.length).toBeGreaterThan(0)
    expect(JSON.stringify(h.stateWrites)).not.toMatch(/SENTINEL/)
    await ui.unmount()
  })

  test('Install selected runs the resolved installer non-interactively, never with --install-missing', async ($, on) => {
    const h = stubSetup(on, { sh: 'claude\nds-agent\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'cli-dispatch-config' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'Pane', requestId: 'setup', props: PANE })
    await ui.press({ key: 'install:oc' })
    await ui.press({ key: 'install:ds' })
    await ui.press({ key: 'install' })
    const bash = h.calls.filter(c => c.argv[0] === 'bash')
    expect(bash.length).toBe(2)
    expect(bash[0]!.argv[1]).toMatch(/\/scripts\/resolve-plugin-root\.sh$/)
    expect(bash[1]!.argv).toEqual(['bash', '/resolved/root/scripts/install.sh', '--backends', 'deepseek,opencode', '--non-interactive'])
    expect(JSON.stringify(h.calls.map(c => c.argv))).not.toContain('--install-missing')
    expect(h.toasts.some(t => /Done\./.test(t))).toBe(true)
    await ui.unmount()
  })

  test('with no sh there are no install controls', async ($, on) => {
    stubSetup(on, { shThrows: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'cli-dispatch-config' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'Pane', requestId: 'setup', props: PANE })
    expect((await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('install'))).toEqual([])
    expect(await ui.find({ type: 'Text', text: /agy \?/ })).toBeDefined()
    await ui.unmount()
  })

  test('a model Input saves through config-file.mjs set', async ($, on) => {
    const h = stubSetup(on, { sh: 'claude\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'cli-dispatch-config' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'Pane', requestId: 'setup', props: PANE })
    await ui.input({ key: 'DS_MODEL', text: ' deepseek-v5 ' })
    const set = h.calls.find(c => c.argv[2] === 'set')!
    expect(set.argv.slice(2)).toEqual(['set', 'DS_MODEL', 'deepseek-v5'])
    expect(set.argv[1]).toMatch(/\/scripts\/config-file\.mjs$/)
    await ui.unmount()
  })

  test('the command is offered inside a worker session too', async ($, on) => {
    const h = stubSetup(on, { worker: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect(h.registeredCommands).toEqual(['cli-dispatch-config'])
  })
})

// ---- /cli-dispatch-runs: the run monitor pane -------------------------------------------------

const RUNS_PANE: any = { title: 'cli-dispatch runs', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { bodyRows: 40, offset: 0, total: 40 }, view: {} }
const HELPER = /\/scripts\/cli-dispatch-pane-read\.mjs$/
const jl = (...recs: unknown[]) => recs.map(r => JSON.stringify(r)).join('\n') + '\n'

type RunFix = {
  meta: object
  status: object
  mtimeMs: number
  verdict?: object
  pid?: string
  progress?: number // progress.log size
  transcript?: number // transcript.jsonl size
}

// Everything is in memory and every touch is recorded: the kit has no fs, clock or process beneath.
// The clock is the kit's mock.clock, which moves only when `tick()` advances it, so a clock.every callback
// runs once per advance, like the engine's timer, and a cancelled timer never runs again.
function stubRuns(on: any, runs: Record<string, RunFix>, opts: { worker?: boolean; unplaced?: boolean; helper?: (mode: string, args: string[]) => string } = {}) {
  const files: Record<string, string> = {}
  const runDirs: string[] = [] // names under <root>/.runs
  const stats: Record<string, { size: number; mtimeMs: number }> = {}
  let activity = 0
  const rec = { reads: [] as string[], stats: [] as string[], lists: 0, runs: [] as string[][], registered: [] as any[], opened: [] as any[], writes: [] as string[], toasts: [] as string[], statuses: [] as string[] }
  const h = {
    runs,
    files,
    runDirs,
    stats,
    rec,
    helper: opts.helper ?? (() => ''),
    // Move the clock on `ms`: every timer due runs, then wait until the work it started has settled.
    async tick(ms = 1000) {
      await clock.advance(ms)
      let last = -1
      while (last !== activity) {
        last = activity
        await clock.settle()
      }
    },
    sync() {
      for (const [id, s] of Object.entries(h.runs)) {
        files[`${ROOT}/${id}/meta.json`] = JSON.stringify(s.meta)
        files[`${ROOT}/${id}/status.json`] = JSON.stringify(s.status)
        stats[`${ROOT}/${id}/status.json`] = { size: 1, mtimeMs: s.mtimeMs }
        if (s.verdict) {
          files[`${ROOT}/${id}/verdict.json`] = JSON.stringify(s.verdict)
          stats[`${ROOT}/${id}/verdict.json`] = { size: 1, mtimeMs: NOW }
        }
        if (s.pid) files[`${ROOT}/${id}/worker.pid`] = `${s.pid}\n`
        if (s.progress !== undefined) stats[`${ROOT}/${id}/progress.log`] = { size: s.progress, mtimeMs: NOW }
        if (s.transcript !== undefined) stats[`${ROOT}/${id}/transcript.jsonl`] = { size: s.transcript, mtimeMs: NOW }
      }
    },
  }
  h.sync()
  const clock = mock.clock(on, { now: NOW })
  on('env.get', ($: any, e: any) => ({ value: e.name === 'CLI_DISPATCH_SESSIONS_DIR' ? ROOT : e.name === 'CLI_DISPATCH_WORKER' && opts.worker ? '1' : undefined }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SID }))
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__cli-dispatch__${e.name}` } }))
  on('command.register', ($: any, e: any) => {
    rec.registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', ($: any, e: any) => {
    rec.opened.push(e)
    return { value: opts.unplaced ? { isPlaced: false, reason: 'no room' } : { isPlaced: true } }
  })
  on('ui.toast', ($: any, e: any) => {
    rec.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($: any, e: any) => {
    rec.statuses.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('fs.write', ($: any, e: any) => {
    rec.writes.push(e.path)
    return { value: undefined }
  })
  on('fs.exists', ($: any, e: any) => ({ value: e.path === ROOT || e.path in files }))
  on('fs.list', ($: any, e: any) => {
    if (e.path === `${ROOT}/.runs`) return { value: runDirs.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
    rec.lists++
    return { value: Object.keys(h.runs).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', ($: any, e: any) => {
    rec.reads.push(e.path)
    activity++
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] }
  })
  on('fs.stat', ($: any, e: any) => {
    rec.stats.push(e.path)
    activity++
    const st = stats[e.path]
    if (!st) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: st.size, mtimeMs: st.mtimeMs, realPath: e.path } }
  })
  on('process.run', ($: any, e: any) => {
    rec.runs.push([...e.argv])
    activity++
    if (e.argv[0] === 'kill' && e.argv[2] === KILL_THROWS_PID) throw new Error('spawn kill ENOENT')
    if (e.argv[0] === 'kill') return killAnswer(e.argv[2])
    if (e.argv[0] === 'ps') return psAnswer(e.argv[4])
    if (e.argv[0] === 'node' && HELPER.test(e.argv[1])) return { value: { exitCode: 0, stdout: h.helper(e.argv[2], e.argv.slice(3)), stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  return h
}

const helperCalls = (h: ReturnType<typeof stubRuns>) => h.rec.runs.filter(a => a[0] === 'node' && HELPER.test(a[1]!)).map(a => a.slice(2))
const mountRuns = ($: any, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'cli-dispatch', surface, component: 'Pane', requestId: 'cli-dispatch-runs', props: RUNS_PANE })

const done = (backend: string, startedAgoMs: number, extra: Partial<RunFix> = {}, prompt = ''): RunFix => ({
  meta: { backend, parentSessionId: SID, startedAt: new Date(NOW - startedAgoMs).toISOString(), promptPreview: prompt },
  status: { sessionId: 'w', state: 'done', events: 3 },
  mtimeMs: NOW - 60_000,
  ...extra,
})

// Every string in a drawn tree, in order: Text children and Button labels.
function strings(node: any, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const n of node) strings(n, out)
  else if (node && typeof node === 'object') {
    if (typeof node.props?.label === 'string') out.push(node.props.label)
    strings(node.children, out)
  }
  return out
}
const drawnText = async (ui: any) => strings(await ui.drawn()).join('\n')
const indent = (s: string) => s.split('\n').map(l => `  ${l}`).join('\n')
const countOf = (hay: string, needle: string) => hay.split(needle).length - 1
// A run's table cells, trimmed of their padding: the Button's children are one Text per column.
const rowCells = async (ui: any, name: string) => {
  const b = await ui.find({ type: 'Button', key: `run:${name}` })
  const cs = (b?.children ?? []).flatMap((c: any) => strings(c)) as string[]
  if (cs[0] === '' || cs[0]?.trim() === '') cs.shift() // the hotkey-less alignment prefix
  return cs.map(c => c.trimEnd())
}
// The props of each column Text of a run's row, in order.
const rowProps = async (ui: any, name: string) =>
  ((await ui.find({ type: 'Button', key: `run:${name}` }))?.children as any[]).filter(c => typeof c === 'object').map(c => c.props ?? {})
// Every string under the open run's detail (the table above it is not part of it).
const detailText = async (ui: any) => strings(await ui.find({ key: 'detail' })).join('\n')
const FOOTER = '↑↓ / tık: run seç · satır: tam metin · b: geri · Esc: kapat'

const open = async ($: any, surface: 'terminal' | 'desktop' = 'terminal') => {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' } as any)
  await $.command.run({ command: 'cli-dispatch-runs' } as any)
  return mountRuns($, surface)
}

describe('run monitor pane', () => {
  test('the command is registered immediate outside a worker, opens the pane focused, and is absent in a worker', async ($, on) => {
    const h = stubRuns(on, {})
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const cmd = h.rec.registered.find(r => r.name === 'cli-dispatch-runs')
    expect(cmd?.immediate).toBe(true)
    await $.command.run({ command: 'cli-dispatch-runs' } as any)
    expect(h.rec.opened.length).toBe(1)
    expect(h.rec.opened[0]).toMatchObject({ id: 'cli-dispatch-runs', focus: true, closeOnEscape: true })
    const ui = await mountRuns($)
    expect(await drawnText(ui)).toMatch(/No cli-dispatch runs in this session yet\./)
    await ui.unmount()
  })

  test('nothing is registered inside a worker', async ($, on) => {
    const h = stubRuns(on, {}, { worker: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect(h.rec.registered.map(r => r.name)).not.toContain('cli-dispatch-runs')
  })

  const FIVE: Record<string, RunFix> = {
    r1: done('deepseek', 7_300_000, { mtimeMs: NOW - 7_200_000 }, 'two hours ago'),
    r2: done('codex', 400_000, {}, 'a minute ago'),
    r3: { ...running('opencode'), meta: { backend: 'opencode', parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: 'fresh' } },
    r4: { meta: { backend: 'copilot', parentSessionId: SID, startedAt: new Date(NOW - 500_000).toISOString(), promptPreview: 'quiet alive' }, status: { state: 'running' }, mtimeMs: NOW - 300_000, pid: ALIVE_PID },
    r5: { meta: { backend: 'antigravity', parentSessionId: SID, startedAt: new Date(NOW - 600_000).toISOString(), promptPreview: 'quiet dead' }, status: { state: 'running' }, mtimeMs: NOW - 300_000, pid: '999' },
    r6: { ...done('ollama', 100_000, {}, 'other session'), meta: { backend: 'ollama', parentSessionId: 'someone-else', startedAt: new Date(NOW - 100_000).toISOString(), promptPreview: 'other session' } },
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the list holds all of this session's runs, newest first, quiet-but-alive stays running (${surface})`, async ($, on) => {
      stubRuns(on, FIVE)
      const ui = await open($, surface)
      const t = await drawnText(ui)
      expect(await rowCells(ui, 'r3')).toEqual(['▶ oc', '', 'running', '…', '2m05s'])
      expect(await rowCells(ui, 'r2')).toEqual(['■ cx', '', 'done', '–', '5m40s'])
      expect(await rowCells(ui, 'r4')).toEqual(['▶ cp', '', 'running', '…', '8m20s'])
      expect(await rowCells(ui, 'r5')).toEqual(['? ag', '', 'stale', '…', '10m00s'])
      expect(await rowCells(ui, 'r1')).toEqual(['■ ds', '', 'done', '–', '1m40s'])
      for (const p of ['fresh', 'a minute ago', 'quiet alive', 'quiet dead', 'two hours ago']) expect(t).toContain(p)
      expect(t).not.toMatch(/other session|ollama/)
      const order = ['fresh', 'a minute ago', 'quiet alive', 'quiet dead', 'two hours ago'].map(p => t.indexOf(p))
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(order[0]).toBeGreaterThan(-1)
      await ui.unmount()
    })
  }

  test('the band keeps its window and ignores the pane list; a second list refresh reads no meta or status', async ($, on) => {
    const h = stubRuns(on, FIVE)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    const bt = await drawnText(band)
    expect(bt).toMatch(/▶ oc/)
    expect(bt).toMatch(/■ cx/)
    expect(bt).toMatch(/▶ cp/) // quiet but alive
    expect(bt).not.toMatch(/■ ds|ag|ollama/) // 2 h old; quiet with a dead pid; another session
    await band.unmount()

    await $.command.run({ command: 'cli-dispatch-runs' } as any)
    const ui = await mountRuns($)
    h.rec.reads.length = 0
    h.rec.stats.length = 0
    await h.tick()
    const touched = [...h.rec.reads, ...h.rec.stats]
    expect(touched.filter(p => /\/(meta|status)\.json$/.test(p) && h.rec.reads.includes(p))).toEqual([])
    expect(touched.filter(p => p.startsWith(`${ROOT}/r6/`))).toEqual([])
    expect(h.rec.stats.filter(p => p.endsWith('/status.json')).length).toBe(5) // stat only, no read
    await ui.unmount()
  })

  test('with no kill binary the band and the run list keep working (a quiet run just drops off the band)', async ($, on) => {
    const quiet = (backend: string, pid?: string): RunFix => ({ meta: { backend, parentSessionId: SID, startedAt: new Date(NOW - 400_000).toISOString() }, status: { state: 'running' }, mtimeMs: NOW - 300_000, ...(pid ? { pid } : {}) })
    stubRuns(on, { k: quiet('codex', KILL_THROWS_PID), d: done('opencode', 1000) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    const bt = await drawnText(band)
    expect(bt).toMatch(/oc/) // the finished run is still drawn: refresh did not abort
    expect(bt).not.toMatch(/▶ cx/)
    await band.unmount()
    const ui = await open($)
    const t = await drawnText(ui)
    expect(t).toMatch(/cx/) // both runs listed
    expect(t).toMatch(/oc/)
    await ui.unmount()
  })

  test('the band keeps a quiet run whose worker is alive, and drops one whose pid is dead or missing', async ($, on) => {
    const quiet = (backend: string, pid?: string): RunFix => ({ meta: { backend, parentSessionId: SID, startedAt: new Date(NOW - 400_000).toISOString() }, status: { state: 'running' }, mtimeMs: NOW - 300_000, ...(pid ? { pid } : {}) })
    stubRuns(on, { x: quiet('codex', ALIVE_PID), y: quiet('opencode', '999'), z: quiet('copilot') })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    const bt = await drawnText(band)
    expect(bt).toMatch(/▶ cx 6m40s/)
    expect(bt).not.toMatch(/oc|cp/)
    await band.unmount()
  })

  // ---- Run detail: Summary ----

  const RUN_A = (extra: Partial<RunFix> = {}): RunFix => ({
    meta: { backend: 'codex', model: 'gpt-x', branch: 'cd/run-1', parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: 'do it' },
    status: { state: 'running', events: 7, lastTool: 'Bash', toolCounts: { Bash: 5, Edit: 3 }, usage: { input_tokens: 100, output_tokens: 20 }, lastActivityAt: new Date(NOW - 4000).toISOString() },
    mtimeMs: NOW - 2_000,
    progress: 400,
    transcript: 5000,
    ...extra,
  })
  const win = (from: number, to: number, size: number, ...recs: unknown[]) => jl({ from, to, size }, ...recs)

  test('Summary shows the helper lines and counters; a tick appends only what grew, and reads nothing when nothing did', async ($, on) => {
    const h = stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 0, t: '$ npm test' }, { o: 12, t: '· started' })
        if (mode === 'fwd') return win(400, 460, 460, { o: 400, t: '· new line' })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    let t = await drawnText(ui)
    expect(t).toMatch(/\$ npm test/)
    const d = await detailText(ui)
    expect(await rowCells(ui, 'a')).toContain('running')
    expect(d).toMatch(/olay +\n7\n · komut \n8\n \(Bash×5 Edit×3\)/)
    expect(d).toMatch(/son aktivite +\n4s önce\n · Bash/)
    expect(d).toMatch(/tokens +\nin 100 · out 20/)
    expect(t).toMatch(/gpt-x/)
    expect(helperCalls(h)).toEqual([['back', `${ROOT}/a/progress.log`, '400', '262144']])

    h.stats[`${ROOT}/a/progress.log`] = { size: 460, mtimeMs: NOW }
    await h.tick()
    expect(helperCalls(h).slice(1)).toEqual([['fwd', `${ROOT}/a/progress.log`, '400', '262144']])
    t = await drawnText(ui)
    expect(t).toMatch(/· \nnew line/)
    expect(t).toMatch(/\$ npm test/)

    const before = h.rec.runs.length
    await h.tick() // size unchanged
    expect(h.rec.runs.length).toBe(before)
    await ui.unmount()
  })

  test('a quiet running run costs only a kill -0 per tick when its file did not move', async ($, on) => {
    const h = stubRuns(on, { a: RUN_A({ mtimeMs: NOW - 300_000, pid: ALIVE_PID }) }, { helper: (mode) => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    const before = h.rec.runs.length
    await h.tick()
    const added = h.rec.runs.slice(before)
    expect(added.length).toBeGreaterThan(0)
    expect(added.every(a => (a[0] === 'kill' && a[2] === ALIVE_PID) || (a[0] === 'ps' && a[4] === ALIVE_PID))).toBe(true)
    await ui.unmount()
  })

  test('a Run-detail tick touches only the selected run, the helper and its pid; it never lists the root', async ($, on) => {
    const h = stubRuns(on, { a: RUN_A({ pid: ALIVE_PID, mtimeMs: NOW - 300_000 }), b: done('copilot', 1000) }, { helper: (mode) => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    h.rec.reads.length = 0
    h.rec.stats.length = 0
    h.rec.runs.length = 0
    h.rec.lists = 0
    await h.tick()
    expect([...h.rec.reads, ...h.rec.stats].every(p => p.startsWith(`${ROOT}/a/`))).toBe(true)
    expect(h.rec.runs.every(a => a[0] === 'kill' || a[0] === 'ps' || HELPER.test(a[1] ?? ''))).toBe(true)
    expect(h.rec.lists).toBe(0)
    await ui.unmount()
  })

  test('the tick follows the open pane', async ($, on) => {
    const h = stubRuns(on, { a: RUN_A() }, {
      helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : mode === 'fwd' ? win(400, 460, 460, { o: 400, t: '· grown' }) : ''),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    h.stats[`${ROOT}/a/progress.log`] = { size: 460, mtimeMs: NOW }
    await h.tick()
    expect(helperCalls(h).filter(c => c[0] === 'fwd').length).toBe(1)
    expect(await drawnText(ui)).toContain('· \ngrown')
    await ui.unmount()
  })

  // ---- Line -> full event ----

  test('pressing a line opens its full event: the whole cx output and exit code, the ds text, or the no-record message', async ($, on) => {
    const out = Array.from({ length: 1200 }, (_, i) => `out-${i}`).join('\n')
    const ev = { type: 'item.completed', item: { type: 'command_execution', command: 'npm run build --long', aggregated_output: out, exit_code: 1 } }
    const evText = JSON.stringify(ev)
    const dsFull = `ds-start ${'long text '.repeat(80)}ds-end`
    const h = stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 0, t: '$ npm run build --long (exit 1)' }, { o: 40, t: `· ds-start …` }, { o: 80, t: '--- resume @ 2026-10-12T10:00:00.000Z ---' })
        if (mode === 'event' && args[1] === '0') return jl({ o: 7, l: evText.length }, { t: evText, next: null })
        if (mode === 'event' && args[1] === '40') return jl({ text: dsFull })
        if (mode === 'event') return jl({ none: true })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'line:0' })
    let t = await drawnText(ui)
    // Content view (same as Full flow): the command, its whole output, the exit code — not the fields.
    expect(t).toContain(`$ npm run build --long\n${out}`)
    expect(t).toMatch(/\nexit 1(\n|$)/)
    expect(t).not.toMatch(/item\.command:/)
    expect(helperCalls(h).filter(c => c[0] === 'event')).toEqual([['event', `${ROOT}/a`, '0']])
    await ui.press({ key: 'back' })
    await ui.press({ key: 'line:40' })
    t = await drawnText(ui)
    expect(t).toContain(dsFull)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'line:80' })
    expect(await drawnText(ui)).toContain('No full event recorded for this line.')
    await ui.unmount()
  })

  test('a coalesced text the helper pages is fetched on from `next` and shown whole (#210)', { options: { deepseek_api_key: 'dsk-EXACT-1111-2222' } }, async ($, on) => {
    const h = stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 40, t: '· ds-start …' })
        if (mode === 'event' && args[1] === '40') {
          if (args[2] === undefined) return jl({ text: 'page-one dsk-EXACT-11', next: 21 })
          return jl({ text: '11-2222 page-two' })
        }
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'line:40' })
    const t = await drawnText(ui)
    expect(t).toContain('page-one ••••')
    expect(t).toContain('•••• page-two')
    expect(t).not.toContain('EXACT')
    expect(helperCalls(h).filter(c => c[0] === 'event')).toEqual([['event', `${ROOT}/a`, '40'], ['event', `${ROOT}/a`, '40', '21']])
    await ui.unmount()
  })

  test('an event cut by the helper is fetched on, and masking sees the assembled text', { options: { deepseek_api_key: 'dsk-EXACT-1111-2222' } }, async ($, on) => {
    const evText = JSON.stringify({ type: 'x', out: 'A dsk-EXACT-1111-2222 B' })
    const cut = evText.indexOf('1111') // the key is split across the chunk edge
    const h = stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 0, t: '· x' })
        if (mode === 'event') return jl({ o: 7, l: evText.length }, { t: evText.slice(0, cut), next: 7 + cut })
        if (mode === 'chunk') return jl({ next: null }, { t: evText.slice(cut) })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'line:0' })
    const t = await drawnText(ui)
    expect(t).toContain('A •••• B')
    expect(t).not.toContain('EXACT')
    expect(helperCalls(h).filter(c => c[0] === 'chunk')).toEqual([['chunk', `${ROOT}/a/transcript.jsonl`, String(7 + cut), String(evText.length - cut)]])
    await ui.unmount()
  })

  // ---- Verdict ----

  test('the verdict: FAIL names the failing command, violations are listed, stranded is neutral, the runner exit is labeled', async ($, on) => {
    const full = { state: 'done', exitCode: 1, verify: { commands: ['npm test', 'lint --all'], exitCode: 1, failedAt: 1, tail: '' }, scope: ['src/**'], scopeViolations: ['docs/x.md'], diffstat: '2 files changed', stranded: true, worktree: '/tmp/wt-9', fixAttempts: { used: 1, max: 1 } }
    stubRuns(on, {
      a: done('codex', 1000, { verdict: full }),
      b: done('copilot', 2000, { verdict: { schemaVersion: 1, error: 'boom', sessionId: 'x', exitCode: 0 } }),
      c: done('opencode', 3000, { verdict: { state: 'done', exitCode: 0, verify: { commands: ['true'], exitCode: 0, failedAt: null, tail: '' } } }),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    let d = await detailText(ui)
    expect(d).toMatch(/verify +\nFAIL\n \(cmd 2: lint --all\)/)
    expect(d).toMatch(/scope +\ndocs\/x\.md/)
    expect(d).toMatch(/stranded +\n\/tmp\/wt-9/)
    expect(d).toMatch(/runner exit +\n1/)
    expect(d).toMatch(/fix attempts +\n1\/1/)
    const valueOf = async (k: string) => ({ props: ((await ui.find({ key: `kv:${k}` }))?.children as any[])[1].props ?? {} })
    expect((await valueOf('verify')).props).toMatchObject({ color: 'red', bold: true })
    expect((await valueOf('scope')).props.color).toBe('red') // the violations
    expect((await valueOf('stranded')).props.color).toBeUndefined()
    expect((await valueOf('runner exit')).props.color).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'run:b' })
    d = await detailText(ui)
    expect(d).toMatch(/verdict not built: boom/)
    expect(d).not.toMatch(/PASS|runner exit/)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'run:c' })
    d = await detailText(ui)
    expect(d).toMatch(/verify +\nPASS/)
    expect((await valueOf('verify')).props).toMatchObject({ color: 'green', bold: true })
    await ui.unmount()
  })

  // ---- Full flow ----

  const flowFix = (extra: Partial<RunFix> = {}) => RUN_A({ progress: undefined, transcript: 600_000, ...extra })
  const T = `${ROOT}/a/transcript.jsonl`
  const cxEvent = (o: number, text: string, extra: object = {}) => ({ o, t: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text, ...extra } }) })

  test('Full flow loads the tail once, appends by fwd, trims to its window, and earlier/latest restore following; transcript is never read whole', async ($, on) => {
    let size = 600_000
    const h = stubRuns(on, { a: flowFix() }, {
      helper: (mode, args) => {
        if (mode === 'back' && args[1] === '600000') return win(60_000, 600_000, 600_000, cxEvent(60_000, 'FIRST-MSG'), cxEvent(599_000, 'SECOND-MSG'))
        if (mode === 'back' && args[1] === '60000') return win(0, 60_000, 600_000, cxEvent(0, 'ANCIENT-MSG'))
        if (mode === 'back') return win(60_500, size, size, cxEvent(599_000, 'SECOND-MSG'), cxEvent(600_100, 'THIRD-MSG'))
        if (mode === 'fwd') return win(600_000, size, size, cxEvent(600_100, 'THIRD-MSG'))
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    h.rec.runs.length = 0
    await ui.press({ key: 'tab:flow' })
    expect(helperCalls(h)).toEqual([['back', T, '600000', '524288']])
    let t = await drawnText(ui)
    expect(t).toMatch(/FIRST-MSG[\s\S]*SECOND-MSG/)
    expect(t).toContain('earlier')

    size = 600_200
    h.stats[T] = { size, mtimeMs: NOW }
    await h.tick()
    expect(helperCalls(h).slice(1)).toEqual([['fwd', T, '600000', '524288']])
    t = await drawnText(ui)
    expect(t).toContain('THIRD-MSG')
    expect(t).not.toContain('FIRST-MSG') // 600200 - 60000 is over the 512 KiB window: the front is trimmed
    expect(t).toContain('SECOND-MSG')

    await ui.press({ key: 'earlier' })
    expect(helperCalls(h).at(-1)).toEqual(['back', T, '599000', '524288'])
    await ui.unmount()
  })

  test('earlier then latest restores following', async ($, on) => {
    let size = 600_000
    const h = stubRuns(on, { a: flowFix() }, {
      helper: (mode, args) => {
        if (mode === 'back' && args[1] === '600000') return win(100_000, 600_000, size, cxEvent(100_000, 'TAIL-MSG'))
        if (mode === 'back' && args[1] === '100000') return win(0, 100_000, size, cxEvent(0, 'HEAD-MSG'))
        if (mode === 'back') return win(100_000, size, size, cxEvent(100_000, 'TAIL-MSG'), cxEvent(600_050, 'LIVE-MSG'))
        if (mode === 'fwd') return win(600_000, size, size, cxEvent(600_050, 'LIVE-MSG'))
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    await ui.press({ key: 'earlier' })
    expect(await drawnText(ui)).toContain('HEAD-MSG')
    expect(await ui.find({ type: 'Button', key: 'earlier' })).toBeUndefined()
    size = 600_100
    h.stats[T] = { size, mtimeMs: NOW }
    const calls = helperCalls(h).length
    await h.tick() // not following: no read
    expect(helperCalls(h).length).toBe(calls)
    await ui.press({ key: 'latest' })
    expect(helperCalls(h).at(-1)).toEqual(['back', T, '600100', '524288'])
    expect(await drawnText(ui)).toContain('LIVE-MSG')
    h.stats[T] = { size: 600_300, mtimeMs: NOW }
    size = 600_300
    await h.tick() // following again
    expect(helperCalls(h).at(-1)?.[0]).toBe('fwd')
    expect(h.rec.reads.filter(p => p.endsWith('transcript.jsonl'))).toEqual([])
    await ui.unmount()
  })

  test('while Summary is shown no tick touches transcript.jsonl', async ($, on) => {
    const h = stubRuns(on, { a: RUN_A() }, { helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    h.rec.stats.length = 0
    h.rec.runs.length = 0
    await h.tick()
    await h.tick()
    expect(h.rec.stats.filter(p => p.endsWith('transcript.jsonl'))).toEqual([])
    expect(helperCalls(h).filter(c => (c[1] ?? '').endsWith('transcript.jsonl'))).toEqual([])
    await ui.unmount()
  })

  test('Full flow content: cx output in full; ds and ollama stream frames skipped; cp deltas skipped or merged', async ($, on) => {
    const out = Array.from({ length: 1200 }, (_, i) => `row-${i}`).join('\n')
    const dsWindow = [
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `DELTA-${i}` } } })),
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_start' } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'HELLO-ONCE' }, { type: 'thinking', thinking: 'THINK-ONCE' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: out }] } },
    ]
    let o = 0
    const dsRecs = dsWindow.map(ev => {
      const t = JSON.stringify(ev)
      const r = { o, t }
      o += t.length + 1
      return r
    })
    const thinkingFrame = { o: 7, t: JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'THINK-DELTA' } } }) }
    const olRecs = [...dsRecs.slice(0, 15), thinkingFrame, ...dsRecs.slice(15)]
    const cpEvents = [
      ...Array.from({ length: 5 }, (_, i) => ({ type: 'assistant.message_delta', data: { deltaContent: `MSGDELTA-${i}` } })),
      { type: 'assistant.message', data: { content: 'FINAL-MSG' } },
      ...['rea1', 'rea2', 'rea3'].map(d => ({ type: 'assistant.reasoning_delta', data: { deltaContent: d } })),
    ].map((ev, i) => ({ o: i * 100, t: JSON.stringify(ev) }))
    const ex = { 'a': flowFix(), 'b': flowFix({ meta: { ...RUN_A().meta, backend: 'deepseek' } }), 'c': flowFix({ meta: { ...RUN_A().meta, backend: 'ollama' } }), 'd': flowFix({ meta: { ...RUN_A().meta, backend: 'copilot' } }) }
    const h = stubRuns(on, ex, {
      helper: (mode, args) => {
        if (mode !== 'back') return ''
        const dir = args[0]!.split('/').at(-2)
        if (dir === 'a') return win(0, 9000, 9000, { o: 0, t: JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'make', aggregated_output: out, exit_code: 2 } }) })
        if (dir === 'b') return win(0, 9000, 9000, ...dsRecs)
        if (dir === 'c') return win(0, 9000, 9000, ...olRecs)
        return win(0, 9000, 9000, ...cpEvents)
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    let t = await drawnText(ui)
    expect(t).toContain(out)
    expect(t).toMatch(/exit \n2\n/)
    await ui.press({ key: 'back' })

    await ui.press({ key: 'run:b' })
    await ui.press({ key: 'tab:flow' })
    t = await drawnText(ui)
    expect(countOf(t, 'HELLO-ONCE')).toBe(1)
    expect(t).not.toMatch(/DELTA-\d/)
    expect(t).toContain('15 stream events skipped')
    expect(t).toContain(out)
    await ui.press({ key: 'back' })

    await ui.press({ key: 'run:c' })
    await ui.press({ key: 'tab:flow' })
    t = await drawnText(ui)
    expect(countOf(t, 'HELLO-ONCE')).toBe(1)
    expect(countOf(t, 'THINK-ONCE')).toBe(1)
    expect(t).not.toContain('THINK-DELTA')
    expect(t).toContain('16 stream events skipped')
    await ui.press({ key: 'back' })

    await ui.press({ key: 'run:d' })
    await ui.press({ key: 'tab:flow' })
    t = await drawnText(ui)
    expect(countOf(t, 'FINAL-MSG')).toBe(1)
    expect(t).not.toContain('MSGDELTA')
    expect(t).toContain('5 stream events skipped')
    expect(t).toContain('rea1rea2rea3')
    await ui.unmount()
  })

  test('a big record shows its head and opens the complete event on demand', async ($, on) => {
    const full = JSON.stringify({ type: 'item.completed', item: { aggregated_output: `FULL-${'y'.repeat(300_000)}-END` } })
    const h = stubRuns(on, { a: flowFix() }, {
      helper: mode => {
        if (mode === 'back') return win(0, 9000, 9000, { o: 5, l: 300_000, big: true, t: '{"type":"item.completed","item":{"aggregated_output":"FULL-yyyy' })
        if (mode === 'chunk') return jl({ next: null }, { t: full })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    expect(await drawnText(ui)).toMatch(/open full event \(293 KiB\)/)
    await ui.press({ key: 'big:5' })
    expect(helperCalls(h).filter(c => c[0] === 'chunk')).toEqual([['chunk', T, '5', '300000']])
    // One drawing holds 100000 characters in all, so a long event is shown in pages: none is lost.
    let t = await drawnText(ui)
    expect(t).toMatch(/page 1\/4/)
    let ys = 0
    for (let page = 1; page <= 4; page++) {
      t = await drawnText(ui)
      expect(t).toContain(`page ${page}/4`)
      expect(t).not.toContain('not drawn')
      ys += (t.match(/y{1000,}/g) ?? []).reduce((n, run) => n + run.length, 0)
      if (page < 4) await ui.press({ key: 'next' })
    }
    expect(ys).toBe(300_000)
    expect(t).toContain('-END')
    await ui.press({ key: 'prev' })
    expect(await drawnText(ui)).toContain('page 3/4')
    await ui.unmount()
  })

  // ---- Sanitization ----

  test('escape sequences, BEL and CR never reach the tree', async ($, on) => {
    const ev = JSON.stringify({ type: 'x', out: 'a\r\nb\x1b]0;evil title\x07c' })
    stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 0, t: '\x1b[31mred\x1b[0m\x07' })
        if (mode === 'event') return jl({ o: 7, l: ev.length }, { t: ev, next: null })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    let t = await drawnText(ui)
    expect(t).toContain('red')
    expect(t).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f]/)
    await ui.press({ key: 'line:0' })
    t = await drawnText(ui)
    expect(t).toContain('bc')
    expect(t).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f]/)
    expect(t).not.toContain('evil')
    await ui.unmount()
  })

  // ---- Masking ----

  const EXACT = { deepseek_api_key: 'dsk-EXACT-1111-2222', copilot_github_token: 'cpt-EXACT-3333' }
  const LEAK =
    'dsk-EXACT-1111-2222 cpt-EXACT-3333 sk-ant-api03-AAAAAAAAAAAAAAAAAAAA sk-or-v1-BBBBBBBBBBBBBBBBBBBB ghp_CCCCCCCCCCCCCCCCCCCCCCCC ' +
    `github_pat_DDDDDDDDDDDDDDDDDDDDDD AKIAEEEEEEEEEEEEEEEE AIza${'F'.repeat(35)} Authorization: Bearer GGGGGGGGGGGG ` +
    'OPENROUTER_API_KEY=HHHHHHHH export MY_SECRET=IIIIIIII {"env":{"X_TOKEN":"JJJJJJJJ"}}'
  const BODIES = ['EXACT', 'AAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCCCCCCCCCC', 'DDDDDDDDDDDDDDDDDDDDDD', 'EEEEEEEEEEEEEEEE', 'F'.repeat(35), 'GGGGGGGGGGGG', 'HHHHHHHH', 'IIIIIIII', 'JJJJJJJJ']
  const expectMasked = async (ui: any) => {
    const tree = JSON.stringify(await ui.drawn())
    for (const b of BODIES) expect(tree).not.toContain(b)
    expect(tree).toContain('••••')
  }

  test('no secret body reaches any drawn surface: list, header, lines, event, flow, merged deltas, big head', { options: EXACT }, async ($, on) => {
    const splitAt = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'gs'))!
    const leakEvent = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: LEAK, env: { X_TOKEN: 'JJJJJJJJ' }, deepseek_api_key: 'HHHHHHHH' } })
    const h = stubRuns(on, {
      a: RUN_A({ meta: { backend: 'codex', model: LEAK, branch: LEAK, parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: LEAK }, transcript: 9000, progress: 400 }),
      b: flowFix({ meta: { ...RUN_A().meta, backend: 'copilot', promptPreview: 'cp run' } }),
    }, {
      helper: (mode, args) => {
        const dir = args[0]!.split('/').at(-2) ?? args[0]!.split('/').at(-1)
        if (mode === 'back' && args[0]!.endsWith('progress.log')) return win(0, 400, 400, { o: 0, t: LEAK }, { o: 500, t: `{"env":{"X_TOKEN":"JJJJJJJJ"}} ${LEAK}` })
        if (mode === 'back' && dir === 'a') return win(0, 9000, 9000, { o: 0, t: leakEvent }, { o: 5, l: 300_000, big: true, t: `{"a":"${LEAK}` })
        if (mode === 'back') return win(0, 9000, 9000, ...splitAt(LEAK, 7).map((d, i) => ({ o: i * 10, t: JSON.stringify({ type: 'assistant.reasoning_delta', data: { deltaContent: d } }) })))
        if (mode === 'event') return jl({ text: LEAK })
        return ''
      },
    })
    const ui = await open($)
    await expectMasked(ui) // the list prompt
    expect(await drawnText(ui)).toMatch(/sk-ant-••••|••••/)
    await ui.press({ key: 'run:a' })
    await expectMasked(ui) // header values and progress lines
    let t = await drawnText(ui)
    expect(t).toContain('sk-ant-••••')
    expect(t).toContain('OPENROUTER_API_KEY=••••')
    await ui.press({ key: 'line:0' })
    await expectMasked(ui) // the event view
    await ui.press({ key: 'back' })
    await ui.press({ key: 'tab:flow' })
    await expectMasked(ui) // a cx output and a big head
    await ui.press({ key: 'back' })
    await ui.press({ key: 'run:b' })
    await ui.press({ key: 'tab:flow' })
    await expectMasked(ui) // merged cp reasoning deltas, the key split across fragments
    t = await drawnText(ui)
    expect(t).toContain('sk-ant-••••')

    // The configured values go nowhere but the closure.
    const everywhere = JSON.stringify([h.rec.runs, h.rec.writes, h.rec.toasts, h.rec.statuses, h.rec.opened, h.rec.registered])
    expect(everywhere).not.toContain('dsk-EXACT')
    expect(everywhere).not.toContain('cpt-EXACT')
    await ui.unmount()
  })

  // ---- a dir renamed under the open pane (the Codex stream's provisional dir) ----

  // ---- Restyle: table, segmented control, colored lines, boxes ----

  test('the list is a table: dim header, one row per run, the repo basename, PASS green and FAIL red in the verify cell, footer under it', async ($, on) => {
    const withCwd = (cwd: string, verdict?: object): Partial<RunFix> => ({ meta: { backend: 'codex', parentSessionId: SID, cwd, startedAt: new Date(NOW - 100_000).toISOString(), promptPreview: '' }, ...(verdict ? { verdict } : {}) })
    stubRuns(on, {
      a: done('codex', 100_000, withCwd('/home/x/repo-one', { state: 'done', exitCode: 0, verify: { commands: ['t'], exitCode: 0, failedAt: null, tail: '' } })),
      b: done('codex', 200_000, withCwd('/home/x/repo-two', { state: 'done', exitCode: 1, verify: { commands: ['t'], exitCode: 1, failedAt: 0, tail: '' } })),
      c: done('codex', 300_000, withCwd('/home/x/repo-leak', { state: 'done', exitCode: 2, leak: true })),
    })
    const ui = await open($)
    const head = await ui.find({ type: 'Text', text: /BACKEND +REPO +STATE +VERIFY +SÜRE/ })
    expect(head?.props.dimColor).toBe(true)
    expect(await ui.findAll({ type: 'Button' }).then((bs: any[]) => bs.filter(b => String(b.key).startsWith('run:')).length)).toBe(3)
    expect(await rowCells(ui, 'a')).toEqual(['■ cx', 'repo-one', 'done', 'PASS', '40s'])
    expect(await rowCells(ui, 'b')).toEqual(['■ cx', 'repo-two', 'done', 'FAIL', '40s'])
    expect((await rowCells(ui, 'c'))[3]).toBe('LEAK')
    const verifyColor = async (name: string) => (await rowProps(ui, name))[3].color
    expect(await verifyColor('a')).toBe('green')
    expect(await verifyColor('b')).toBe('red')
    expect(await verifyColor('c')).toBe('red')
    expect((await ui.find({ type: 'Text', text: FOOTER }))?.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test('a running row has a yellow marker and a dim pending verify; in the detail the open run is the highlighted row and the list stays above', async ($, on) => {
    stubRuns(on, { a: RUN_A(), b: done('copilot', 5000) }, { helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    const kids = (n: string) => rowProps(ui, n)
    expect((await kids('a'))[0].color).toBe('yellow')
    expect((await kids('a'))[3]).toMatchObject({ dimColor: true })
    expect((await kids('a'))[0].inverse).toBeFalsy()
    await ui.press({ key: 'run:a' })
    expect((await kids('a'))[0].inverse).toBe(true) // the open run
    expect((await kids('b'))[0].inverse).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'run:b' })).toBeDefined() // the list is still there
    expect(await detailText(ui)).toMatch(/^cx · /)
    expect((await ui.find({ type: 'Text', text: FOOTER }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'run:b' }) // a row in the list switches the run
    expect((await kids('b'))[0].inverse).toBe(true)
    await ui.unmount()
  })

  test('the view switch is two Buttons, Özet and Tüm akış, and the active one is marked and primary', async ($, on) => {
    stubRuns(on, { a: RUN_A() }, { helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    let sm = await ui.find({ type: 'Button', key: 'tab:summary' })
    let fl = await ui.find({ type: 'Button', key: 'tab:flow' })
    expect(sm?.text).toBe('● Özet')
    expect(sm?.props.variant).toBe('primary')
    expect(fl?.text).toBe('Tüm akış')
    expect(fl?.props.variant).toBe('secondary')
    expect(await drawnText(ui)).toContain('Özet (progress.log) · satıra tıklayınca o olayın tam hali açılır')
    await ui.press({ key: 'tab:flow' })
    sm = await ui.find({ type: 'Button', key: 'tab:summary' })
    fl = await ui.find({ type: 'Button', key: 'tab:flow' })
    expect(sm?.text).toBe('Özet')
    expect(sm?.props.variant).toBe('secondary')
    expect(fl?.text).toBe('● Tüm akış')
    expect(fl?.props.variant).toBe('primary')
    expect(await drawnText(ui)).toContain('Tüm akış (transcript.jsonl) · her olay kırpılmadan, sırayla')
    await ui.unmount()
  })

  test('Summary lines: model text has a dim bullet, a command is green on exit 0, red on another exit, dim with none yet; a running run ends in a yellow streaming line', async ($, on) => {
    stubRuns(on, { a: RUN_A({ pid: ALIVE_PID }) }, {
      helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '$ ok (exit 0)' }, { o: 10, t: '$ bad (exit 3)' }, { o: 20, t: '$ going' }, { o: 30, t: '· said it' }) : ''),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    const textOf = async (o: number) => ((await ui.find({ type: 'Button', key: `line:${o}` }))?.children as any[]).map((c: any) => c.props)
    expect((await textOf(0))[0].color).toBe('green')
    expect((await textOf(10))[0].color).toBe('red')
    expect((await textOf(20))[0]).toMatchObject({ dimColor: true })
    expect((await textOf(20))[0].color).toBeUndefined()
    expect((await textOf(30))[0].dimColor).toBe(true) // the bullet
    expect((await textOf(30))[1].dimColor).toBeFalsy() // the text
    const stream = await ui.find({ type: 'Text', text: '▍ akış sürüyor…' })
    expect(stream?.props.color).toBe('yellow')
    await ui.unmount()
  })

  test('a finished run has no streaming line', async ($, on) => {
    stubRuns(on, { a: done('codex', 1000, { progress: 400 }) }, { helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    expect(await ui.find({ type: 'Text', text: /akış sürüyor/ })).toBeUndefined()
    expect((await detailText(ui))).toMatch(/son aktivite +\nbitti/)
    await ui.unmount()
  })

  test('clicking a line opens the Tam metin box above the stream; its own geri closes just the box, b closes the box first and then the detail', async ($, on) => {
    const evText = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', exit_code: 0 } })
    stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 0, t: '$ ls (exit 0)' })
        if (mode === 'event') return jl({ o: 7, l: evText.length }, { t: evText, next: null })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    expect(await ui.find({ key: 'eventbox' })).toBeUndefined()
    await ui.press({ key: 'line:0' })
    const box = await ui.find({ key: 'eventbox' })
    expect(box?.props.borderStyle).toBeDefined()
    const bt = strings(box).join('\n')
    expect(bt).toContain('Tam metin · transcript.jsonl')
    expect(bt).toContain('$ ls')
    expect(bt).toMatch(/exit 0/)
    expect(await ui.find({ type: 'Button', key: 'line:0' })).toBeDefined() // the stream stays, below the box
    await ui.press({ key: 'event-back' })
    expect(await ui.find({ key: 'eventbox' })).toBeUndefined()
    await ui.press({ key: 'line:0' })
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'eventbox' })).toBeUndefined()
    expect(await ui.find({ key: 'detail' })).toBeDefined() // still in the detail
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'detail' })).toBeUndefined() // now the list
    await ui.unmount()
  })

  test('Full flow blocks are headed "model · olay N" in cyan or "komut · olay N · exit K" in yellow with the exit green or red, and a running run ends in the streaming line', async ($, on) => {
    const cmd = (o: number, exit: number) => ({ o, t: JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'x', aggregated_output: 'out', exit_code: exit } }) })
    stubRuns(on, { a: flowFix({ pid: ALIVE_PID }) }, {
      helper: mode => (mode === 'back' ? win(0, 600_000, 600_000, cxEvent(100, 'HELLO'), cmd(200, 0), cmd(300, 2)) : ''),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    const t = await drawnText(ui)
    expect(t).toMatch(/model\n · olay 1\n/)
    expect(t).toMatch(/komut\n · olay 2\n · exit \n0\n/)
    expect(t).toMatch(/komut\n · olay 3\n · exit \n2\n/)
    const colored = async (text: string) => (await ui.findAll({ type: 'Text', text })).map((x: any) => x.props.color)
    expect(await colored('model')).toEqual(['cyan'])
    expect((await colored('komut')).filter(Boolean)).toEqual(['yellow', 'yellow'])
    expect(await colored('0')).toContain('green')
    expect(await colored('2')).toContain('red')
    expect((await ui.find({ type: 'Text', text: '▍ akış sürüyor…' }))?.props.color).toBe('yellow')
    await ui.unmount()
  })

  test('the verdict block lists verify, exit, diff and stranded, and the extra rows only when they are there', async ($, on) => {
    stubRuns(on, {
      a: done('codex', 1000, { verdict: { state: 'done', exitCode: 0, verify: { commands: ['t'], exitCode: 0, failedAt: null, tail: '' }, diffstat: '1 file changed', stranded: true, worktree: '/tmp/wt-1' } }),
      b: done('codex', 2000),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    const d = await detailText(ui)
    expect(d).toMatch(/verify +\nPASS/)
    expect(d).toMatch(/exit +\n0\n/)
    expect(d).toMatch(/diff +\n1 file changed/)
    expect(d).toMatch(/stranded +\n\/tmp\/wt-1/)
    expect(d).toMatch(/runner exit +\n0/)
    expect(d).not.toMatch(/scope|fix attempts/)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'run:b' })
    expect(await detailText(ui)).not.toMatch(/verify|stranded|runner exit/) // no verdict, no block
    await ui.unmount()
  })

  // ---- Live-check fixes: repo, ordinals, content, merged commands, event box, verdict ----

  const rec = (o: number, ev: unknown) => ({ o, t: JSON.stringify(ev) })

  test('the repo is the main repo of a worktree run (its .git file), the cwd basename when there is none', async ($, on) => {
    const wt = (cwd: string): Partial<RunFix> => ({ meta: { backend: 'codex', parentSessionId: SID, cwd, startedAt: new Date(NOW - 100_000).toISOString(), promptPreview: '' } })
    const h = stubRuns(on, { a: done('codex', 100_000, wt('/tmp/cx-wt-Ku9jN5')), b: done('codex', 200_000, wt('/home/x/plain')), c: done('codex', 300_000, wt('/tmp/gone-wt')) })
    h.files['/tmp/cx-wt-Ku9jN5/.git'] = 'gitdir: /Users/x/Repos/modtest/.git/worktrees/cx-wt-Ku9jN5\n'
    const ui = await open($)
    expect((await rowCells(ui, 'a'))[1]).toBe('modtest')
    expect((await rowCells(ui, 'b'))[1]).toBe('plain') // no .git file readable
    expect((await rowCells(ui, 'c'))[1]).toBe('gone-wt') // the worktree is already removed
    await ui.press({ key: 'run:a' })
    expect(await detailText(ui)).toMatch(/^cx · modtest/)
    expect(await drawnText(ui)).not.toContain('cx-wt-Ku9jN5')
    await ui.unmount()
  })

  test('olay N is the ordinal among the loaded events (hidden ones counted), not a byte offset, and it stays put while the front is trimmed', async ($, on) => {
    let size = 600_000
    const h = stubRuns(on, { a: flowFix() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(60_000, 600_000, 600_000, rec(60_000, { type: 'thread.started', thread_id: 't' }), cxEvent(60_077, 'FIRST-MSG'), cxEvent(599_101, 'SECOND-MSG'))
        if (mode === 'fwd') return win(600_000, size, size, cxEvent(600_100, 'THIRD-MSG'))
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    let t = await drawnText(ui)
    expect(t).toMatch(/model\n · olay 2\nFIRST-MSG/)
    expect(t).toMatch(/model\n · olay 3\nSECOND-MSG/)
    expect(t).not.toMatch(/olay (60077|599101)/)
    size = 600_200
    h.stats[T] = { size, mtimeMs: NOW }
    await h.tick()
    t = await drawnText(ui)
    expect(t).not.toContain('FIRST-MSG') // trimmed off the front
    expect(t).toMatch(/model\n · olay 3\nSECOND-MSG/) // same number as before
    expect(t).toMatch(/model\n · olay 4\nTHIRD-MSG/)
    await ui.unmount()
  })

  test('Full flow renders content, not fields, for each backend; events without content are hidden; unknown shapes keep the field listing', async ($, on) => {
    const meta = (backend: string) => ({ meta: { ...RUN_A().meta, backend } })
    const cx = [
      rec(0, { type: 'thread.started', thread_id: 'THREAD-ID' }),
      rec(10, { type: 'turn.started' }),
      rec(20, { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'npm test', aggregated_output: '', status: 'in_progress' } }),
      rec(30, { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'npm test', aggregated_output: 'line1\nline2', exit_code: 1, status: 'failed' } }),
      rec(40, { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'CX-SAYS' } }),
      rec(50, { type: 'turn.completed', usage: { input_tokens: 99 } }),
      rec(60, { type: 'weird.event', foo: { bar: 1 } }),
    ]
    const ds = [
      rec(0, { type: 'system', subtype: 'init', session_id: 'SYS-INIT' }),
      rec(10, { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'DS-THINK' }, { type: 'text', text: 'DS-SAYS' }] } }),
      rec(20, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la' } }] } }),
      rec(30, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'DS-RESULT' }] }] } }),
    ]
    const cp = [
      rec(0, { type: 'session.start', data: { sessionId: 'CP-SESSION' } }),
      rec(10, { type: 'assistant.message', data: { content: 'CP-SAYS' } }),
      rec(20, { type: 'tool.execution_start', data: { toolCallId: 'c1', toolName: 'view', arguments: { path: '/a/b.ts' } } }),
      rec(30, { type: 'tool.execution_complete', data: { toolCallId: 'c1', success: true, result: { content: 'CP-RESULT' } } }),
    ]
    const oc = [
      rec(0, { type: 'step_start', part: { type: 'step-start' } }),
      rec(10, { type: 'text', part: { text: 'OC-SAYS' } }),
      rec(20, { type: 'tool_use', part: { callID: 'k1', tool: 'bash', state: { status: 'running', input: { command: 'echo hi' } } } }),
      rec(30, { type: 'tool_use', part: { callID: 'k1', tool: 'bash', state: { status: 'completed', input: { command: 'echo hi' }, output: 'OC-OUTPUT' } } }),
      rec(40, { type: 'step_finish', part: { tokens: { input: 1 } } }),
    ]
    const ag = [
      rec(0, { source: 'USER', type: 'USER_INPUT', content: 'AG-PROMPT' }),
      rec(10, { source: 'MODEL', type: 'PLANNER_RESPONSE', step_index: 1, content: 'AG-SAYS', tool_calls: [{ name: 'run_command', args: { toolSummary: 'AG-TOOL-SUMMARY' } }] }),
      rec(20, { source: 'MODEL', type: 'CODE_ACTION', step_index: 2, content: 'AG-OUTPUT' }),
    ]
    const by: Record<string, any[]> = { a: cx, b: ds, c: cp, d: oc, e: ag }
    stubRuns(on, { a: flowFix(), b: flowFix(meta('deepseek')), c: flowFix(meta('copilot')), d: flowFix(meta('opencode')), e: flowFix(meta('antigravity')) }, {
      helper: (mode, args) => (mode === 'back' ? win(0, 9000, 9000, ...by[args[0]!.split('/').at(-2)!]!) : ''),
    })
    const ui = await open($)
    const flowOf = async (k: string) => {
      await ui.press({ key: `run:${k}` })
      await ui.press({ key: 'tab:flow' })
      const t = await drawnText(ui)
      await ui.press({ key: 'back' })
      return t
    }
    let t = await flowOf('a')
    expect(t).toMatch(/komut\n · olay 4\n · exit \n1\n\$ npm test\nline1\nline2/)
    expect(countOf(t, '$ npm test')).toBe(1) // the started record gave way to the finished one
    expect(t).toContain('CX-SAYS')
    expect(t).not.toMatch(/THREAD-ID|thread\.started|turn\.completed|item\.id|item\.type|type: item\./)
    expect(t).toMatch(/weird\.event · olay 7\ntype: weird\.event\nfoo\.bar: 1/) // unknown shape: the field listing
    t = await flowOf('b')
    expect(t).toMatch(/DS-THINK/)
    expect(t).toContain('DS-SAYS')
    expect(t).toMatch(/tool Bash · olay 3\nls -la/)
    expect(t).toMatch(/result · olay 4\nDS-RESULT/)
    expect(t).not.toMatch(/SYS-INIT|tool_use_id|message\.content|toolu_1/)
    t = await flowOf('c')
    expect(t).toContain('CP-SAYS')
    expect(t).toMatch(/tool view · olay 3\npath: \/a\/b\.ts/)
    expect(t).toMatch(/result · olay 4\nCP-RESULT/)
    expect(t).not.toMatch(/CP-SESSION|toolCallId/)
    t = await flowOf('d')
    expect(t).toContain('OC-SAYS')
    expect(countOf(t, 'echo hi')).toBe(1)
    expect(t).toMatch(/tool bash · olay 4\necho hi\nOC-OUTPUT/)
    expect(t).not.toMatch(/step-start|part\./)
    t = await flowOf('e')
    expect(t).toContain('AG-SAYS')
    expect(t).toContain('▸ run_command AG-TOOL-SUMMARY')
    expect(t).toMatch(/result · olay 3\nAG-OUTPUT/)
    expect(t).not.toMatch(/AG-PROMPT|step_index/)
    await ui.unmount()
  })

  test('content rendering is masked too: a command, a tool input and a result', { options: EXACT }, async ($, on) => {
    stubRuns(on, { a: flowFix(), b: flowFix({ meta: { ...RUN_A().meta, backend: 'deepseek' } }) }, {
      helper: (mode, args) =>
        mode !== 'back' ? '' : args[0]!.split('/').at(-2) === 'a'
          ? win(0, 9000, 9000, rec(0, { type: 'item.completed', item: { id: 'i', type: 'command_execution', command: `curl -H "Authorization: Bearer GGGGGGGGGGGG" ${EXACT.deepseek_api_key}`, aggregated_output: LEAK, exit_code: 0 } }))
          : win(0, 9000, 9000, rec(0, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { env: { X_TOKEN: 'JJJJJJJJ' }, command: LEAK } }] } }), rec(9, { type: 'user', message: { content: [{ type: 'tool_result', content: LEAK }] } })),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    await expectMasked(ui)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'run:b' })
    await ui.press({ key: 'tab:flow' })
    await expectMasked(ui)
    await ui.unmount()
  })

  test('Summary: a command start line and its completion are one line (the completion, colored by exit); an unfinished start stays dim; clicking the merged line opens the event', async ($, on) => {
    const h = stubRuns(on, { a: RUN_A({ pid: ALIVE_PID }) }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 400, 400, { o: 0, t: '$ a' }, { o: 10, t: '$ b' }, { o: 20, t: '$ a (exit 0)' }, { o: 30, t: '$ b (exit 2)' }, { o: 40, t: '$ c' }, { o: 50, t: '$ d' }, { o: 60, t: '$ d' }, { o: 70, t: '$ d (exit 0)' })
        if (mode === 'event') return jl({ none: true })
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    const has = async (o: number) => (await ui.find({ type: 'Button', key: `line:${o}` })) !== undefined
    const props = async (o: number) => ((await ui.find({ type: 'Button', key: `line:${o}` }))?.children as any[]).map((c: any) => c.props)[0]
    expect([await has(0), await has(10)]).toEqual([false, false]) // starts of a and b gave way
    expect((await props(20)).color).toBe('green')
    expect((await props(30)).color).toBe('red')
    expect(await has(40)).toBe(true) // c has not finished
    expect((await props(40)).dimColor).toBe(true)
    expect([await has(50), await has(60), await has(70)]).toEqual([false, true, true]) // FIFO: one d start remains
    expect((await props(60)).dimColor).toBe(true)
    const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('line:'))
    expect(keys).toEqual(['line:20', 'line:30', 'line:40', 'line:60', 'line:70'])
    await ui.press({ key: 'line:20' })
    expect(helperCalls(h).filter(c => c[0] === 'event')).toEqual([['event', `${ROOT}/a`, '20']])
    await ui.unmount()
  })

  test('the Tam metin box sits directly under the view switch, above the stream, so it is on screen without scrolling', async ($, on) => {
    const evText = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', exit_code: 0 } })
    const many = Array.from({ length: 40 }, (_, i) => ({ o: i * 10, t: `· STREAM-${i}` }))
    stubRuns(on, { a: RUN_A() }, {
      helper: (mode, args) => (mode === 'back' ? win(0, 400, 400, ...many) : mode === 'event' ? jl({ o: 7, l: evText.length }, { t: evText, next: null }) : ''),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'line:390' })
    const t = await drawnText(ui)
    const at = (s: string) => t.indexOf(s)
    expect(at('Tam metin')).toBeGreaterThan(at('Tüm akış'))
    expect(at('Tam metin')).toBeLessThan(at('Özet (progress.log)'))
    expect(at('Tam metin')).toBeLessThan(at('STREAM-0'))
    expect(at('Tam metin')).toBeLessThan(at('STREAM-39'))
    await ui.unmount()
  })

  test('the verdict block comes after the stream, in Summary and in Full flow', async ($, on) => {
    stubRuns(on, { a: done('codex', 1000, { progress: 400, transcript: 9000, verdict: { state: 'done', exitCode: 0, verify: { commands: ['t'], exitCode: 0, failedAt: null, tail: '' } } }) }, {
      helper: (mode, args) => (mode === 'back' ? (args[0]!.endsWith('progress.log') ? win(0, 400, 400, { o: 0, t: '· SUMMARY-LINE' }) : win(0, 9000, 9000, cxEvent(0, 'FLOW-MSG'))) : ''),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    let t = await drawnText(ui)
        expect(t.indexOf('runner exit')).toBeGreaterThan(t.indexOf('SUMMARY-LINE'))
    await ui.press({ key: 'tab:flow' })
    t = await drawnText(ui)
    expect(t.indexOf('runner exit')).toBeGreaterThan(t.indexOf('FLOW-MSG'))
    await ui.unmount()
  })

  test('son aktivite says "verify sürüyor" while the worker is done, no verdict is there and the detached run is alive; "bitti" otherwise', async ($, on) => {
    const h = stubRuns(on, { a: done('codex', 1000) })
    h.runDirs.push('run-1', 'run-0')
    h.files[`${ROOT}/.runs/run-1/session`] = 'a\n'
    h.files[`${ROOT}/.runs/run-1/pid`] = `${ALIVE_PID}\n`
    h.files[`${ROOT}/.runs/run-0/session`] = 'someone-else\n'
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    expect(await detailText(ui)).toMatch(/son aktivite +\nverify sürüyor/)
    h.files[`${ROOT}/.runs/run-1/exit`] = '0\n' // the runner finished
    await h.tick()
    expect(await detailText(ui)).toMatch(/son aktivite +\nbitti/)
    await ui.unmount()
  })

  test('son aktivite falls back to "bitti" when kill -0 cannot be run, and the pane keeps working', async ($, on) => {
    const h = stubRuns(on, { c: done('codex', 1000) })
    h.runDirs.push('run-3')
    h.files[`${ROOT}/.runs/run-3/session`] = 'c\n'
    h.files[`${ROOT}/.runs/run-3/pid`] = `${KILL_THROWS_PID}\n`
    const ui = await open($)
    await ui.press({ key: 'run:c' })
    expect(await detailText(ui)).toMatch(/son aktivite +\nbitti/)
    await h.tick()
    expect(await detailText(ui)).toMatch(/son aktivite +\nbitti/)
    await ui.unmount()
  })

  test('a finished run with no runner record is scanned once, not every 5 s (#211)', async ($, on) => {
    const h = stubRuns(on, { c: done('codex', 1000) })
    h.runDirs.push('run-8', 'run-9')
    h.files[`${ROOT}/.runs/run-8/session`] = 'other-1\n'
    h.files[`${ROOT}/.runs/run-9/session`] = 'other-2\n'
    const ui = await open($)
    await ui.press({ key: 'run:c' })
    for (let i = 0; i < 4; i++) await h.tick(6000)
    const scans = h.rec.reads.filter(p => p.startsWith(`${ROOT}/.runs/`) && p.endsWith('/session'))
    expect(scans).toEqual([`${ROOT}/.runs/run-8/session`, `${ROOT}/.runs/run-9/session`]) // one pass over the two records
    await ui.unmount()
  })

  test('son aktivite stays "bitti" when the detached run\'s process is dead', async ($, on) => {
    const h = stubRuns(on, { b: done('codex', 1000) })
    h.runDirs.push('run-2')
    h.files[`${ROOT}/.runs/run-2/session`] = 'b\n'
    h.files[`${ROOT}/.runs/run-2/pid`] = '999\n' // not alive
    const ui = await open($)
    await ui.press({ key: 'run:b' })
    expect(await detailText(ui)).toMatch(/son aktivite +\nbitti/)
    await ui.unmount()
  })

  describe('renamed run dir', () => {
    const renameFix = (): Record<string, RunFix> => ({
      'cx-run-1': RUN_A({ meta: { sessionId: 'cx-1', backend: 'codex', model: 'gpt-x', branch: 'cd/run-1', parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: 'do it' } }),
    })
    const renameHelper = (mode: string, args: string[]) => {
      if (mode !== 'back') return ''
      if (args[0]!.startsWith(`${ROOT}/thread-9/`)) return args[0]!.endsWith('progress.log') ? win(0, 400, 400, { o: 0, t: 'progress from B' }) : win(0, 5000, 5000, { o: 0, t: JSON.stringify({ type: 'item.completed', text: 'event from B' }) })
      return win(0, 400, 400, { o: 0, t: 'progress from A' })
    }
    const rename = (h: ReturnType<typeof stubRuns>) => {
      const fix = h.runs['cx-run-1']!
      for (const k of Object.keys(h.files)) if (k.startsWith(`${ROOT}/cx-run-1/`)) delete h.files[k]
      for (const k of Object.keys(h.stats)) if (k.startsWith(`${ROOT}/cx-run-1/`)) delete h.stats[k]
      delete h.runs['cx-run-1']
      h.runs['thread-9'] = fix
      h.sync()
    }

    test('the open run continues from the renamed dir: Summary and Full flow read the new files, no "session dir is gone"', async ($, on) => {
      const h = stubRuns(on, renameFix(), { helper: renameHelper })
      const ui = await open($)
      await ui.press({ key: 'run:cx-run-1' })
      expect(await drawnText(ui)).toMatch(/progress from A/)
      rename(h)
      await h.tick()
      let t = await drawnText(ui)
      expect(t).not.toMatch(/session dir is gone/)
      expect(t).toMatch(/progress from B/)
      await ui.press({ key: 'tab:flow' })
      t = await drawnText(ui)
      expect(t).toMatch(/event from B/)
      expect(t).not.toMatch(/session dir is gone/)
      await ui.unmount()
    })

    test('the list has exactly one row for the renamed run', async ($, on) => {
      const h = stubRuns(on, renameFix(), { helper: renameHelper })
      const ui = await open($)
      await ui.press({ key: 'run:cx-run-1' })
      rename(h)
      await h.tick()
      await ui.press({ key: 'back' })
      await h.tick()
      const t = await drawnText(ui)
      expect(countOf(t, 'do it')).toBe(1)
      expect((await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('run:')).length).toBe(1)
      await ui.unmount()
    })

    test('a dir that vanishes with no match still shows "session dir is gone"', async ($, on) => {
      const h = stubRuns(on, renameFix(), { helper: renameHelper })
      const ui = await open($)
      await ui.press({ key: 'run:cx-run-1' })
      for (const k of Object.keys(h.stats)) if (k.startsWith(`${ROOT}/cx-run-1/`)) delete h.stats[k]
      delete h.runs['cx-run-1']
      await h.tick()
      expect(await drawnText(ui)).toMatch(/session dir is gone/)
      await ui.unmount()
    })
  })
})

// ---- review fixes on the 7.0.0 panes ----

describe('review fixes', () => {
  const OSC = '\x1b]52;c;EVILCLIP\x07'
  const CSI = '\x1b[31mEVILCSI'
  const notDrawn = async (ui: any) => {
    const tree = JSON.stringify(await ui.drawn())
    expect(tree).not.toContain('\\u001b')
    expect(tree).not.toContain('EVILCLIP')
  }
  const runFix = (extra: Partial<RunFix> = {}): RunFix => ({
    meta: { backend: 'codex', parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: 'do it' },
    status: { state: 'running', events: 7 },
    mtimeMs: NOW - 2_000,
    progress: 400,
    transcript: 600_000,
    ...extra,
  })
  const win = (from: number, to: number, size: number, ...recs: unknown[]) => jl({ from, to, size }, ...recs)
  const T = `${ROOT}/a/transcript.jsonl`
  const cxEvent = (o: number, text: string) => ({ o, t: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) })

  test('Full flow keeps reading while its window is behind the file, even when the size did not move since the last read', async ($, on) => {
    const h = stubRuns(on, { a: runFix() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 600_000, 600_000, cxEvent(0, 'FIRST-MSG'))
        if (mode === 'fwd' && args[1] === '600000') return win(600_000, 1_100_000, 1_300_000, cxEvent(700_000, 'MIDDLE-MSG'))
        if (mode === 'fwd' && args[1] === '1100000') return win(1_100_000, 1_300_000, 1_300_000, cxEvent(1_200_000, 'TAIL-MSG'))
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    h.stats[T] = { size: 1_300_000, mtimeMs: NOW }
    await h.tick()
    expect(helperCalls(h).filter(c => c[0] === 'fwd').map(c => c[2])).toEqual(['600000', '1100000'])
    expect(await drawnText(ui)).toContain('TAIL-MSG')
    await ui.unmount()
  })

  test('returning to Full flow catches up to the tail without waiting for a tick', async ($, on) => {
    const h = stubRuns(on, { a: runFix() }, {
      helper: (mode, args) => {
        if (mode === 'back') return win(0, 600_000, 600_000, cxEvent(0, 'FIRST-MSG'))
        if (mode === 'fwd') return win(600_000, 700_000, 700_000, cxEvent(650_000, 'LATE-MSG'))
        return ''
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    await ui.press({ key: 'tab:summary' })
    h.stats[T] = { size: 700_000, mtimeMs: NOW }
    await ui.press({ key: 'tab:flow' })
    expect(await drawnText(ui)).toContain('LATE-MSG')
    await ui.unmount()
  })

  test('a pane that could not be placed leaves no polling timer behind', async ($, on) => {
    const h = stubRuns(on, { a: runFix() }, { unplaced: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'cli-dispatch-runs' } as any)
    h.rec.lists = 0
    await h.tick()
    await h.tick()
    expect(h.rec.lists).toBe(0)
  })

  test('a github_pat_ token split across three copilot deltas is masked once merged', async ($, on) => {
    const body = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4P5q6R7s8T9u0'
    const parts = [`github_pat_${body.slice(0, 22)}`, body.slice(22, 32), body.slice(32)]
    stubRuns(on, { a: runFix({ meta: { backend: 'copilot', parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: 'cp' } }) }, {
      helper: mode => (mode === 'back' ? win(0, 600_000, 600_000, ...parts.map((d, i) => ({ o: i * 10, t: JSON.stringify({ type: 'assistant.reasoning_delta', data: { deltaContent: d } }) }))) : ''),
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    await ui.press({ key: 'tab:flow' })
    const tree = JSON.stringify(await ui.drawn())
    expect(tree).toContain('github_pat_')
    expect(tree).not.toContain(body.slice(0, 20))
    expect(tree).not.toContain(body.slice(22, 32)) // the tail of the token, not just its head
    await ui.unmount()
  })

  test('a key cut by a truncation limit is masked: a clipped progress.log line and the head of a big record (#209)', { options: { deepseek_api_key: 'dsk-EXACT-1111-2222-3333' } }, async ($, on) => {
    stubRuns(on, { a: runFix() }, {
      helper: (mode, args) => {
        if (mode !== 'back') return ''
        if (String(args[0]).endsWith('progress.log')) return win(0, 400, 400, { o: 0, t: '· the key is dsk-EXACT-1111-2…' })
        return win(0, 9000, 9000, { o: 5, l: 300_000, big: true, t: '{"a":"tail sk-abcdefghijklmnopqrstuvwxyz0123' })
      },
    })
    const ui = await open($)
    await ui.press({ key: 'run:a' })
    const summary = await drawnText(ui)
    expect(summary).toContain('the key is ••••…')
    expect(summary).not.toContain('EXACT')
    await ui.press({ key: 'tab:flow' })
    const flow = await drawnText(ui)
    expect(flow).not.toContain('abcdefghij')
    await ui.unmount()
  })

  test('escape sequences a worker wrote into status, verdict and meta never reach the drawn tree', async ($, on) => {
    stubRuns(on, {
      a: runFix({
        meta: { backend: `x${OSC}y`, parentSessionId: SID, startedAt: new Date(NOW - 125_000).toISOString(), promptPreview: 'p' },
        status: { state: `done${CSI}`, events: OSC, toolErrors: CSI, usage: { input_tokens: OSC, output_tokens: CSI }, sessionId: 'w' },
        mtimeMs: NOW - 60_000,
        verdict: { state: 'done', exitCode: OSC, verify: { commands: ['t'], exitCode: CSI, failedAt: 0, tail: '' }, fixAttempts: { used: OSC, max: CSI } },
      }),
    }, { helper: mode => (mode === 'back' ? win(0, 400, 400, { o: 0, t: '· x' }) : '') })
    const ui = await open($)
    await notDrawn(ui)
    await ui.press({ key: 'run:a' })
    await notDrawn(ui)
    expect(await detailText(ui)).toMatch(/fix attempts/)
    await ui.unmount()
  })

  test('escape sequences in a worker session do not reach the band', async ($, on) => {
    stubHost(on, {
      b: { meta: { backend: `x${OSC}y`, parentSessionId: SID }, status: { state: `done${CSI}` }, mtimeMs: NOW - 60_000 },
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    expect(await ui.find({ type: 'Text', text: /■/ })).toBeDefined()
    await notDrawn(ui)
    await ui.unmount()
  })

  test('dispatch still returns the run summary when kill -0 cannot be run during the band refresh', async ($, on) => {
    const written: Record<string, string> = {}
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('env.get', ($: any, e: any) => ({ value: e.name === 'CLI_DISPATCH_SESSIONS_DIR' ? ROOT : e.name === 'TMPDIR' ? '/tmp/' : undefined }))
    on('session.id', () => ({ value: SID }))
    on('clock.now', () => ({ value: NOW }))
    on('clock.every', () => ({ value: undefined }))
    on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__cli-dispatch__${e.name}` } }))
    on('fs.exists', () => ({ value: true }))
    on('fs.list', () => ({ value: [{ name: 'q', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
    on('fs.write', ($: any, e: any) => { written[e.path] = e.content; return { value: undefined } })
    on('fs.read', ($: any, e: any) => {
      const f: Record<string, string> = {
        [`${ROOT}/q/meta.json`]: JSON.stringify({ backend: 'codex', parentSessionId: SID }),
        [`${ROOT}/q/status.json`]: JSON.stringify({ state: 'running' }),
        [`${ROOT}/q/worker.pid`]: '4242\n',
      }
      if (!(e.path in f)) throw new Error(`ENOENT ${e.path}`)
      return { value: f[e.path]! }
    })
    on('fs.stat', ($: any, e: any) => {
      if (e.path.endsWith('status.json')) return { value: { kind: 'file', size: 1, mtimeMs: NOW - 300_000, realPath: e.path, isLink: false } }
      throw new Error('ENOENT')
    })
    on('process.run', ($: any, e: any) => {
      if (e.argv[0] === 'kill') throw new Error('spawn kill ENOENT')
      const stdout = e.argv[0] === 'cli-dispatch-run' ? 'run: run-7\n' : 'exit: 0  session: s-1  state: done  verify: pass\n'
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 'fix it' } as any)
    expect(String(r.result ?? r.text)).toMatch(/verify: pass/)
    expect(r.isError).toBeUndefined()
  })
})

// ---- 7.1.0: the Ollama backend (ol) -------------------------------------------------------------

describe('ollama backend', () => {
  test('dispatch with backend ol runs the runner detached with --backend ol and hands over no key', { options: { deepseek_api_key: 'ds-S', codex_api_key: 'cx-S' } }, async ($, on) => {
    const h = stubDispatch(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'ol', cwd: '/repo', task: 'fix it', model: 'qwen3.8:27b' } as any)
    expect(String(r.result ?? r.text)).toMatch(/verify: pass/)
    const run = h.calls.find(c => c.argv[0] === 'cli-dispatch-run')!
    expect(run.argv.slice(0, 4)).toEqual(['cli-dispatch-run', '--detach', '--backend', 'ol'])
    expect(run.argv.filter((a, i) => run.argv[i - 1] === '--model')).toEqual(['qwen3.8:27b'])
    expect(run.env).toEqual({ CLAUDE_CODE_SESSION_ID: SID })
  })

  test('the bad-backend message lists ol', async ($, on) => {
    stubDispatch(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const bad: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'zz', cwd: '/repo', task: 't' } as any)
    expect(String(bad.result ?? bad.text)).toMatch(/backend must be one of ds, ag, cx, oc, cp, ol/)
  })

  test('the band labels a running ollama worker ol', async ($, on) => {
    stubHost(on, { a: running('ollama', '/tmp/ds-wt-1') })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any)
    expect(await ui.find({ type: 'Text', text: /▶ ol 2m05s/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ollama/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the setup pane shows Ollama with no key and its three settings', async ($, on) => {
    const status = JSON.stringify({ path: '/home/u/.config/cli-dispatch/config', exists: true, keys: {}, models: {}, settings: { OL_MODEL: '', OLLAMA_BASE_URL: 'http://10.0.0.5:11434', OL_CONTEXT: '' } })
    const h = stubSetup(on, { sh: 'claude\nol-agent\n', status })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'cli-dispatch-config' } as any)
    const ui = await $.ui.mount({ plugin: 'cli-dispatch', surface: 'terminal', component: 'Pane', requestId: 'setup', props: PANE })
    expect(await ui.find({ type: 'Text', text: /ol-agent ✓/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /key: – none \(local\)/ })).toBeDefined()
    for (const k of ['OL_MODEL', 'OLLAMA_BASE_URL', 'OL_CONTEXT']) expect(await ui.find({ type: 'Input', key: k })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('http://10.0.0.5:11434')
    await ui.input({ key: 'OLLAMA_BASE_URL', text: 'http://127.0.0.1:11434' })
    expect(h.calls.find(c => c.argv[2] === 'set')!.argv.slice(2)).toEqual(['set', 'OLLAMA_BASE_URL', 'http://127.0.0.1:11434'])
    await ui.press({ key: 'install:ol' })
    await ui.press({ key: 'install' })
    expect(h.calls.find(c => c.argv[0] === 'bash' && c.argv[1]!.endsWith('install.sh'))!.argv).toEqual(['bash', '/resolved/root/scripts/install.sh', '--backends', 'ollama', '--non-interactive'])
    await ui.unmount()
  })
})
