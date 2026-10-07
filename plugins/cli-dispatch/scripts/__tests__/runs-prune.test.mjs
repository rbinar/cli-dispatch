// runs-prune.test.mjs — `<sessions-root>/.runs/run-*` (the detached runner's pid/log/summary/exit
// bookkeeping) was never removed by anything, so it grew forever. pruneSessionRoot now caps the
// FINISHED runs (an `exit` file exists) at the same limit as sessions; a run still going is
// never touched.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pruneSessionRoot } from '../parse-utils.mjs'

test('finished detached runs beyond the cap are pruned, newest kept, live runs untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-runs-prune-'))
  try {
    const runs = path.join(root, '.runs')
    const mk = (id, ageSec, finished) => {
      const d = path.join(runs, id); fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'pid'), '1\n')
      if (finished) fs.writeFileSync(path.join(d, 'exit'), '0\n')
      const t = new Date(Date.now() - ageSec * 1000)
      for (const f of fs.readdirSync(d)) fs.utimesSync(path.join(d, f), t, t)
      fs.utimesSync(d, t, t)
    }
    for (let i = 0; i < 5; i++) mk(`run-old-${i}`, 1000 + i, true)
    mk('run-new-a', 10, true)
    mk('run-new-b', 20, true)
    mk('run-live', 5000, false)
    pruneSessionRoot(root, { max: 2 })
    assert.deepEqual(fs.readdirSync(runs).sort(), ['run-live', 'run-new-a', 'run-new-b'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
