// CX_SANDBOX (config or env) replaces cx-stream's DEFAULT sandbox mode. Found end to end in a
// Docker container: codex's own Linux sandbox (bubblewrap) cannot create a namespace there, so
// every command — even `pwd` — failed and the worker changed nothing; the runner had no way to
// pick another mode. A container is already the isolation boundary, so
// CX_SANDBOX=danger-full-access is the documented escape hatch. --read-only must still win:
// that flag is a real no-writes guarantee and a config default must never weaken it.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CX_STREAM = path.join(SCRIPTS, 'cx-stream')

// The banner's `sandbox:` line prints SANDBOX_MODE, the same variable cx-stream passes to codex as
// `-s "$SANDBOX_MODE"` (fresh run) / `-c sandbox_mode=$SANDBOX_MODE` (resume). A stub codex is
// on PATH only so the command -v guard passes; whether it is reached does not matter here.
function sandboxMode(extraArgs, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cx-sandbox-'))
  try {
    const repo = path.join(dir, 'repo')
    execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && git -c user.name=t -c user.email=t@e commit -q --allow-empty -m s`)
    const bin = path.join(dir, 'bin')
    execSync(`mkdir -p "${bin}"`)
    writeFileSync(path.join(bin, 'codex'), '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(path.join(bin, 'codex'), 0o755)
    const r = spawnSync('bash', [CX_STREAM, '--cwd', repo, ...extraArgs, '-p', 'noop'], {
      encoding: 'utf8',
      timeout: 60000,
      env: {
        PATH: `${bin}:${process.env.PATH}`, HOME: dir,
        CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: path.join(dir, 'sessions'),
        CX_PARSER: path.join(SCRIPTS, 'cx-stream-parse.mjs'),
        ...env,
      },
    })
    const m = /^\s*sandbox:\s+(\S+)/m.exec(`${r.stdout}${r.stderr}`)
    assert.ok(m, `no sandbox banner in: ${r.stdout}${r.stderr}`)
    return m[1]
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('default sandbox stays workspace-write', () => {
  assert.equal(sandboxMode([], {}), 'workspace-write')
})

test('CX_SANDBOX replaces the default mode', () => {
  assert.equal(sandboxMode([], { CX_SANDBOX: 'danger-full-access' }), 'danger-full-access')
})

test('--read-only still wins over CX_SANDBOX', () => {
  assert.equal(sandboxMode(['--read-only'], { CX_SANDBOX: 'danger-full-access' }), 'read-only')
})
