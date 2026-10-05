// verdict-diff.patch is what the orchestrator applies ("apply the patch yourself"). It was built
// from `git status --short` + `git diff HEAD`, and `git diff` never includes untracked files — so
// a worker that only ADDED files (found in a container: a new module, index.js and a test file)
// produced a patch with nothing to apply ("No valid patches in input") and the orchestrator had
// to copy files out of the worktree by hand. The patch must apply cleanly to the base commit and
// carry new, modified and deleted files, but not the runner's own worker-report.json nor the
// node_modules links the worktree runners add.
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SID = 'ds-patch-session'
const GIT = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' }

test('verdict-diff.patch applies to the base commit with new, modified and deleted files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-patch-'))
  try {
    const wt = path.join(dir, 'wt')
    execSync(`mkdir -p "${wt}" && cd "${wt}" && git init -q && printf 'a\\n' > keep.txt && printf 'x\\n' > gone.txt && git add -A && git commit -qm base`, { env: { ...process.env, ...GIT } })
    // What a worker leaves behind.
    fs.writeFileSync(path.join(wt, 'keep.txt'), 'a\nb\n')
    fs.rmSync(path.join(wt, 'gone.txt'))
    fs.mkdirSync(path.join(wt, 'lib'))
    fs.writeFileSync(path.join(wt, 'lib', 'new.js'), 'module.exports = 1\n')
    fs.writeFileSync(path.join(wt, 'worker-report.json'), '{"claims":[]}\n')
    fs.symlinkSync(os.tmpdir(), path.join(wt, 'node_modules'))
    const indexBefore = execSync('git ls-files --stage', { cwd: wt, encoding: 'utf8' })

    const root = path.join(dir, 'sessions'); const s = path.join(root, SID)
    fs.mkdirSync(s, { recursive: true })
    fs.writeFileSync(path.join(s, 'status.json'), JSON.stringify({ state: 'done', sessionId: SID }))
    fs.writeFileSync(path.join(s, 'meta.json'), JSON.stringify({ backend: 'deepseek', cwd: wt }))
    fs.writeFileSync(path.join(s, 'changed-files.json'), JSON.stringify({ files: [], diffstat: '' }))
    const r = spawnSync('bash', [path.join(SCRIPTS, 'cli-dispatch-run'), '--backend', 'ds', '--cwd', wt, '--resume', SID], {
      encoding: 'utf8', env: { ...process.env, CLI_DISPATCH_SESSIONS_DIR: root, CLI_DISPATCH_VERDICT_WRITER: path.join(SCRIPTS, 'verdict-writer.mjs') },
    })
    assert.equal(r.status, 0, r.stderr.slice(-400))
    assert.equal(execSync('git ls-files --stage', { cwd: wt, encoding: 'utf8' }), indexBefore, "the worker's index must be untouched")

    const clone = path.join(dir, 'clone')
    execSync(`git clone -q "${wt}" "${clone}"`)
    const patch = path.join(s, 'verdict-diff.patch')
    const ap = spawnSync('git', ['apply', patch], { cwd: clone, encoding: 'utf8' })
    assert.equal(ap.status, 0, `git apply failed: ${ap.stderr}\n${fs.readFileSync(patch, 'utf8')}`)
    assert.equal(fs.readFileSync(path.join(clone, 'keep.txt'), 'utf8'), 'a\nb\n')
    assert.equal(fs.existsSync(path.join(clone, 'gone.txt')), false)
    assert.equal(fs.readFileSync(path.join(clone, 'lib', 'new.js'), 'utf8'), 'module.exports = 1\n')
    assert.equal(fs.existsSync(path.join(clone, 'worker-report.json')), false, 'runner artifact must not ship')
    assert.equal(fs.existsSync(path.join(clone, 'node_modules')), false, 'worktree node_modules links must not ship')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
