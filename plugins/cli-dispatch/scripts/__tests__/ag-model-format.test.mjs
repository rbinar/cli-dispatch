// Issue #133: agy 1.1.8's `agy models` prints kebab-case slugs (gemini-3.6-flash-high),
// where it used to print display names ("Gemini 3.6 Flash (High)"). `agy --model` still
// accepts BOTH, so this is a listing-format change only — but ag-stream compared the two
// with an exact-match grep, which produced a false "not listed by `agy models`" warning for
// every display-name config, and made the --effort path fall through to a hardcoded 3.5.
//
// These tests pin the reconciliation: the four shell helpers below must treat the two
// formats as the same model, in either direction, whichever format `agy models` happens to
// emit. They are extracted from ag-stream and run under real bash with a stubbed `agy`, so
// the assertions grade the shipped script rather than a copy of it — same technique as
// ps1-bash-quoting.test.mjs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const AG_STREAM = path.join(HERE, '..', 'ag-stream')
const SOURCE = readFileSync(AG_STREAM, 'utf8')

const REQUIRED = ['model_key', 'model_listed', 'apply_effort_suffix', 'pick_model_for_effort']

// Pull `name() { … }` out of ag-stream verbatim, closing on the first column-0 `}` — the
// repo's shell style puts nothing else there.
function extractFunction(name) {
  const lines = SOURCE.split('\n')
  const start = lines.findIndex((line) => new RegExp(`^${name}\\(\\)\\s*\\{`).test(line))
  assert.notEqual(start, -1, `ag-stream must define a ${name}() shell function (issue #133)`)
  const end = lines.findIndex((line, i) => i > start && line === '}')
  assert.notEqual(end, -1, `${name}() has no column-0 closing brace`)
  return lines.slice(start, end + 1).join('\n')
}

const HELPERS = REQUIRED.map(extractFunction).join('\n\n')

const SLUG_LIST = [
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.5-flash-high',
  'gemini-3.1-pro-high',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
].join('\n')

const LEGACY_LIST = [
  'Gemini 3.5 Flash (High)',
  'Gemini 3.5 Flash (Medium)',
  'Gemini 3.1 Pro (High)',
  'Claude Opus 4.6 (Thinking)',
  'GPT-OSS 120B (Medium)',
].join('\n')

