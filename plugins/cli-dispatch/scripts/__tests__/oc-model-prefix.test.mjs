// oc-stream always prefixed the model with `openrouter/`, so an OC_MODEL copied from
// `opencode models openrouter` (which prints `openrouter/deepseek/deepseek-v4-flash`) reached
// opencode as `openrouter/openrouter/…` and every turn died with "Unexpected server error".
// Found end to end in a container. Both spellings must reach opencode as one prefix.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function modelArg(ocModel) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc-prefix-'))
  try {
    const repo = path.join(dir, 'repo')
    execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && git -c user.name=t -c user.email=t@e commit -q --allow-empty -m s`)
    const bin = path.join(dir, 'bin'); execSync(`mkdir -p "${bin}"`)
    const log = path.join(dir, 'args')
    writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${log}"\nexit 0\n`)
    chmodSync(path.join(bin, 'opencode'), 0o755)
    spawnSync('bash', [path.join(SCRIPTS, 'oc-stream'), '--cwd', repo, '-p', 'noop'], {
      encoding: 'utf8', timeout: 60000,
      env: {
        PATH: `${bin}:${process.env.PATH}`, HOME: dir, CLI_DISPATCH_CONFIG: '/dev/null',
        CLI_DISPATCH_SESSIONS_DIR: path.join(dir, 'sessions'), OPENROUTER_API_KEY: 'test-not-a-key', OC_MODEL: ocModel,
      },
    })
    assert.ok(existsSync(log), 'stub opencode was never invoked')
    const args = readFileSync(log, 'utf8').split('\n')
    return args[args.indexOf('--model') + 1]
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('a bare OpenRouter slug gets one openrouter/ prefix', () => {
  assert.equal(modelArg('deepseek/deepseek-v4-flash'), 'openrouter/deepseek/deepseek-v4-flash')
})

test('a slug copied from `opencode models openrouter` is not double-prefixed', () => {
  assert.equal(modelArg('openrouter/deepseek/deepseek-v4-flash'), 'openrouter/deepseek/deepseek-v4-flash')
})
