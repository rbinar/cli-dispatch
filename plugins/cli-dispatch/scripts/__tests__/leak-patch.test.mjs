// A leak (worktree runner exit 7) must hand the orchestrator the leaked paths and a copy of the
// saved patch: verdict.json carries leakPaths/leakPatch and the run summary names the paths.
// Harness as worker-death-verdict.test.mjs: a stub ds-worktree-run.sh next to a copied runner.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('a leak records leakPaths and a session copy of the patch, and the summary names the paths', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-leak-'))
  try {
    const bin = path.join(dir, 'bin'); mkdirSync(bin)
    for (const f of ['cli-dispatch-run', 'cli-dispatch-wait', 'cli-dispatch-run-summary.sh']) {
      copyFileSync(path.join(SCRIPTS, f), path.join(bin, f)); chmodSync(path.join(bin, f), 0o755)
    }
    const repo = path.join(dir, 'repo')
    execSync(`mkdir -p "${repo}" && cd "${repo}" && git init -q && echo seed > note.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm seed`)
    const sessions = path.join(dir, 'sessions'); mkdirSync(sessions)
    const sid = 'ds-leak-session'
    const patch = path.join(dir, 'leaked-changes-XYZ')
    writeFileSync(path.join(bin, 'ds-worktree-run.sh'), `#!/usr/bin/env bash
REPO="$1"
S="${sessions}/${sid}"
mkdir -p "$S"
printf '{"state":"error","sessionId":"${sid}","backend":"deepseek"}' > "$S/status.json"
printf '{"backend":"deepseek","cwd":"%s","model":"m"}' "$REPO" > "$S/meta.json"
printf '{"files":[],"diffstat":""}' > "$S/changed-files.json"
echo "claude-ds session: ${sid}" >&2
printf 'diff --git a/a.txt b/a.txt\\n' > "${patch}"
printf 'a.txt\\nsub/b.txt\\n' > "${patch}.paths"
echo ">>> post-check FAIL: NEW changes appeared in $REPO, outside the worktree" >&2
echo ">>> patch saved: ${patch}" >&2
exit 7
`)
    chmodSync(path.join(bin, 'ds-worktree-run.sh'), 0o755)
    const r = spawnSync('bash', [path.join(bin, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', repo, '--prompt', 'x', '--verify', 'true'], {
      encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: sessions, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs'), CLI_DISPATCH_NO_IN_PLACE: '1' },
    })
    const vp = path.join(sessions, sid, 'verdict.json')
    assert.ok(existsSync(vp), `verdict.json missing; runner said: ${r.stderr.slice(-400)}`)
    const v = JSON.parse(readFileSync(vp, 'utf8'))
    assert.equal(v.leak, true)
    assert.equal(r.status, 2, 'exitCode contract unchanged')
    assert.deepEqual(v.leakPaths, ['a.txt', 'sub/b.txt'])
    assert.ok(v.leakPatch && v.leakPatch.startsWith(path.join(sessions, sid)) && existsSync(v.leakPatch), `leakPatch: ${v.leakPatch}`)
    assert.match(readFileSync(v.leakPatch, 'utf8'), /diff --git a\/a\.txt/)
    const s = spawnSync('bash', [path.join(bin, 'cli-dispatch-run-summary.sh'), vp, String(r.status)], { encoding: 'utf8' })
    assert.match(s.stdout, /LEAK:.*a\.txt.*sub\/b\.txt/)
    assert.ok(s.stdout.includes(v.leakPatch), s.stdout)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
