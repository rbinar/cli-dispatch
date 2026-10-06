// On Linux, GNU `stat -f %m FILE` treats %m as a second file: it prints FILE's filesystem
// info to stdout, then fails. The BSD-first chain `stat -f %m f || stat -c %Y f` captured that
// junk plus the real mtime, so the watchdog's `$((now - m))` was a syntax error that killed it
// (no --max-runtime / --idle-timeout on Linux) and the statusline never counted a worker.
// A stub `stat` with GNU's behaviour reproduces it on macOS too.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function gnuStatBin() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-gnustat-'))
  fs.writeFileSync(path.join(bin, 'stat'), `#!/bin/bash
if [ "$1" = -f ]; then echo "  File: \\"$3\\""; echo "Blocks: Total: 1  Free: 1"; exit 1; fi
if [ "$1" = -c ] && [ "$2" = %Y ]; then echo 1700000000; exit 0; fi
exit 1
`)
  fs.chmodSync(path.join(bin, 'stat'), 0o755)
  return bin
}

test('mtime_of returns a bare epoch under GNU stat', () => {
  const bin = gnuStatBin()
  const f = path.join(bin, 'probe'); fs.writeFileSync(f, '')
  const r = spawnSync('bash', ['-c', `source "${SCRIPTS}/stream-utils.sh"; mtime_of "${f}"`], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  assert.equal(r.stdout, '1700000000\n')
})

test('statusline counts a fresh running worker under GNU stat', () => {
  const bin = gnuStatBin()
  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-gnustat-s-'))
  fs.mkdirSync(path.join(sessions, 'w1'))
  fs.writeFileSync(path.join(sessions, 'w1', 'status.json'), '{"state":"running","backend":"deepseek"}')
  const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-statusline.sh')], {
    encoding: 'utf8', input: '{}',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_NOW: '1700000010' },
  })
  assert.match(r.stdout, /▶1/, `stdout: ${JSON.stringify(r.stdout)} stderr: ${r.stderr}`)
})
