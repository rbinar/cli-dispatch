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
