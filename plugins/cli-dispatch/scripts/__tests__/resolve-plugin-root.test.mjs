// resolve-plugin-root.test.mjs — issue #150.
//
// Two things are guarded here:
//   1. resolve-plugin-root.sh picks the NEWEST plugin root, and only ever swaps away from the
//      session's own root when it can prove the cache holds something newer.
//   2. /cli-dispatch:run survives `cli-dispatch-run` being absent from PATH — the exact state
//      a plugin upgrade leaves behind, since upgrading refreshes the versioned cache dir and
//      never re-runs install.sh.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/resolve-plugin-root.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const scriptsDir = path.resolve(here, '..')
const commandsDir = path.resolve(scriptsDir, '..', 'commands')
const RESOLVER = path.join(scriptsDir, 'resolve-plugin-root.sh')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-resolve-'))
after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// Builds a fixture: a session plugin root at <name>/session (version `sessionVersion`, or no
// manifest at all when null) plus a cache dir holding one dir per entry in `cacheVersions`.
function fixture(name, sessionVersion, cacheVersions, { installerName = 'install.sh' } = {}) {
  const root = path.join(tmpRoot, name)
  const session = path.join(root, 'session')
  const cache = path.join(root, 'cache')
  fs.mkdirSync(path.join(session, 'scripts'), { recursive: true })
  if (sessionVersion !== null) {
    fs.mkdirSync(path.join(session, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(
      path.join(session, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ version: sessionVersion })
    )
  }
  for (const v of cacheVersions) {
    const d = path.join(cache, v, 'scripts')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, installerName), '#!/usr/bin/env bash\n')
  }
  return { root, session, cache }
}

function resolve(fx, sessionRootOverride) {
  const arg = sessionRootOverride === undefined ? fx.session : sessionRootOverride
  const res = spawnSync('bash', [RESOLVER, arg], {
    env: { ...process.env, CLI_DISPATCH_PLUGIN_CACHE_DIR: fx.cache },
    encoding: 'utf8',
  })
  return { stdout: res.stdout.trim(), stderr: res.stderr, status: res.status }
}

test('1. session older than the cache -> resolves to the newest cache dir, with a note', () => {
  const fx = fixture('older', '3.30.1', ['3.30.1', '4.16.0', '4.17.0'])
  const r = resolve(fx)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, path.join(fx.cache, '4.17.0'))
  assert.match(r.stderr, /3\.30\.1/)
  assert.match(r.stderr, /4\.17\.0/)
})

test('2. version ordering is numeric per field, not lexicographic', () => {
  const fx = fixture('ordering', '4.9.0', ['4.9.0', '4.10.0'])
  assert.equal(resolve(fx).stdout, path.join(fx.cache, '4.10.0'))
})

test('3. session newer than the cache (dev checkout) -> keeps the session root, silently', () => {
  const fx = fixture('newer', '4.99.0', ['4.16.0', '4.17.0'])
  const r = resolve(fx)
  assert.equal(r.stdout, fx.session)
  assert.equal(r.stderr, '', 'no swap means no note')
})

test('4. equal versions keep the session root', () => {
  const fx = fixture('equal', '4.17.0', ['4.17.0'])
  assert.equal(resolve(fx).stdout, fx.session)
})

test('5. a cache dir without an installer is not a candidate', () => {
  // 4.17.0 exists but carries install.ps1 only — the bash resolver must ignore it and stay put
  // rather than hand back a root whose scripts/install.sh does not exist.
  const fx = fixture('no-installer', '4.16.0', ['4.17.0'], { installerName: 'install.ps1' })
  assert.equal(resolve(fx).stdout, fx.session)
})

test('6. unparseable versions never trigger a swap', () => {
  const fx = fixture('junk', '4.16.0', ['latest', 'v4.17.0', 'tmp'])
  const r = resolve(fx)
  assert.equal(r.stdout, fx.session)
  assert.equal(r.stderr, '')
})

test('7. session root with no manifest keeps the session root (local checkout, unknown version)', () => {
  const fx = fixture('no-manifest', null, ['4.17.0'])
  assert.equal(resolve(fx).stdout, fx.session)
})

test('8. missing session root falls back to the newest cache dir', () => {
  const fx = fixture('no-session', '4.16.0', ['4.16.0', '4.17.0'])
  assert.equal(resolve(fx, path.join(fx.root, 'does-not-exist')).stdout, path.join(fx.cache, '4.17.0'))
})

