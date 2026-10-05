// Issue #171: an unwritable session root must fail fast with ONE actionable line and exit 5,
// before any worker is launched — not scatter mkdir/write errors across the run.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

function setup() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ro-root-')))
  const bin = path.join(root, 'bin'), ro = path.join(root, 'ro'), repo = path.join(root, 'repo'), home = path.join(root, 'home')
  for (const d of [bin, ro, repo, home]) mkdirSync(d)
  writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\ntouch "${root}/claude-called"\n`)
  chmodSync(path.join(bin, 'claude'), 0o755)
  const git = a => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
  git(['init', '-q']); git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base'])
  chmodSync(ro, 0o500)
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, DEEPSEEK_API_KEY: 'dummy',
    CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: ro }
  return { root, ro, repo, env }
}
const cleanup = x => { chmodSync(x.ro, 0o700); rmSync(x.root, { recursive: true, force: true }) }

for (const [name, argv] of [
  ['cli-dispatch-run', x => ['cli-dispatch-run', '--backend', 'ds', '--cwd', x.repo, '--prompt', 'x']],
  ['claude-ds-stream', x => ['claude-ds-stream', '-p', 'x', '--cwd', x.repo]],
]) {
  test(`${name}: unwritable sessions root exits 5 with one actionable line, launches nothing`, { skip: isRoot }, () => {
    const x = setup()
    try {
      const [script, ...args] = argv(x)
      const r = spawnSync('bash', [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', timeout: 60000, env: x.env })
      assert.equal(r.status, 5, `stderr: ${r.stderr}`)
      const msg = r.stderr.split('\n').filter(l => l.includes('not writable'))
      assert.equal(msg.length, 1, `stderr: ${r.stderr}`)
      assert.match(msg[0], /CLI_DISPATCH_SESSIONS_DIR/)
      assert.ok(msg[0].includes(x.ro))
      assert.equal(existsSync(path.join(x.root, 'claude-called')), false)
      assert.deepEqual(readdirSync(x.ro), [])
    } finally { cleanup(x) }
  })
}
