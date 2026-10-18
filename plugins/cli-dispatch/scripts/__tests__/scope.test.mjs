// scope.test.mjs — `cli-dispatch-run --scope <glob>` (issue #205): a run whose worker changed a
// file outside every given glob fails with exit 2 even when verify passes, like a leak.
//
// Test seam (same as runner-agent.test.mjs): `--resume <id>` re-attaches to a seeded terminal
// session, so no real worker runs; the seeded changed-files.json is the "measured" diff.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { scopeViolations } from '../verdict-writer.mjs'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(SELF_DIR, '..')
const RUNNER = path.join(SCRIPTS, 'cli-dispatch-run')
const SUMMARY = path.join(SCRIPTS, 'cli-dispatch-run-summary.sh')
const WRITER = path.join(SCRIPTS, 'verdict-writer.mjs')
const SID = 'ds-scope-session'

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

function fixture(changed) {
  const repo = mkdtemp('cd-scope-repo-')
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
  execSync('git init -q', { cwd: repo, env })
  fs.writeFileSync(path.join(repo, 'note.txt'), 'seed\n')
  execSync('git add note.txt && git commit -q -m seed', { cwd: repo, env })
  const root = mkdtemp('cd-scope-sessions-')
  const dir = path.join(root, SID)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ state: 'done', sessionId: SID }))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: repo, model: 'test-model' }))
  fs.writeFileSync(path.join(dir, 'changed-files.json'), JSON.stringify({ files: changed.map((p) => (typeof p === 'string' ? { path: p, status: 'M' } : p)), diffstat: '' }))
  const envOut = { ...process.env, CLI_DISPATCH_SESSIONS_DIR: root, CLI_DISPATCH_VERDICT_WRITER: WRITER }
  return { dir, env: envOut, repo, cleanup: () => { rmrf(repo); rmrf(root) } }
}

const runner = (f, extra) => spawnSync('bash', [RUNNER, '--backend', 'ds', '--cwd', f.repo, '--resume', SID, ...extra], { encoding: 'utf8', env: f.env, timeout: 60000 })
const verdictOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf8'))

test('scopeViolations: ** crosses directories, * does not, a plain path covers what is under it', () => {
  const files = ['src/auth/login.ts', 'src/auth/deep/x.ts', 'src/db.ts', 'package.json', 'docs/a.md', 'srcx/a.ts']
  assert.deepEqual(scopeViolations(files, ['src/auth/**']), ['src/db.ts', 'package.json', 'docs/a.md', 'srcx/a.ts'])
  assert.deepEqual(scopeViolations(files, ['src/*.ts']), ['src/auth/login.ts', 'src/auth/deep/x.ts', 'package.json', 'docs/a.md', 'srcx/a.ts'])
  assert.deepEqual(scopeViolations(files, ['src', 'docs/a.md']), ['package.json', 'srcx/a.ts'])
  assert.deepEqual(scopeViolations(files, ['**/*.ts', '*.json']), ['docs/a.md'])
  assert.deepEqual(scopeViolations(['a.ts'], ['?.ts']), [])
  assert.deepEqual(scopeViolations(['a+b.ts'], ['a+b.ts']), [], 'regex metacharacters are literal')
})

test('--scope: a change outside every glob fails the run with exit 2 even though verify passes', () => {
  const f = fixture(['src/auth/login.ts', 'package.json'])
  try {
    const r = runner(f, ['--verify', 'true', '--scope', 'src/auth/**'])
    assert.equal(r.status, 2, r.stdout + r.stderr)
    const v = verdictOf(f.dir)
    assert.equal(v.exitCode, 2)
    assert.equal(v.verify.exitCode, 0, 'verify itself passed')
    assert.deepEqual(v.scope, ['src/auth/**'])
    assert.deepEqual(v.scopeViolations, ['package.json'])
  } finally { f.cleanup() }
})

test('--scope: every change inside a glob passes; --scope repeats', () => {
  const f = fixture(['src/auth/login.ts', 'package.json'])
  try {
    const r = runner(f, ['--verify', 'true', '--scope', 'src/auth/**', '--scope', 'package.json'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const v = verdictOf(f.dir)
    assert.equal(v.exitCode, 0)
    assert.deepEqual(v.scopeViolations, [])
  } finally { f.cleanup() }
})

test("scopeViolations: the runner's own artifacts are never out of scope", () => {
  const files = ['sum.mjs', 'worker-report.json', 'sub/worker-report.json', 'node_modules', 'pkg/node_modules/x.js']
  assert.deepEqual(scopeViolations(files, ['sum.mjs']), [])
})

test('--scope: the worker-report.json the runner asks for does not fail the run', () => {
  // A real run reports the report as untracked (`??`), the only status the exemption covers.
  const f = fixture(['sum.mjs', { path: 'worker-report.json', status: '??' }])
  try {
    const r = runner(f, ['--verify', 'true', '--scope', 'sum.mjs'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(verdictOf(f.dir).scopeViolations, [])
  } finally { f.cleanup() }
})

test('--scope: a TRACKED file under node_modules, or a tracked worker-report.json, is a violation', () => {
  const f = fixture(['sum.mjs', { path: 'vendor/node_modules/x.js', status: 'M' }, { path: 'lib/worker-report.json', status: 'M' }])
  try {
    const r = runner(f, ['--verify', 'true', '--scope', 'sum.mjs'])
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.deepEqual(verdictOf(f.dir).scopeViolations, ['vendor/node_modules/x.js', 'lib/worker-report.json'])
  } finally { f.cleanup() }
})

test('scopeViolations: only untracked runner artifacts are exempt', () => {
  const files = [
    { path: 'sum.mjs', status: 'M' },
    { path: 'worker-report.json', status: '??' },
    { path: 'node_modules', status: '??' },
    { path: 'vendor/node_modules/x.js', status: 'M' },
  ]
  assert.deepEqual(scopeViolations(files, ['sum.mjs']), ['vendor/node_modules/x.js'])
})

test('--scope: a verify FAIL stays exit 1 (scope does not mask it)', () => {
  const f = fixture(['package.json'])
  try {
    const r = runner(f, ['--verify', 'false', '--scope', 'src/**'])
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.deepEqual(verdictOf(f.dir).scopeViolations, ['package.json'])
  } finally { f.cleanup() }
})

test('without --scope nothing changes: exit 0 and no scope fields in the verdict', () => {
  const f = fixture(['package.json'])
  try {
    const r = runner(f, ['--verify', 'true'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const v = verdictOf(f.dir)
    assert.equal('scope' in v, false)
    assert.equal('scopeViolations' in v, false)
  } finally { f.cleanup() }
})

test('the compact summary names the files outside the scope', () => {
  const f = fixture(['src/a.ts', 'package.json', 'yarn.lock'])
  try {
    runner(f, ['--verify', 'true', '--scope', 'src/**'])
    const s = spawnSync('bash', [SUMMARY, path.join(f.dir, 'verdict.json'), '2'], { encoding: 'utf8' })
    assert.match(s.stdout, /SCOPE: changed outside --scope \(src\/\*\*\): package\.json, yarn\.lock/)
  } finally { f.cleanup() }
})

test('the PowerShell twin takes --scope too (parity)', () => {
  const ps1 = fs.readFileSync(path.join(SCRIPTS, 'cli-dispatch-run.ps1'), 'utf8')
  assert.match(ps1, /'--scope'/)
  assert.match(ps1, /CLI_DISPATCH_SCOPE/)
})