test('9. nothing resolvable -> exit 1 and no stdout', () => {
  const fx = fixture('nothing', '4.16.0', [])
  const r = resolve(fx, '')
  assert.equal(r.status, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /no usable plugin root/)
})

// ============================================================================
// /cli-dispatch:run — behaviour when cli-dispatch-run is missing from PATH
// ============================================================================

// Extracts run.md's bash fence with $ARGUMENTS and ${CLAUDE_PLUGIN_ROOT} substituted, so the
// real shipped shell is what gets exercised — not a paraphrase of it.
function runMdBlock(pluginRoot) {
  const md = fs.readFileSync(path.join(commandsDir, 'run.md'), 'utf8')
  const fence = /^```bash\n([\s\S]*?)^```/m.exec(md)
  assert.ok(fence, 'run.md must still carry a bash fence')
  return fence[1]
    .replace(/\$ARGUMENTS/g, 'ds "do a thing"')
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
}

// A PATH deliberately without ~/.local/bin: the post-upgrade state where the wrappers a newer
// version introduced were never installed.
function runWithoutRunnerOnPath(name, { withPluginCopy }) {
  const root = path.join(tmpRoot, name)
  const scripts = path.join(root, 'scripts')
  fs.mkdirSync(scripts, { recursive: true })
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '4.18.0' }))
  fs.copyFileSync(RESOLVER, path.join(scripts, 'resolve-plugin-root.sh'))
  if (withPluginCopy) {
    fs.writeFileSync(
      path.join(scripts, 'cli-dispatch-run'),
      '#!/usr/bin/env bash\necho "STUB RUNNER: $*"\nexit 3\n'
    )
  }
  const blockPath = path.join(root, 'block.sh')
  fs.writeFileSync(blockPath, runMdBlock(root))
  return spawnSync('bash', [blockPath], {
    cwd: root,
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      CLI_DISPATCH_PLUGIN_CACHE_DIR: path.join(root, 'empty-cache'),
    },
    encoding: 'utf8',
  })
}

test('10. runner missing from PATH -> falls back to the plugin copy and preserves its exit code', () => {
  const res = runWithoutRunnerOnPath('run-fallback', { withPluginCopy: true })
  assert.match(res.stdout, /STUB RUNNER: .*--backend ds/, 'the plugin copy must actually be invoked')
  assert.match(res.stdout, /not on PATH/, 'must say the wrapper is missing')
  assert.match(res.stdout, /refreshes the plugin cache only/, 'must name the CAUSE, not just the symptom')
  assert.match(res.stdout, /\/cli-dispatch:setup/, 'must name the one-time fix')
  assert.equal(res.status, 3, "the runner's exit code must survive the fallback")
})

test('11. no wrapper and no plugin copy -> exit 1, cause + fix + per-backend fallback', () => {
  const res = runWithoutRunnerOnPath('run-hardfail', { withPluginCopy: false })
  assert.equal(res.status, 1)
  assert.match(res.stdout, /upgraded the plugin/, 'must name the likely cause')
  assert.match(res.stdout, /\/cli-dispatch:setup/, 'must name the fix')
  assert.match(res.stdout, /\/cli-dispatch:ds-run/, 'must keep the per-backend fallback suggestion')
})

// ============================================================================
// setup.md — must not pin a version into the install path (the reporter's #2)
// ============================================================================

test('12. setup.md resolves the plugin root at runtime instead of pinning a version', () => {
  const md = fs.readFileSync(path.join(commandsDir, 'setup.md'), 'utf8')
  assert.ok(md.includes('resolve-plugin-root.sh'), 'the bash branch must resolve the root')
  assert.ok(md.includes('resolve-plugin-root.ps1'), 'the PowerShell branch must resolve the root too')
  assert.ok(
    !/plugins\/cache\/cli-dispatch\/cli-dispatch\/\d+\.\d+\.\d+/.test(md),
    'no versioned cache path may be baked into setup.md'
  )
  assert.ok(
    !/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/install\.(sh|ps1)/.test(md),
    'the installer must never be invoked straight from the session root'
  )
})

test('13. both resolver twins ship', () => {
  for (const f of ['resolve-plugin-root.sh', 'resolve-plugin-root.ps1'])
    assert.ok(fs.existsSync(path.join(scriptsDir, f)), `${f} must exist`)
  execFileSync('bash', ['-n', RESOLVER])
})
