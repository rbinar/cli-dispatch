// ps1-bash-quoting.test.mjs — locks the ONE place cli-dispatch-run.ps1 hands a string to bash.
//
// Issue #125: the launch line used to interpolate four values between bare single quotes:
//   & bash -lc "'$runner' '$Cwd' '$Branch' '$PromptFile'"
// An apostrophe in any of them — `C:\Users\O'Brien\repo` is an ordinary Windows path — closed the
// quoting early and handed the remainder to bash as syntax. Broken run at best, injection at worst.
//
// The function is extracted VERBATIM from the shipped script rather than restated here, so the
// test cannot pass against a copy that has drifted from the code. This is the first pwsh-driven
// test in the repo; it skips (does not fail) where pwsh or bash is absent, which is every CI-less
// Linux box that has no PowerShell — the same reason the .ps1 side has stayed under-tested.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const RUNNER_PS1 = path.join(SELF_DIR, '..', 'cli-dispatch-run.ps1')

const have = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0
const SKIP = !have('pwsh') || !have('bash')

// Pull the function out by brace balance: the body contains both quote characters, so any
// line-shape heuristic would be the thing most likely to break.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name} {`)
  assert.notEqual(start, -1, `${name} not found in cli-dispatch-run.ps1`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces after ${name}`)
}

test('ConvertTo-BashSingleQuoted: every value survives bash as one literal argument', { skip: SKIP ? 'pwsh and bash are both required' : false }, () => {
  const fn = extractFunction(fs.readFileSync(RUNNER_PS1, 'utf8'), 'ConvertTo-BashSingleQuoted')

  // The apostrophe case is the bug; the rest are the neighbours that must not regress.
  const cases = [
    '/tmp/plain',
    String.raw`C:\Users\O'Brien\repo`,
    'a b',
    '',
    "x''y",
    '; rm -rf /',
    '$HOME',
    '`backtick`',
    String.raw`back\slash`,
    'semi;colon && and',
    'new\nline',
  ]

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-ps1q-'))
  const casesFile = path.join(dir, 'cases.json')
  fs.writeFileSync(casesFile, JSON.stringify(cases))

  // Round-trip each value through `bash -lc "printf %s <quoted>"` and compare bytes. Values are
  // handed over as JSON so this file's own escaping cannot be what is under test.
  const script = `${fn}
$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -LiteralPath '${casesFile}' | ConvertFrom-Json
$results = @()
foreach ($c in $cases) {
  $q = ConvertTo-BashSingleQuoted $c
  $out = & bash -lc "printf %s $q"
  if ($null -eq $out) { $out = '' }
  if ($out -is [array]) { $out = ($out -join "\`n") }
  $results += [pscustomobject]@{ inValue = $c; outValue = $out }
}
# And the launch line itself: four values must arrive as exactly four argv entries.
$quoted = @('/p a', "C:\\O'B\\r", 'br anch', "f'ile") | ForEach-Object { ConvertTo-BashSingleQuoted $_ }
$argc = & bash -lc ("set -- " + ($quoted -join ' ') + '; printf %s $#')
[pscustomobject]@{ roundTrips = $results; argc = $argc } | ConvertTo-Json -Depth 5 -Compress
`
  const scriptFile = path.join(dir, 'check.ps1')
  fs.writeFileSync(scriptFile, script)

  const run = spawnSync('pwsh', ['-NoProfile', '-File', scriptFile], { encoding: 'utf8' })
  assert.equal(run.status, 0, `pwsh failed: ${run.stdout}${run.stderr}`)

  const parsed = JSON.parse(run.stdout)
  assert.equal(String(parsed.argc), '4', 'four quoted values must stay four arguments')
  assert.equal(parsed.roundTrips.length, cases.length)
  for (const { inValue, outValue } of parsed.roundTrips) {
    assert.equal(outValue, inValue, `value did not survive bash intact: ${JSON.stringify(inValue)}`)
  }

  fs.rmSync(dir, { recursive: true, force: true })
})

test('cli-dispatch-run.ps1: the bash launch line quotes through the helper, never bare', () => {
  // A grep-shaped assertion on purpose: the failure mode here is someone re-introducing string
  // interpolation, and no behavioural test on this box would catch it (the .sh path is used).
  const source = fs.readFileSync(RUNNER_PS1, 'utf8')
  assert.match(source, /ConvertTo-BashSingleQuoted/, 'the quoting helper must still exist')
  assert.doesNotMatch(
    source,
    /bash -lc "'\$/,
    'bash -lc must not interpolate a value between bare single quotes (issue #125)',
  )
})

test('cli-dispatch-run.ps1: trivial advisory matches the bash runner and stays before cleanup', () => {
  const ps1 = fs.readFileSync(RUNNER_PS1, 'utf8')
  const bash = fs.readFileSync(path.join(SELF_DIR, '..', 'cli-dispatch-run'), 'utf8')
  const advisory = 'cli-dispatch-run: trivial diff (<50 lines) — consider doing work this size inline or batching it'

  assert.equal(ps1.split(advisory).length - 1, 1)
  assert.equal(bash.split(advisory).length - 1, 1)
  assert.ok(ps1.indexOf(advisory) < ps1.lastIndexOf('Invoke-CleanupWorktree'))
  assert.match(ps1, /if \(\$verdictForNotes\.trivial -eq \$true\)/)
})
