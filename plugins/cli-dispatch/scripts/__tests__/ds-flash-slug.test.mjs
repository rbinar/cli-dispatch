// DeepSeek's API lists `deepseek-flash` (and `deepseek-v4-pro`) as its model names; the old
// `deepseek-v4-flash` default is only an undocumented alias. Every shipped default for the
// DeepSeek flash slot must use the listed name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['claude-ds', 'claude-ds.ps1', 'claude-ds-stream', 'claude-ds-stream.ps1', 'install.sh', 'install.ps1']

for (const f of FILES) {
  test(`${f} defaults the DeepSeek flash slot to deepseek-flash`, () => {
    const src = readFileSync(join(scripts, f), 'utf8')
    assert.ok(!src.includes('deepseek-v4-flash'), `${f} still ships the deepseek-v4-flash alias`)
    assert.ok(src.includes('deepseek-flash'), `${f} has no deepseek-flash default`)
  })
}
