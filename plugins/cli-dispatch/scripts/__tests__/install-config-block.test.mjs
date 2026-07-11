// install-config-block.test.mjs — unit tests for the `ensure_config_block` bash function
// embedded in install.sh between the `# >>> ensure_config_block >>>` / `# <<< ensure_config_block <<<`
// marker fences.
//
// STRATEGY (mirrors kill-flow.test.mjs): ensure_config_block is documented as self-contained
// (no reliance on outer variables — args: $1=config_path $2=backend_id, returns 0=appended,
// 1=unchanged, 2=unknown backend), so the fenced text can be extracted verbatim, written to a
// standalone temp script, sourced, and invoked directly with real files under a real `bash`
// process — a far stronger test than a syntax-only check.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/install-config-block.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const INSTALL_SH = path.resolve(SELF_DIR, '..', 'install.sh')

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

// ---- extract the ensure_config_block function verbatim from install.sh, between its marker
// fences ----
function extractEnsureConfigBlock(installShPath) {
  const content = fs.readFileSync(installShPath, 'utf8')
  const match = content.match(/# >>> ensure_config_block >>>\n([\s\S]*?)\n# <<< ensure_config_block <<</)
  assert.ok(match, `no ensure_config_block fence found in ${installShPath}`)
  return match[1]
}

const scriptDir = mkdtemp('cli-dispatch-configblock-')
const scriptPath = path.join(scriptDir, 'ensure-config-block.sh')
fs.writeFileSync(scriptPath, extractEnsureConfigBlock(INSTALL_SH) + '\n')

after(() => { rmrf(scriptDir) })

// ---- invoke the extracted function by sourcing the script and calling it with args, exactly
// as install.sh's own callers do: ensure_config_block <config_path> <backend_id> ----
function runEnsureConfigBlock(cfgPath, backend) {
  const res = spawnSync('bash', ['-c', '. "$0"; ensure_config_block "$1" "$2"', scriptPath, cfgPath, backend], {
    encoding: 'utf8',
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

const HEADER = '# cli-dispatch config — DO NOT COMMIT.\n'

const BACKENDS = [
  { id: 'deepseek', marker: 'DEEPSEEK_API_KEY=' },
  { id: 'antigravity', marker: 'GEMINI_API_KEY=' },
  { id: 'codex', marker: 'CODEX_API_KEY=' },
  { id: 'opencode', marker: 'OPENROUTER_API_KEY=' },
  { id: 'copilot', marker: 'COPILOT_GITHUB_TOKEN=' },
]

function countMarkerLines(content, marker) {
  const re = new RegExp(`^${marker}`)
  return content.split('\n').filter((l) => re.test(l)).length
}

// ============================================================================
// Test 0: sanity — the extracted function is syntactically valid bash on its own
// ============================================================================
test('ensure_config_block fence: extracted script passes `bash -n` syntax check', () => {
  const res = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' })
  assert.equal(res.status, 0, `bash -n failed: ${res.stderr}`)
})

// ============================================================================
// Test 1: fresh header-only config — all 5 backends append cleanly, each exit 0, each marker
// appears exactly once
// ============================================================================
test('fresh config: all 5 backends append (exit 0), each marker present exactly once', () => {
  const dir = mkdtemp('cli-dispatch-configblock-fresh-')
  try {
    const cfg = path.join(dir, 'config.env')
    fs.writeFileSync(cfg, HEADER)

    for (const { id } of BACKENDS) {
      const res = runEnsureConfigBlock(cfg, id)
      assert.equal(res.code, 0, `expected exit 0 for backend ${id}, got ${res.code}; stderr: ${res.stderr}`)
    }

    const content = fs.readFileSync(cfg, 'utf8')
    for (const { marker } of BACKENDS) {
      assert.equal(countMarkerLines(content, marker), 1, `expected exactly 1 line matching ^${marker} after fresh append`)
    }
  } finally {
    rmrf(dir)
  }
})

// ============================================================================
// Test 2: idempotency — calling the same 5 backends again on an already-populated config
// changes nothing (all exit 1, byte-identical content)
// ============================================================================
test('idempotency: re-running all 5 backends on a populated config exits 1 and leaves content byte-identical', () => {
  const dir = mkdtemp('cli-dispatch-configblock-idem-')
  try {
    const cfg = path.join(dir, 'config.env')
    fs.writeFileSync(cfg, HEADER)
    for (const { id } of BACKENDS) {
      const res = runEnsureConfigBlock(cfg, id)
      assert.equal(res.code, 0, `seed pass: expected exit 0 for ${id}`)
    }

    const before = fs.readFileSync(cfg, 'utf8')

    for (const { id } of BACKENDS) {
      const res = runEnsureConfigBlock(cfg, id)
      assert.equal(res.code, 1, `expected exit 1 (unchanged) for backend ${id} on second pass, got ${res.code}`)
    }

    const after_ = fs.readFileSync(cfg, 'utf8')
    assert.equal(after_, before, 'config content must be byte-identical after idempotent re-run')
  } finally {
    rmrf(dir)
  }
})

// ============================================================================
// Test 3: a filled-in value is preserved — ensure_config_block must never touch/duplicate an
// existing marker line, even with a real (non-empty) value
// ============================================================================
test('filled value preserved: a hand-set DEEPSEEK_API_KEY value survives, no duplicate marker', () => {
  const dir = mkdtemp('cli-dispatch-configblock-filled-')
  try {
    const cfg = path.join(dir, 'config.env')
    fs.writeFileSync(cfg, HEADER + '\nDEEPSEEK_API_KEY="sk-real-key"\n')

    const res = runEnsureConfigBlock(cfg, 'deepseek')
    assert.equal(res.code, 1, 'expected exit 1 (unchanged) — marker already present')

    const content = fs.readFileSync(cfg, 'utf8')
    assert.match(content, /^DEEPSEEK_API_KEY="sk-real-key"$/m, 'the hand-set value must remain exactly as written')
    assert.equal(countMarkerLines(content, 'DEEPSEEK_API_KEY='), 1, 'must still have exactly 1 DEEPSEEK_API_KEY= line (no duplicate appended)')
  } finally {
    rmrf(dir)
  }
})

// ============================================================================
// Test 4: missing-block repair — deleting just the GEMINI_API_KEY= line from an otherwise-full
// 5-block config and re-running antigravity re-appends only that block; the other 4 markers are
// untouched (still exactly 1 each)
// ============================================================================
test('missing-block repair: deleting only GEMINI_API_KEY= line then re-running antigravity restores it, others untouched', () => {
  const dir = mkdtemp('cli-dispatch-configblock-repair-')
  try {
    const cfg = path.join(dir, 'config.env')
    fs.writeFileSync(cfg, HEADER)
    for (const { id } of BACKENDS) {
      const res = runEnsureConfigBlock(cfg, id)
      assert.equal(res.code, 0, `seed pass: expected exit 0 for ${id}`)
    }

    // Remove only the GEMINI_API_KEY= line, leaving the rest of the antigravity block's
    // comments/other vars (AG_MODEL, AG_MODELS) in place -- simulates a user manually deleting
    // just the key line.
    const before = fs.readFileSync(cfg, 'utf8')
    const stripped = before.split('\n').filter((l) => !/^GEMINI_API_KEY=/.test(l)).join('\n')
    fs.writeFileSync(cfg, stripped)
    assert.equal(countMarkerLines(stripped, 'GEMINI_API_KEY='), 0, 'sanity: GEMINI_API_KEY= line should be gone before the repair call')

    const res = runEnsureConfigBlock(cfg, 'antigravity')
    assert.equal(res.code, 0, `expected exit 0 (appended) when marker missing, got ${res.code}; stderr: ${res.stderr}`)

    const after_ = fs.readFileSync(cfg, 'utf8')
    assert.equal(countMarkerLines(after_, 'GEMINI_API_KEY='), 1, 'GEMINI_API_KEY= should be back, exactly once')

    for (const { id, marker } of BACKENDS) {
      if (id === 'antigravity') continue
      assert.equal(countMarkerLines(after_, marker), 1, `marker ${marker} for untouched backend ${id} must still be present exactly once`)
    }
  } finally {
    rmrf(dir)
  }
})

// ============================================================================
// Test 5: unknown backend id — exit 2, config file untouched
// ============================================================================
test('unknown backend: exits 2 and leaves the config file untouched', () => {
  const dir = mkdtemp('cli-dispatch-configblock-unknown-')
  try {
    const cfg = path.join(dir, 'config.env')
    fs.writeFileSync(cfg, HEADER)
    const before = fs.readFileSync(cfg, 'utf8')

    const res = runEnsureConfigBlock(cfg, 'bogus')
    assert.equal(res.code, 2, `expected exit 2 for unknown backend, got ${res.code}`)

    const after_ = fs.readFileSync(cfg, 'utf8')
    assert.equal(after_, before, 'config content must be untouched for an unknown backend id')
  } finally {
    rmrf(dir)
  }
})

// ============================================================================
// Test 6: substring safety — a line like `MY_DEEPSEEK_API_KEY="x"` (marker NOT at line start)
// must not satisfy the `^DEEPSEEK_API_KEY=` anchor check, so the real block still gets appended
// ============================================================================
test('substring safety: a non-anchored MY_DEEPSEEK_API_KEY= line does not block a real append', () => {
  const dir = mkdtemp('cli-dispatch-configblock-substr-')
  try {
    const cfg = path.join(dir, 'config.env')
    fs.writeFileSync(cfg, HEADER + '\nMY_DEEPSEEK_API_KEY="x"\n')

    const res = runEnsureConfigBlock(cfg, 'deepseek')
    assert.equal(res.code, 0, `expected exit 0 (appended) — MY_DEEPSEEK_API_KEY= must not satisfy the ^DEEPSEEK_API_KEY= anchor, got ${res.code}`)

    const content = fs.readFileSync(cfg, 'utf8')
    assert.equal(countMarkerLines(content, 'DEEPSEEK_API_KEY='), 1, 'expected exactly 1 line anchored at ^DEEPSEEK_API_KEY= after the append')
  } finally {
    rmrf(dir)
  }
})