// Runs `body` in bash with the helpers in scope and `agy models` stubbed to `listing`.
// listing === null stubs an agy that fails outright (not installed / not signed in).
function runShell(body, listing) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ag-model-'))
  try {
    const stub = listing === null
      ? 'agy() { return 127; }'
      : `agy() { if [ "\${1:-}" = "models" ]; then printf '%s' "$AGY_MODEL_LIST"; [ -n "$AGY_MODEL_LIST" ] && printf '\\n'; return 0; fi; return 0; }`
    const script = `#!/usr/bin/env bash\nset -uo pipefail\n${stub}\n${HELPERS}\n${body}\n`
    const file = path.join(dir, 'case.sh')
    writeFileSync(file, script)
    const result = spawnSync('bash', [file], {
      encoding: 'utf8',
      env: { ...process.env, AGY_MODEL_LIST: listing ?? '' },
    })
    return { stdout: String(result.stdout ?? '').trim(), status: result.status }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('ag-stream defines the four model-format helpers', () => {
  for (const name of REQUIRED) {
    assert.match(SOURCE, new RegExp(`^${name}\\(\\)`, 'm'), `missing ${name}()`)
  }
})

test('model_key collapses a display name and its slug to the same key', () => {
  // The slug transform is NOT mechanical: agy keeps the dot in gemini-3.5 but converts
  // Claude's 4.6 to 4-6. A key that drops every non-alphanumeric is the only comparison
  // that survives both conventions.
  const pairs = [
    ['Gemini 3.6 Flash (High)', 'gemini-3.6-flash-high'],
    ['Gemini 3.1 Pro (High)', 'gemini-3.1-pro-high'],
    ['Claude Opus 4.6 (Thinking)', 'claude-opus-4-6-thinking'],
    ['GPT-OSS 120B (Medium)', 'gpt-oss-120b-medium'],
  ]
  for (const [display, slug] of pairs) {
    const { stdout } = runShell(
      `a="$(model_key "${display}")"; b="$(model_key "${slug}")"; [ "$a" = "$b" ] && echo SAME || echo "DIFF a=$a b=$b"`,
      SLUG_LIST,
    )
    assert.equal(stdout, 'SAME', `${display} and ${slug} must share a key`)
  }
})

test('model_key keeps genuinely different models apart', () => {
  const { stdout } = runShell(
    `a="$(model_key "Gemini 3.6 Flash (High)")"; b="$(model_key "Gemini 3.6 Flash (Low)")"; ` +
      `c="$(model_key "gemini-3.5-flash-high")"; ` +
      `[ "$a" != "$b" ] && [ "$a" != "$c" ] && echo DISTINCT || echo COLLIDED`,
    SLUG_LIST,
  )
  assert.equal(stdout, 'DISTINCT')
})

test('a display-name model is accepted against a slug listing (the #133 false positive)', () => {
  const { stdout } = runShell(
    `model_listed "Gemini 3.6 Flash (High)" && echo LISTED || echo UNLISTED`,
    SLUG_LIST,
  )
  assert.equal(stdout, 'LISTED')
})

test('a slug model is accepted against a slug listing', () => {
  const { stdout } = runShell(`model_listed "gemini-3.6-flash-high" && echo LISTED || echo UNLISTED`, SLUG_LIST)
  assert.equal(stdout, 'LISTED')
})

test('a slug model is accepted against a legacy display-name listing', () => {
  // Older agy builds still print display names; downgrading must not start warning either.
  const { stdout } = runShell(`model_listed "claude-opus-4-6-thinking" && echo LISTED || echo UNLISTED`, LEGACY_LIST)
  assert.equal(stdout, 'LISTED')
})

test('a genuinely unknown model is still reported unlisted', () => {
  // The warning exists because agy falls back silently on a typo. Fixing the false positive
  // must not disarm the true positive.
  const { stdout } = runShell(`model_listed "Gemini 9.9 Ultra (High)" && echo LISTED || echo UNLISTED`, SLUG_LIST)
  assert.equal(stdout, 'UNLISTED')
})

test('a near-miss typo is reported unlisted', () => {
  const { stdout } = runShell(`model_listed "gemini-3.6-flsah-high" && echo LISTED || echo UNLISTED`, SLUG_LIST)
  assert.equal(stdout, 'UNLISTED')
})

test('an unusable agy suppresses the warning instead of blaming the model', () => {
  // No listing means we cannot verify anything; claiming the model is unknown would be a
  // second false positive, aimed at whoever has not signed into agy yet.
  for (const listing of [null, '']) {
    const { stdout } = runShell(`model_listed "Gemini 3.6 Flash (High)" && echo LISTED || echo UNLISTED`, listing)
    assert.equal(stdout, 'LISTED', `empty/failed listing (${JSON.stringify(listing)}) must not warn`)
  }
})

test('apply_effort_suffix keeps the caller format and replaces any existing effort', () => {
  const cases = [
    ['Gemini 3.6 Flash (Medium)', 'High', 'Gemini 3.6 Flash (High)'],
    ['Gemini 3.6 Flash', 'High', 'Gemini 3.6 Flash (High)'],
    ['gemini-3.6-flash-medium', 'High', 'gemini-3.6-flash-high'],
    ['gemini-3.6-flash', 'High', 'gemini-3.6-flash-high'],
    ['claude-opus-4-6-thinking', 'Low', 'claude-opus-4-6-low'],
  ]
  for (const [input, suffix, want] of cases) {
    const { stdout } = runShell(`apply_effort_suffix "${input}" "${suffix}"`, SLUG_LIST)
    assert.equal(stdout, want, `apply_effort_suffix ${input} ${suffix}`)
  }
})

test('pick_model_for_effort reads the live listing in either format', () => {
  const slug = runShell(`pick_model_for_effort "High"`, SLUG_LIST)
  assert.equal(slug.stdout, 'gemini-3.6-flash-high')

  const legacy = runShell(`pick_model_for_effort "High"`, LEGACY_LIST)
  assert.equal(legacy.stdout, 'Gemini 3.5 Flash (High)')
})

test('pick_model_for_effort falls back only when there is no listing', () => {
  const { stdout } = runShell(`pick_model_for_effort "High"`, null)
  assert.notEqual(stdout, '', 'a hardcoded fallback must still exist for an unusable agy')
})

test('the --effort path no longer hardcodes a model ahead of the live listing', () => {
  // The regression this test locks: `agy models | grep "($SUF)$"` could not match a slug
  // listing, so every --effort run silently took the 3.5 fallback.
  assert.doesNotMatch(
    SOURCE,
    /agy models[^\n]*grep -m1 "\(\$SUF\)/,
    'ag-stream must not match the effort suffix against the raw listing',
  )
})

test('the helpers stay within bash 3.2 (macOS /bin/bash)', () => {
  // ${var,,} / ${var^^} are bash 4 only and macOS still ships 3.2 as /bin/bash. No other
  // script in this repo uses them; a lowercase here has to go through tr.
  assert.doesNotMatch(SOURCE, /\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^)[^}]*\}/, 'bash 4 case expansion')
})

test('ag-stream still parses as bash', () => {
  const result = spawnSync('bash', ['-n', AG_STREAM], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
