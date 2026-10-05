// Issue #162: `--resume <id>` must run claude in the directory the session originally ran in
// (its meta.json cwd), because Claude Code stores conversations per project directory.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STREAM = path.join(HERE, '..', 'claude-ds-stream')

function setup(metaCwd) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ds-resume-')))
  const bin = path.join(root, 'bin'), sessions = path.join(root, 'sessions')
  const origin = path.join(root, 'origin'), elsewhere = path.join(root, 'elsewhere'), other = path.join(root, 'other')
  for (const d of [bin, sessions, origin, elsewhere, other, path.join(root, 'home')]) mkdirSync(d)
  const sid = 'sess-abc'
  mkdirSync(path.join(sessions, sid))
  if (metaCwd !== undefined) writeFileSync(path.join(sessions, sid, 'meta.json'), JSON.stringify({ cwd: metaCwd === 'ORIGIN' ? origin : metaCwd }))
  writeFileSync(path.join(bin, 'claude'), `#!/bin/bash
echo "$(pwd -P)" > "${root}/ran-in"
echo '{"type":"result","subtype":"success","result":"ok","session_id":"s"}'
`)
  chmodSync(path.join(bin, 'claude'), 0o755)
  return { root, bin, sessions, origin, elsewhere, other, sid }
}

function run(x, args) {
  const r = spawnSync('bash', [STREAM, '--resume', x.sid, '-p', 'x', ...args], {
    cwd: x.elsewhere, encoding: 'utf8', timeout: 60000,
    env: { PATH: `${x.bin}:${process.env.PATH}`, HOME: path.join(x.root, 'home'), DEEPSEEK_API_KEY: 'dummy',
      CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: x.sessions },
  })
  let ranIn = ''
  try { ranIn = readFileSync(path.join(x.root, 'ran-in'), 'utf8').trim() } catch {}
  return { r, ranIn }
}

test('claude-ds-stream --resume runs in the session meta.json cwd', () => {
  const x = setup('ORIGIN')
  try {
    const { r, ranIn } = run(x, [])
    assert.equal(ranIn, x.origin, `stderr: ${r.stderr}`)
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('claude-ds-stream --resume: explicit --cwd wins over meta.json', () => {
  const x = setup('ORIGIN')
  try {
    const { r, ranIn } = run(x, ['--cwd', x.other])
    assert.equal(ranIn, x.other, `stderr: ${r.stderr}`)
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('claude-ds-stream --resume: vanished meta cwd keeps today behaviour and warns', () => {
  const x = setup('/nonexistent/dir/for/ds/resume')
  try {
    const { r, ranIn } = run(x, [])
    assert.equal(ranIn, x.elsewhere)
    assert.match(r.stderr, /\/nonexistent\/dir\/for\/ds\/resume/)
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})
