// config-file.mjs holds the rules for the file every *-stream SOURCES as bash. The mod's setup
// pane calls it to read key flags and to write model names, so it must never write a key and never
// print one.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CF = path.join(HERE, '..', 'config-file.mjs')

const CONFIG = [
  '# cli-dispatch config',
  'DEEPSEEK_API_KEY="sk-secret-ds"',
  'DS_MODEL="old-a"',
  '  export DS_MODEL="old-b"',
  'OPENROUTER_API_KEY=""',
  'CX_MODEL=""',
  '',
].join('\n')

function run(args, env = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'cf-home-'))
  const r = spawnSync(process.execPath, [CF, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...env },
  })
  return { ...r, home }
}

function fixture(text = CONFIG) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cf-'))
  const cfg = path.join(dir, 'config')
  writeFileSync(cfg, text, { mode: 0o644 })
  return { dir, cfg, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('set rewrites every assignment of the model variable, leaves other bytes, mode 0600', () => {
  const f = fixture()
  const r = run(['set', 'DS_MODEL', 'new-v'], { CLI_DISPATCH_CONFIG: f.cfg })
  assert.equal(r.status, 0, r.stderr)
  const out = readFileSync(f.cfg, 'utf8')
  assert.equal(out, CONFIG.replace('DS_MODEL="old-a"', 'DS_MODEL="new-v"').replace('DS_MODEL="old-b"', 'DS_MODEL="new-v"'))
  assert.equal(statSync(f.cfg).mode & 0o777, 0o600)
  f.cleanup()
})

test('set writes through a symlinked config and keeps the link', () => {
  const f = fixture()
  const link = path.join(f.dir, 'link')
  symlinkSync(f.cfg, link)
  const r = run(['set', 'CX_MODEL', 'gpt-x'], { CLI_DISPATCH_CONFIG: link })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(lstatSync(link).isSymbolicLink())
  assert.match(readFileSync(f.cfg, 'utf8'), /^CX_MODEL="gpt-x"$/m)
  f.cleanup()
})

test('set refuses a key variable and a value that could execute when sourced, and changes nothing', () => {
  const f = fixture()
  for (const args of [['set', 'DEEPSEEK_API_KEY', 'x'], ['set', 'DS_MODEL', '$(id)'], ['set', 'DS_MODEL', 'a"b'], ['set', 'DS_MODEL', 'a`b'], ['set', 'DS_MODEL', 'a\nb'], ['set', 'NOPE', 'x']]) {
    const r = run(args, { CLI_DISPATCH_CONFIG: f.cfg })
    assert.equal(r.status, 3, args.join(' '))
  }
  assert.equal(readFileSync(f.cfg, 'utf8'), CONFIG)
  f.cleanup()
})

test('set with no config file exits 4 and creates nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cf-'))
  const cfg = path.join(dir, 'config')
  const r = run(['set', 'DS_MODEL', 'x'], { CLI_DISPATCH_CONFIG: cfg })
  assert.equal(r.status, 4)
  assert.equal(existsSync(cfg), false)
  assert.deepEqual(readdirSync(dir), [])
  rmSync(dir, { recursive: true, force: true })
})

test('status reports key booleans and model values, never a key value', () => {
  const f = fixture()
  const r = run(['status'], { CLI_DISPATCH_CONFIG: f.cfg })
  assert.equal(r.status, 0)
  const s = JSON.parse(r.stdout)
  assert.equal(s.path, f.cfg)
  assert.equal(s.exists, true)
  assert.deepEqual(s.keys, { DEEPSEEK_API_KEY: true, GEMINI_API_KEY: false, CODEX_API_KEY: false, OPENROUTER_API_KEY: false, COPILOT_GITHUB_TOKEN: false })
  assert.equal(s.models.DS_MODEL, 'old-b')
  assert.ok(!r.stdout.includes('sk-secret-ds'))
  f.cleanup()
})

test('status follows the path order: CLI_DISPATCH_CONFIG, CLAUDE_DS_CONFIG, default, legacy', () => {
  const a = fixture('DS_MODEL="a"\n')
  const b = fixture('DS_MODEL="b"\n')
  assert.equal(JSON.parse(run(['status'], { CLI_DISPATCH_CONFIG: a.cfg, CLAUDE_DS_CONFIG: b.cfg }).stdout).path, a.cfg)
  assert.equal(JSON.parse(run(['status'], { CLAUDE_DS_CONFIG: b.cfg }).stdout).path, b.cfg)

  const home = mkdtempSync(path.join(tmpdir(), 'cf-home-'))
  const legacy = path.join(home, '.config', 'claude-ds', 'config')
  mkdirSync(path.dirname(legacy), { recursive: true })
  writeFileSync(legacy, 'DS_MODEL="legacy"\n')
  const spawn = () => JSON.parse(spawnSync(process.execPath, [CF, 'status'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } }).stdout)
  assert.equal(spawn().path, legacy)
  const fresh = path.join(home, '.config', 'cli-dispatch', 'config')
  mkdirSync(path.dirname(fresh), { recursive: true })
  writeFileSync(fresh, 'DS_MODEL="new"\n')
  assert.equal(spawn().path, fresh)
  assert.equal(spawn().exists, true)
  a.cleanup(); b.cleanup(); rmSync(home, { recursive: true, force: true })
})

test('status on a missing file says exists:false', () => {
  const s = JSON.parse(run(['status'], { CLI_DISPATCH_CONFIG: '/nonexistent/cfg' }).stdout)
  assert.equal(s.exists, false)
})

test('a line with a second assignment is unparseable: status hides it, set refuses and changes nothing', () => {
  for (const line of [
    'export DS_MODEL=deepseek-v4-pro DEEPSEEK_API_KEY=sk-live-abcdefghijklmnop',
    'DS_MODEL="old" ; DEEPSEEK_API_KEY="sk-2"',
  ]) {
    const text = line + '\n'
    const f = fixture(text)
    const s = JSON.parse(run(['status'], { CLI_DISPATCH_CONFIG: f.cfg }).stdout)
    assert.equal(s.models.DS_MODEL, '')
    assert.deepEqual(s.unparsed, ['DS_MODEL'])
    assert.doesNotMatch(JSON.stringify(s), /sk-live|sk-2/)
    const r = run(['set', 'DS_MODEL', 'new'], { CLI_DISPATCH_CONFIG: f.cfg })
    assert.equal(r.status, 3)
    assert.equal(readFileSync(f.cfg, 'utf8'), text)
    f.cleanup()
  }
})

test('quoted, single-quoted, bare and commented right-hand sides stay parseable', () => {
  const f = fixture('DS_MODEL=bare-1 # note\nAG_MODEL=\'sq\'\nCX_MODEL="dq" # c\n')
  const s = JSON.parse(run(['status'], { CLI_DISPATCH_CONFIG: f.cfg }).stdout)
  assert.deepEqual(s.models, { DS_MODEL: 'bare-1', DS_FLASH_MODEL: '', AG_MODEL: 'sq', CX_MODEL: 'dq', OC_MODEL: '', CP_MODEL: '' })
  assert.deepEqual(s.unparsed, [])
  f.cleanup()
})
