// Issue #167: when the worktree runner exited non-zero (the worker's turn was classified as
// failed — a cx "writing outside of the project" rejection, a "skills context budget" notice,
// an agy discovery error after edits), cli-dispatch-run exited at once: no verify, no
// verdict.json. Finished work and no work looked identical. The runner now carries on to the
// normal wait → verify → verdict path whenever the session can be found, and records the
// worker runner's own exit code as `workerExit`.
//
// Harness: cli-dispatch-run resolves the per-backend runner from its own directory, so the
// script and its shell siblings are copied into a temp dir next to a stub ds-worktree-run.sh.
// The verdict engine is pinned to this checkout via CLI_DISPATCH_VERDICT_WRITER.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function harness({ stubExit, leaveFix, state = 'error', emitMarker = true }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-death-'))
  const bin = path.join(dir, 'bin'); mkdirSync(bin)
  for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
    copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); chmodSync(path.join(bin, f), 0o755)
  }
  const repo = path.join(dir, 'repo')
  execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo seed > note.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed`)
  const sessions = path.join(dir, 'sessions'); mkdirSync(sessions)
  const sid = 'ds-death-session'
  // Stub runner: the "worker" may or may not have left its change, then the turn "fails".
  writeFileSync(path.join(bin, 'ds-worktree-run.sh'), `#!/usr/bin/env bash
REPO="$1"
S="${sessions}/${sid}"
mkdir -p "$S"
printf '{"state":"${state}","sessionId":"${sid}","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
${leaveFix ? ': > "$REPO/fixed.txt"' : ':'}
${emitMarker ? `echo "claude-ds session: ${sid}" >&2` : ':'}
echo "worker turn failed: patch rejected: writing outside of the project" >&2
exit ${stubExit}
`)
  chmodSync(path.join(bin, 'ds-worktree-run.sh'), 0o755)
  const r = spawnSync('bash', [path.join(bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', repo, '--prompt', 'x', '--verify', 'test -f fixed.txt'], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1' },
  })
  const vp = path.join(sessions, sid, 'verdict.json')
  const verdict = existsSync(vp) ? JSON.parse(readFileSync(vp, 'utf8')) : null
  return { r, verdict, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('#167: a failed worker turn that left the work still gets verified and a verdict', () => {
  const h = harness({ stubExit: 1, leaveFix: true })
  try {
    assert.ok(h.verdict, `verdict.json must be written; runner said: ${h.r.stderr.slice(-400)}`)
    assert.equal(h.verdict.verify.exitCode, 0, 'verify ran and passed on the work the worker left')
    assert.equal(h.verdict.workerExit, 1, 'the worker runner exit code is recorded, not hidden')
    assert.equal(h.r.status, 2, 'still a worker failure by the 0-5 contract (state=error)')
  } finally { h.cleanup() }
})

test('#167: a failed worker turn that did nothing gets a verdict whose verify fails', () => {
  const h = harness({ stubExit: 1, leaveFix: false })
  try {
    assert.ok(h.verdict, 'verdict.json must be written')
    assert.notEqual(h.verdict.verify.exitCode, 0)
    assert.equal(h.verdict.workerExit, 1)
  } finally { h.cleanup() }
})

test('#167: a successful worker run records no workerExit and is unchanged', () => {
  const h = harness({ stubExit: 0, leaveFix: true, state: 'done' })
  try {
    assert.equal(h.r.status, 0, h.r.stderr.slice(-400))
    assert.equal(h.verdict.verify.exitCode, 0)
    assert.equal(h.verdict.workerExit, undefined)
  } finally { h.cleanup() }
})

test('#167: a dead worker whose status still says "running" does not hang the runner', () => {
  const t0 = Date.now()
  const h = harness({ stubExit: 1, leaveFix: true, state: 'running' })
  try {
    assert.ok(Date.now() - t0 < 60000, 'must not wait on a session nobody will finish')
    assert.ok(h.verdict, `verdict.json must be written; runner said: ${h.r.stderr.slice(-400)}`)
    assert.equal(h.verdict.state, 'error')
    assert.equal(h.verdict.verify.exitCode, 0)
  } finally { h.cleanup() }
})
