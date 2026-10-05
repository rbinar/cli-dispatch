// Issue #171: managed sandboxes (e.g. Codex workspace-write) forbid /dev/fd, so bash process
// substitution (`<(...)` / `>(...)`) dies with "Operation not permitted". No runtime script may use it.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('no runtime script uses process substitution', () => {
  const offenders = []
  for (const name of readdirSync(SCRIPTS)) {
    const file = path.join(SCRIPTS, name)
    if (!statSync(file).isFile() || name.endsWith('.mjs')) continue
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return
      if (/[<>]\(/.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(offenders, [])
})
