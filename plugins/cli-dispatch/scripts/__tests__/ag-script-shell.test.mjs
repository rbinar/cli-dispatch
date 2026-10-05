// #165 root cause on Linux: util-linux `script -c` runs its command string with $SHELL, or
// /bin/sh when unset — dash on Debian/Ubuntu. ag-stream builds that string with bash's
// `printf %q`, which quotes a multi-line / UTF-8 prompt as $'...'; dash takes it literally, so
// agy received a corrupted brief ("$line1\nline2 \342\200\224…") and conversation discovery could
// not match the prompt. Reproduced in a Debian container: SHELL=/bin/bash prints the prompt
// intact, SHELL=/bin/sh or unset mangles it. The Linux branch must always hand the string to bash.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const AG_STREAM = process.env.AG_STREAM_UNDER_TEST || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ag-stream')

test('the Linux script(1) launch runs the %q-quoted command with bash', () => {
  const src = readFileSync(AG_STREAM, 'utf8')
  const line = src.split('\n').find((l) => /exec script -qec "\$q"/.test(l))
  assert.ok(line, 'Linux script -qec launch not found')
  assert.match(line, /SHELL="\$\(command -v bash\)"/)
})

test('on Linux, the launch keeps a multi-line UTF-8 prompt intact even with SHELL=/bin/sh', { skip: process.platform !== 'linux' && 'script -c semantics are util-linux only' }, () => {
  const prompt = 'line1\nline2 — x'
  const r = spawnSync('bash', ['-c', `q=""; for a in printf '%s' "$P"; do q+="$(printf '%q ' "$a")"; done; SHELL="$(command -v bash)" script -qec "$q" /dev/null`], {
    encoding: 'utf8', env: { ...process.env, P: prompt, SHELL: '/bin/sh' },
  })
  assert.equal(r.stdout.replace(/\r\n/g, '\n'), prompt)
})
