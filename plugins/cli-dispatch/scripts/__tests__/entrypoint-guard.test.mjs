import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(SELF_DIR, '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '../../..')
const SCRIPT_NAMES = [
  'check-version-sync.mjs',
  'verdict-writer.mjs',
  'gain-report.mjs',
  'policy-inject.mjs',
]

const tmpDirs = new Set()

after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeLinkedRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-entrypoint-'))
  tmpDirs.add(dir)
  const link = path.join(dir, 'link')
  try {
    fs.symlinkSync(REPO_ROOT, link, 'dir')
  } catch (error) {
    t.skip(`symlink creation is not permitted: ${error.message}`)
  }
  return link
}

function runNode(scriptPath, { args = [], env = {} } = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function linkedScript(link, scriptName) {
  return path.join(link, 'plugins', 'cli-dispatch', 'scripts', scriptName)
}

test('entrypoint guards do not use raw argv path URL comparison', () => {
  for (const scriptName of SCRIPT_NAMES) {
    const source = fs.readFileSync(path.join(SCRIPTS_DIR, scriptName), 'utf8')
    assert.ok(
      !source.includes('import.meta.url === pathToFileURL(process.argv[1]).href'),
      `${scriptName} must not compare import.meta.url to raw process.argv[1]`
    )
  }
})

test('check-version-sync.mjs runs through a symlinked repo path', (t) => {
  const link = makeLinkedRepo(t)
  const res = runNode(linkedScript(link, 'check-version-sync.mjs'))

  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.notEqual(res.stdout.trim(), '')
  assert.match(res.stdout, /version sync/)
})

test('verdict-writer.mjs runs through a symlinked repo path', (t) => {
  const link = makeLinkedRepo(t)
  const res = runNode(linkedScript(link, 'verdict-writer.mjs'))

  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /usage: verdict-writer\.mjs/)
})

test('gain-report.mjs runs through a symlinked repo path', (t) => {
  const link = makeLinkedRepo(t)
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-entrypoint-sessions-'))
  tmpDirs.add(sessionsDir)
  const res = runNode(linkedScript(link, 'gain-report.mjs'), {
    env: { CLI_DISPATCH_SESSIONS_DIR: sessionsDir },
  })

  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.notEqual(res.stdout.trim(), '')
  assert.match(res.stdout, /root:/)
})

test('policy-inject.mjs runs through a symlinked repo path', (t) => {
  const link = makeLinkedRepo(t)
  const policyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-entrypoint-policy-'))
  tmpDirs.add(policyDir)
  const policyFile = path.join(policyDir, 'policy.json')
  fs.writeFileSync(policyFile, JSON.stringify({ enabled: true }))
  const res = runNode(linkedScript(link, 'policy-inject.mjs'), {
    env: { CLI_DISPATCH_POLICY_FILE: policyFile },
  })

  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.notEqual(res.stdout.trim(), '')
  assert.match(res.stdout, /SessionStart/)
})
