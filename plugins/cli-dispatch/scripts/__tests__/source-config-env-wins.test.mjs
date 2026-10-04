// Issues #163/#168/#166: `cli-dispatch-run --model X` reaches a worker as an exported
// <BACKEND>_MODEL env var, but every bash *-stream calls `source_config` first — and that
// sourced the config unconditionally, so a configured AG_MODEL/DS_MODEL/... silently replaced
// the per-call selection. stream-utils.sh's own comment promised "env wins"; these tests hold
// it to that, under both the system bash 3.2 and a modern bash.
//
// The .ps1 twins never source anything — they parse the config into a hashtable — but they
// copied the bash precedence on purpose ("config overrides env in bash"), so they get the same
// assertion: a forwarded model env var beats the config.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(HERE, '..')
const STREAM_UTILS = path.join(SCRIPTS, 'stream-utils.sh')

const BASHES = ['/bin/bash', 'bash'].filter((b) => spawnSync(b, ['-c', 'true']).status === 0)

const CONFIG = [
  'AG_MODEL=config-model',
  'export DS_MODEL="config-ds"',
  "CX_MODEL='config-cx'",
  'OC_MODEL=config-oc',
  '# COMMENTED=nope',
].join('\n')

function runSourceConfig(bash, env, body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'src-cfg-'))
  try {
    const config = path.join(dir, 'config')
    writeFileSync(config, CONFIG + '\n')
    const script = `set -euo pipefail\n. "${STREAM_UTILS}"\nsource_config\n${body}\n`
    const result = spawnSync(bash, ['-c', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, CLI_DISPATCH_CONFIG: config, ...env },
    })
    assert.equal(result.status, 0, `bash failed: ${result.stderr}`)
    return result.stdout.trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const bash of BASHES) {
  test(`${bash}: an exported model env var beats the config (#163)`, () => {
    const out = runSourceConfig(bash, { AG_MODEL: 'env-model', DS_MODEL: 'env-ds', CX_MODEL: 'env-cx' },
      'echo "$AG_MODEL|$DS_MODEL|$CX_MODEL"')
    assert.equal(out, 'env-model|env-ds|env-cx')
  })

  test(`${bash}: an unset variable still takes the config default`, () => {
    const out = runSourceConfig(bash, { AG_MODEL: 'env-model' }, 'echo "$AG_MODEL|$DS_MODEL|$CX_MODEL|$OC_MODEL"')
    assert.equal(out, 'env-model|config-ds|config-cx|config-oc')
  })

  test(`${bash}: an empty env var does not mask the config`, () => {
    const out = runSourceConfig(bash, { AG_MODEL: '' }, 'echo "$AG_MODEL"')
    assert.equal(out, 'config-model')
  })

  test(`${bash}: the preserved value survives into a child process`, () => {
    const out = runSourceConfig(bash, { AG_MODEL: 'env model with spaces' }, `bash -c 'echo "$AG_MODEL"'`)
    assert.equal(out, 'env model with spaces')
  })
}

const PWSH = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0

// Pull the model-precedence block out of the shipped .ps1, so the assertion grades the real
// lines rather than a copy (same technique as ag-model-format.test.mjs).
function ps1Lines(file, pattern) {
  const lines = readFileSync(path.join(SCRIPTS, file), 'utf8').split('\n')
  const picked = lines.filter((l) => pattern.test(l))
  assert.ok(picked.length > 0, `${file}: model-precedence lines not found`)
  return picked.join('\n')
}

function runPwsh(snippet, env) {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', snippet], {
    encoding: 'utf8',
    env: { ...process.env, DS_MODEL: '', DS_FLASH_MODEL: '', CX_MODEL: '', CODEX_MODEL: '', ...env },
  })
  assert.equal(result.status, 0, `pwsh failed: ${result.stderr}`)
  return result.stdout.trim()
}

test('claude-ds-stream.ps1: DS_MODEL env beats the config', { skip: !PWSH && 'pwsh not installed' }, () => {
  const block = ps1Lines('claude-ds-stream.ps1', /^\$(modelCfg|flashCfg|model|flash) = /)
  const cfg = '$cfg = @{ DS_MODEL = "config-ds"; DS_FLASH_MODEL = "config-flash" }'
  assert.equal(runPwsh(`${cfg}\n${block}\n"$model|$flash"`, { DS_MODEL: 'env-ds' }), 'env-ds|config-flash')
  assert.equal(runPwsh(`${cfg}\n${block}\n"$model|$flash"`, {}), 'config-ds|config-flash')
})

test('cx-stream.ps1: CX_MODEL env beats the config', { skip: !PWSH && 'pwsh not installed' }, () => {
  const block = ps1Lines('cx-stream.ps1', /^(\$(cxModelEnv|codexModelEnv|model) = |if \(.*\$cfg\.ContainsKey\("(CX|CODEX)_MODEL"\))/)
  const cfg = '$cfg = @{ CX_MODEL = "config-cx" }'
  assert.equal(runPwsh(`${cfg}\n${block}\n"$model"`, { CX_MODEL: 'env-cx' }), 'env-cx')
  assert.equal(runPwsh(`${cfg}\n${block}\n"$model"`, {}), 'config-cx')
})
