// install.sh must exit 0 when it succeeds. Its last lines were `[ "$WANT_X" -eq 1 ] && echo …`,
// so a run that did not pick Copilot (the last one) ended with the failed test's status 1. Found
// end to end in a container: /cli-dispatch:setup saw exit 1, blamed PATH, and told the user to
// fix a PATH that was already correct.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const INSTALL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'install.sh')

for (const backends of ['codex', 'antigravity,codex', 'deepseek']) {
  test(`install.sh --backends ${backends} exits 0 on success`, () => {
    const home = mkdtempSync(path.join(tmpdir(), 'install-exit-'))
    try {
      const r = spawnSync('bash', [INSTALL, '--backends', backends, '--non-interactive'], {
        encoding: 'utf8',
        env: { PATH: `${home}/.local/bin:${process.env.PATH}`, HOME: home },
      })
      assert.match(r.stdout, /^Done\.$/m, 'the install itself must have completed')
      assert.equal(r.status, 0, r.stdout.slice(-600) + r.stderr.slice(-600))
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
}
