import { describe, expect, test } from 'claude-code/testing'

const ROOT = '/sessions'
const NOW = Date.parse('2026-10-12T10:00:00Z')
const SID = 'parent-1'
const ALIVE_PID = '4242'

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
    if (e.argv[0] === 'kill') return { value: { exitCode: e.argv[2] === ALIVE_PID ? 0 : 1, stdout: '', stderr: '' } }
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
    const r: any = await $.tool.call({ tool: 'mcp__cli-dispatch__dispatch', backend: 'cx', cwd: '/repo', task: 'fix it', verify: ['node --test', "echo 'a b'"] } as any)
    expect(String(r.result ?? r.text)).toMatch(/verify: pass/)
    const run = h.calls[0]!
    expect(run.argv.slice(0, 6)).toEqual(['cli-dispatch-run', '--detach', '--backend', 'cx', '--cwd', '/repo'])
    expect(run.argv).toContain('--fix-attempts')
    expect(run.argv.filter((a, i) => run.argv[i - 1] === '--verify')).toEqual(['node --test', "echo 'a b'"])
    expect(run.env?.CLAUDE_CODE_SESSION_ID).toBe(SID)
    const briefPath = run.argv[run.argv.indexOf('--prompt-file') + 1]!
    expect(h.written[briefPath]).toBe('fix it')
    expect(h.calls.filter(c => c.argv[0] === 'cli-dispatch-wait').length).toBe(2)
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
