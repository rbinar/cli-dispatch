// public-page.test.mjs — the only test guarding the dashboard's client SPA.
//
// Why this file exists: `public-page.mjs` ships 764 lines of browser JS inside a SINGLE
// backtick template literal (2 backticks in the whole file — one at `export const PAGE = \``,
// one at the close). That means every regex and quote in the client code is written with
// server-side escaping (`\\d`, `\\*`, `\\'`), and one wrong escape silently breaks the ENTIRE
// page — CHANGELOG 3.15.2 records exactly that bug ("the `setWFilter` onclick used
// single-backslash escapes ... which collapsed to a bare quote in the served page and broke
// the entire client script with a syntax error"). That changelog credits "a parse test that
// evaluates the embedded <script> exactly as the browser would", but no such test was ever
// committed: `grep -rn 'public-page\|PAGE' __tests__/` found nothing and neither did a
// `git log -S` sweep. So this is written fresh, not restored.
//
// Deliberately NOT done: adding a "test harness splits here" marker comment to
// public-page.mjs. PAGE *is* the page served to browsers, so such a comment would appear in
// every user's page source. The bootstrap tail is instead allowed to run against a permissive
// fake DOM (see makeDom), which keeps the production output free of test scaffolding.
//
// Run with:
//   node --test plugins/cli-dispatch/scripts/__tests__/public-page.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { PAGE } from '../public-page.mjs'

// ============================================================================
// Inline-script extraction
// ============================================================================

// Matches <script> ... </script> but skips the vendored `src=` tags (xterm.js / addon-fit),
// which have no body of their own. Safe against a literal '</script>' inside client code
// because there is none — verified: the only '</script>' occurrences in the file are the
// three real closers plus the two vendor self-closers.
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g

function inlineScripts() {
  return [...PAGE.matchAll(INLINE_SCRIPT_RE)].map(m => m[1])
}

// ============================================================================
// (a) Parse layer — the 3.15.2 regression guard
// ============================================================================

test('1. PAGE carries exactly three inline scripts (theme bootstrap, header glyph, main SPA)', () => {
  const bodies = inlineScripts()
  assert.equal(bodies.length, 3, 'expected 3 inline <script> bodies')
  // Cheap identity checks so a reordering does not silently repoint the later assertions.
  assert.match(bodies[0], /cli-dispatch-theme/, 'first inline script is the pre-paint theme setter')
  assert.match(bodies[1], /themeBtn/, 'second inline script is the header glyph setter')
  assert.match(bodies[2], /function workerBucket/, 'third inline script is the main SPA')
})

test('2. every inline script compiles as the browser would parse it', () => {
  // This is THE test. A collapsed quote or a stray backslash surfaces here as a SyntaxError
  // instead of as a blank dashboard.
  for (const [i, src] of inlineScripts().entries()) {
    assert.doesNotThrow(() => new vm.Script(src), `inline script #${i} must parse`)
  }
})

test('3. PAGE contains no ${ — an un-escaped server-side interpolation', () => {
  // The whole file is one template literal, so a literal `${` in client code would be
  // interpolated by Node at import time rather than reaching the browser.
  assert.equal(PAGE.includes('${'), false, 'found ${ in the served page')
})

test('4. <script> open/close tags balance', () => {
  const opens = (PAGE.match(/<script[\s>]/g) || []).length
  const closes = (PAGE.match(/<\/script>/g) || []).length
  assert.equal(opens, closes, `unbalanced script tags: ${opens} open vs ${closes} close`)
})

// ============================================================================
// Harness — evaluate the main SPA against a permissive fake DOM
// ============================================================================

// A universally-permissive stub: any property read yields another stub, it is callable, and
// it accepts any assignment. That lets the bootstrap tail (tab handlers, initRailDrag,
// loadList, EventSource wiring) run to completion without us having to model the real DOM.
function makeStub(name = 'stub') {
  const target = function () {}
  target._name = name
  return new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => ''
      if (prop === Symbol.iterator) return [][Symbol.iterator].bind([])
      if (prop === 'then') return undefined // never look like a thenable
      if (prop === 'length') return 0
      if (prop === 'style' || prop === 'classList' || prop === 'dataset') return makeStub(prop)
      if (prop in t) return t[prop]
      return makeStub(String(prop))
    },
    set() {
      return true
    },
    apply() {
      return makeStub(name + '()')
    },
    construct() {
      return makeStub('new ' + name)
    },
  })
}

function makeDom() {
  const store = new Map()
  // Explicit behaviours where the client's logic actually depends on the return value;
  // everything else falls through to makeStub, so a DOM call we did not anticipate (e.g.
  // createDocumentFragment, which loadList() makes synchronously before its fetch) cannot
  // turn into an unhandled rejection that masks a real failure.
  const docOverrides = {
    documentElement: makeStub('documentElement'),
    // Returning null exercises the real null-guards (e.g. `taskPanel?taskPanel.open:false`).
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const doc = new Proxy(docOverrides, {
    get(t, prop) {
      if (prop in t) return t[prop]
      return makeStub('document.' + String(prop))
    },
    set() {
      return true
    },
  })
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    addEventListener: () => {},
    location: { href: 'http://127.0.0.1:7878/' },
  }
  const sandbox = {
    document: doc,
    window: win,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    // Never resolves: loadList()'s in-flight fetch must not race the assertions.
    fetch: () => new Promise(() => {}),
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    WebSocket: class {
      send() {}
      close() {}
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    console,
    Terminal: class {
      open() {}
      write() {}
      onData() {}
      focus() {}
      dispose() {}
    },
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  return sandbox
}

// `esc`, `escAttr`, `fmtUsage`, `shortProj`, ... are top-level `const`s, so they do NOT become
// properties of the sandbox global (only `function` declarations do). Appending an explicit
// export line to the EVALUATED COPY — never to the source file — gives the test lexical access
// to them without changing what ships.
const EXPORTS = [
  'esc', 'escAttr', 'md', 'mdInline', 'workerBucket',
  'fmtUsage', 'fmtTok', 'shortProj', 'shortSessionProj',
  'WORKER_BUCKETS', 'WORKER_DOT', 'WORKER_BADGE_CLS',
  'verifyBadgeHtml', 'verifyPhrase', 'changeSize', 'runLineHtml', 'workerMetaLineHtml',
  'usageTokenStr', 'matchesWorkerFilter',
  'verdictStripHtml', 'verifyPanelHtml', 'verifyTailHtml',
  'changedFilesPanelHtml', 'runEnvPanelHtml', 'authPanelHtml', 'runnerExitSentence',
]

// Only these are expected to be functions; the rest are lookup tables.
const EXPORTED_TABLES = new Set(['WORKER_BUCKETS', 'WORKER_DOT', 'WORKER_BADGE_CLS'])

let cachedApi = null
function api() {
  if (cachedApi) return cachedApi
  const main = inlineScripts()[2]
  const sandbox = makeDom()
  const context = vm.createContext(sandbox)
  const shim = '\n;globalThis.__test_exports = {' + EXPORTS.join(',') + '};'
  new vm.Script(main + shim, { filename: 'public-page-inline.js' }).runInContext(context)
  cachedApi = sandbox.__test_exports
  assert.ok(cachedApi, 'harness failed to export the client API')
  return cachedApi
}

test('5. the main SPA evaluates end to end against a fake DOM (bootstrap tail included)', () => {
  const a = api()
  for (const name of EXPORTS) {
    if (EXPORTED_TABLES.has(name)) {
      assert.equal(typeof a[name], 'object', `${name} should be a lookup table`)
      continue
    }
    assert.equal(typeof a[name], 'function', `${name} should be callable after evaluation`)
  }
})

// ============================================================================
// (b) Escaping — the 3.14.2 XSS guard, pinned as behaviour
// ============================================================================

test('6. esc() neutralises HTML-significant characters', () => {
  const { esc } = api()
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(esc('a & b'), 'a &amp; b')
  assert.equal(esc(null), '')
  assert.equal(esc(undefined), '')
  assert.equal(esc(0), '0', 'falsy-but-real values must survive')
})

test('7. escAttr() also escapes both quote characters (esc() deliberately does not)', () => {
  const { esc, escAttr } = api()
  assert.equal(escAttr('a\'b"c'), 'a&#39;b&quot;c')
  // The 3.14.2 bug was using esc() where escAttr() was required. Pin the difference so a
  // future "simplification" that collapses the two functions fails loudly.
  assert.ok(esc('a"b').includes('"'), 'esc must leave a bare double quote (hence attr-unsafe)')
  assert.ok(!escAttr('a"b').includes('"'), 'escAttr must not leave a bare double quote')
})

// md() emits its own markup, so "output contains no '<'" is not the invariant. The real
// property is: EVERY tag in the output is one md() itself generated. Attacker text can still
// contain the characters `onerror=` — harmless once its `<` became `&lt;`, because no tag can
// form around it. Asserting the allowlist instead of grepping for scary substrings is what
// makes this a durable guard rather than a bypassable one.
const MD_ALLOWED_TAG = /^<\/?(strong|em|a|code|div|ul|li|br|pre)(\s[^>]*)?>$/

function assertOnlyWhitelistedTags(html, label) {
  for (const tag of html.match(/<[^>]*>/g) || []) {
    assert.match(tag, MD_ALLOWED_TAG, `${label}: unexpected tag in md() output: ${tag}`)
  }
}

test('8. md() is escape-first: input markup never becomes output markup', () => {
  const { md } = api()
  const hostile = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    '<div onclick="x">click</div>',
    '<iframe src=javascript:alert(1)>',
  ]
  for (const input of hostile) {
    const out = md(input)
    assertOnlyWhitelistedTags(out, JSON.stringify(input))
    assert.ok(!out.includes('<script'), 'no script tag may survive')
    assert.ok(!out.includes('<img'), 'no img tag may survive')
    assert.ok(!out.includes('<iframe'), 'no iframe tag may survive')
  }
  // And the escaped form must actually be present — i.e. the input was rendered, not dropped.
  assert.ok(md('<img src=x>').includes('&lt;img'), 'the tag must appear escaped instead')
})

test('9. md() sanitises link targets to http(s) and root-relative only', () => {
  const { md } = api()
  assert.ok(!md('[x](javascript:alert(1))').includes('javascript:'), 'javascript: must be dropped')
  assert.ok(md('[x](https://example.com)').includes('href="https://example.com"'), 'https must pass')
  assert.ok(md('[x](/local)').includes('href="/local"'), 'root-relative must pass')
})

// ============================================================================
// (c) Current worker-state mapping — baseline before the enum fix
// ============================================================================

// The whole 5-value enum, one bucket each. `killed` is the regression lock: it used to hit the
// catch-all and be reported as an `error` — the identical bug the file's own comment records
// having already fixed once for `human-controlled`.
test('10. workerBucket gives every state in the 5-value enum its own bucket', () => {
  const { workerBucket } = api()
  assert.equal(workerBucket({ state: 'running' }), 'running')
  assert.equal(workerBucket({ state: 'done' }), 'done')
  assert.equal(workerBucket({ state: 'error' }), 'error')
  assert.equal(workerBucket({ state: 'human-controlled' }), 'human')
  assert.equal(workerBucket({ state: 'killed' }), 'killed', 'killed must NOT be reported as error')
  // stale is a server-derived flag, only ever set alongside state==='running'.
  assert.equal(workerBucket({ state: 'running', stale: true }), 'stale')
})

test('10b. an unrecognised state becomes "unknown", never "error"', () => {
  const { workerBucket } = api()
  // A 6th state added to the enum later must not be libelled a failure by the catch-all.
  assert.equal(workerBucket({ state: 'paused' }), 'unknown')
  assert.equal(workerBucket({}), 'unknown')
})

test('10c. every bucket workerBucket can return is renderable and filterable', () => {
  const { workerBucket, WORKER_BUCKETS, WORKER_DOT } = api()
  const states = ['running', 'done', 'error', 'killed', 'human-controlled', 'paused', undefined]
  const produced = new Set(states.map(s => workerBucket({ state: s })))
  produced.add(workerBucket({ state: 'running', stale: true }))
  for (const bucket of produced) {
    assert.ok(WORKER_BUCKETS.includes(bucket), `bucket "${bucket}" has no filter chip`)
    assert.ok(WORKER_DOT[bucket], `bucket "${bucket}" has no dot class`)
  }
  // And nothing unreachable is advertised as a chip.
  for (const bucket of WORKER_BUCKETS) {
    assert.ok(produced.has(bucket), `chip "${bucket}" is not reachable from any state`)
  }
})

test('10d. a dead worker and a killed worker are visually distinct', () => {
  const { WORKER_DOT, WORKER_BADGE_CLS } = api()
  // "the worker crashed" vs "a human stopped it" must not share a colour.
  assert.equal(WORKER_DOT.error, 'dead')
  assert.equal(WORKER_DOT.killed, 'idle')
  assert.notEqual(WORKER_DOT.error, WORKER_DOT.killed)
  assert.match(WORKER_BADGE_CLS.error, /\berr\b/)
  assert.match(WORKER_BADGE_CLS.killed, /\bwarn\b/)
})

test('11. formatters behave on the shapes the API actually returns', () => {
  const { fmtTok, shortProj, shortSessionProj, fmtUsage } = api()
  assert.equal(fmtTok(999), '999')
  assert.equal(fmtTok(1500), '1.5K')
  assert.equal(fmtTok(2000000), '2M')
  // A run's cwd is a throwaway worktree, which is exactly why the row stops showing it.
  assert.equal(shortProj('/tmp/ds-wt-oUSONx'), 'tmp/ds-wt-oUSONx')
  assert.equal(shortProj(''), '')
  assert.equal(shortSessionProj('-Users-rbinar-Documents-Repos-cli-dispatch'), 'cli/dispatch')
  // Returns null (not a zeroed object) so callers render nothing at all for a usage-less
  // session — every call site must keep null-checking. Pinned because Aşama 8 adds a
  // partial-usage branch right next to this.
  assert.equal(fmtUsage(null), null, 'no usage must yield null, not zeros')
  // Note the lowercase 'k': fmtUsage has its OWN abbreviator, distinct from fmtTok's 'K'.
  assert.equal(fmtUsage({ inTok: 1500, outTok: 40 }).tokStr, '1.5k in / 40 out')
})

// ---- deterministic-runner row presentation (4.3.0) ----

const RUN_ROW = {
  id: 'ds-run-1', backend: 'deepseek', model: 'deepseek-v4-pro', state: 'done',
  hasVerdict: true, changedFileCount: 2, diffstat: '1 file changed, 67 insertions(+)',
  verdict: { verify: 'fail', verifyExit: 4, outcome: 'verify-failed', stranded: true, malformed: false },
}
const PLAIN_ROW = {
  id: 'cx-1', backend: 'codex', model: 'gpt-5.3-codex', state: 'done',
  hasVerdict: false, verdict: null, changedFileCount: 0, diffstat: '',
}

test('12. a verify failure is a separate axis from the worker state', () => {
  const { verifyBadgeHtml, verifyPhrase } = api()
  // The worker finished; the CHECK failed. Both facts, two places, no contradiction.
  assert.match(verifyBadgeHtml(RUN_ROW), /verify ✗ e4/)
  assert.match(verifyBadgeHtml(RUN_ROW), /badge fail/)
  assert.match(verifyPhrase(RUN_ROW.verdict), /exit 4/)
  // A worker that died itself carries no verify token at all.
  assert.equal(verifyBadgeHtml({ verdict: null }), '')
})

test('13. an unchecked run is never rendered as a pass', () => {
  const { verifyBadgeHtml, verifyPhrase } = api()
  const none = { verify: 'none', verifyExit: null }
  // No badge, and certainly not a green one — this is the most expensive possible lie here.
  assert.equal(verifyBadgeHtml({ verdict: none }), '')
  assert.ok(!verifyBadgeHtml({ verdict: none }).includes('pass'))
  assert.match(verifyPhrase(none), /no verify requested/)
  assert.ok(!verifyPhrase(none).includes('ok'), 'must not use the success class')
})

test('14. a broken verify harness blames the harness, not the worker', () => {
  const { verifyBadgeHtml, verifyPhrase } = api()
  for (const [ex, wording] of [[127, /command not found/], [126, /command not found/], [124, /timed out/]]) {
    const v = { verify: 'harness', verifyExit: ex }
    assert.match(verifyPhrase(v), wording, 'exit ' + ex)
    // Amber, not red: the check never ran, so this is not a verdict on the work.
    assert.match(verifyBadgeHtml({ verdict: v }), /badge warn/)
    assert.ok(!verifyBadgeHtml({ verdict: v }).includes('badge fail'))
  }
})

test('15. changeSize shortens a diffstat and falls back to a bare file count', () => {
  const { changeSize } = api()
  assert.equal(changeSize({ diffstat: ' 3 files changed, 42 insertions(+), 7 deletions(-)' }), '3 files +42/-7')
  assert.equal(changeSize({ diffstat: '1 file changed, 67 insertions(+)' }), '1 file +67')
  // A real on-disk shape: changed files recorded with an empty diffstat.
  assert.equal(changeSize({ diffstat: '', changedFileCount: 2 }), '2 files')
  assert.equal(changeSize({ diffstat: '', changedFileCount: 1 }), '1 file')
  assert.equal(changeSize({ diffstat: '', changedFileCount: 0 }), '')
  assert.equal(changeSize({}), '')
})

test('16. the run line is omitted entirely for a worker with nothing to report', () => {
  const { runLineHtml } = api()
  // 107 of 120 real sessions are this case. The row must look complete, not broken.
  assert.equal(runLineHtml(PLAIN_ROW), '')
  assert.ok(runLineHtml(RUN_ROW).length > 0)
  // A plain worker that did change files still gets a size, with no verify wording.
  const changed = runLineHtml({ ...PLAIN_ROW, changedFileCount: 2, diffstat: ' 2 files changed, 19 insertions(+)' })
  assert.match(changed, /2 files \+19/)
  assert.ok(!/verify/.test(changed), 'a non-run must not mention verify')
})

test('17. a pending verdict is announced while verify is still running', () => {
  const { runLineHtml } = api()
  const pending = runLineHtml({ ...PLAIN_ROW, verdictPending: true })
  assert.match(pending, /verify in progress/)
})

test('18. an auth failure says the worker never ran instead of showing a generic error', () => {
  const { runLineHtml } = api()
  const out = runLineHtml({ ...PLAIN_ROW, state: 'error', errorKind: 'auth', error: 'missing DEEPSEEK_API_KEY' })
  assert.match(out, /authentication failed/)
  assert.match(out, /never ran/)
  assert.match(out, /missing DEEPSEEK_API_KEY/)
})

test('19. a mid-run token snapshot is not presented as a total', () => {
  const { usageTokenStr } = api()
  // The exact real shape: four sessions on disk have output_tokens 0 with large input.
  const partialZero = { usage: { inTok: 51700, outTok: 0 }, usagePartial: true }
  const out = usageTokenStr(partialZero)
  assert.ok(!out.includes('0 out'), 'the specific wrong number must not be shown: ' + out)
  assert.match(out, /out not captured/)
  // A complete total renders exactly as before.
  assert.equal(usageTokenStr({ usage: { inTok: 1500, outTok: 40 }, usagePartial: false }), '1.5k in / 40 out')
  // Partial but with real output: marked, not hidden.
  assert.match(usageTokenStr({ usage: { inTok: 1500, outTok: 40 }, usagePartial: true }), /~$/)
  assert.equal(usageTokenStr({ usage: null }), '')
})

test('20. the verify-fail filter finds failures the lifecycle chips cannot express', () => {
  const { matchesWorkerFilter } = api()
  // The whole point: a verify failure has state 'done', so 'done' and 'error' both miss it.
  assert.equal(matchesWorkerFilter(RUN_ROW, 'verify-fail'), true)
  assert.equal(matchesWorkerFilter(RUN_ROW, 'done'), true)
  assert.equal(matchesWorkerFilter(RUN_ROW, 'error'), false)
  assert.equal(matchesWorkerFilter(PLAIN_ROW, 'verify-fail'), false)
  assert.equal(matchesWorkerFilter(PLAIN_ROW, 'all'), true)
})

test('21. hostile verdict values cannot inject markup into the row', () => {
  const { runLineHtml, verifyBadgeHtml, changeSize, esc } = api()
  const hostile = {
    ...PLAIN_ROW,
    errorKind: 'auth',
    error: '<img src=x onerror=alert(1)>',
    diffstat: '<script>alert(1)</script>',
    changedFileCount: 1,
  }
  const line = runLineHtml(hostile)
  assert.ok(!line.includes('<img'), 'error text must be escaped')
  assert.ok(!line.includes('<script'), 'no script tag may appear')
  // changeSize output is escaped by its caller; confirm the caller does it.
  const dsRow = { ...PLAIN_ROW, diffstat: '1 file changed, 2 insertions(+)<script>x</script>', changedFileCount: 1 }
  assert.ok(!runLineHtml(dsRow).includes('<script'))
  // A non-numeric verifyExit must not be interpolated raw into the badge.
  const badExit = verifyBadgeHtml({ verdict: { verify: 'fail', verifyExit: '<script>' } })
  assert.ok(!badExit.includes('<script'), 'a non-finite exit code must be dropped: ' + badExit)
  assert.equal(esc('<b>'), '&lt;b&gt;')
})

// ---- worker detail panels (4.3.0) ----

const FLOW_RUN = {
  state: 'done',
  usage: { inTok: 100, outTok: 50 },
  verdict: {
    exitCode: 1, outcome: 'verify-failed', malformed: false, error: '',
    stranded: true, worktreeExists: false, sourceRepo: '',
    branch: 'ds-run-1', baseRef: 'origin/main', worktree: '/tmp/ds-wt-oUSONx',
    state: 'done', completedVia: 'autonomous',
    diffstat: '1 file changed, 67 insertions(+)', changedFiles: ['a.py'],
    recordedAt: '2026-07-24T01:09:38.817Z', startedAt: '2026-07-24T01:08:05.441Z',
    verify: {
      source: 'verdict', commands: ['pytest tests/test_x.py -q'],
      exitCode: 4, failedAt: 0, state: 'fail', tail: 'no tests ran\nERROR: not found',
    },
  },
  changedFiles: {
    source: 'changed-files.json', diffstat: '1 file changed, 67 insertions(+)',
    files: [{ path: 'a.py', status: 'M' }], truncated: false, preexistingDirty: ['CLAUDE.md'],
  },
  diff: { available: true, source: 'verdict-diff.patch', bytes: 1359, truncated: false, url: '/api/worker/x/diff' },
}

test('22. the runner exit code is spelled out and attributed to the runner', () => {
  const { runnerExitSentence, verdictStripHtml } = api()
  // "done · exit 1" side by side is exactly the confusion to avoid: they measure different things.
  assert.match(runnerExitSentence({ exitCode: 1 }), /runner exit 1/)
  assert.match(runnerExitSentence({ exitCode: 1 }), /verify failed/)
  assert.match(runnerExitSentence({ exitCode: 2 }), /died or was killed/)
  assert.match(runnerExitSentence({ exitCode: 4 }), /human took over/)
  assert.equal(runnerExitSentence({ exitCode: 'x' }), '', 'a non-numeric code renders nothing')
  assert.match(verdictStripHtml(FLOW_RUN), /deterministic run/)
})

test('23. a build-failure verdict suppresses every other verdict panel', () => {
  const { verdictStripHtml, verifyPanelHtml, changedFilesPanelHtml, runEnvPanelHtml } = api()
  const flow = { state: 'done', verdict: { malformed: true, error: 'build-verdict failed (exit 5)', verify: null } }
  const strip = verdictStripHtml(flow)
  assert.match(strip, /could not be built/)
  assert.match(strip, /build-verdict failed/)
  assert.ok(!/verify ✓/.test(strip), 'must not claim a passing verify')
  // The other panels have nothing to say and must stay silent rather than render empty shells.
  assert.equal(verifyPanelHtml(flow, {}), '')
  assert.equal(changedFilesPanelHtml(flow, {}, 'x'), '')
  assert.equal(runEnvPanelHtml(flow, {}), '')
})

test('24. commands after the failing one are marked "not run", never as passed', () => {
  const { verifyPanelHtml } = api()
  const flow = {
    state: 'done',
    verdict: {
      malformed: false,
      verify: { commands: ['a', 'b', 'c'], exitCode: 1, failedAt: 1, state: 'fail', tail: '' },
    },
  }
  const html = verifyPanelHtml(flow, {})
  assert.match(html, /not run/, 'runVerify stops at the first failure')
  // Exactly one failure marker, and the trailing command is not ticked.
  assert.equal((html.match(/class="err">✗/g) || []).length, 1)
  assert.equal((html.match(/not run/g) || []).length, 1)
})

test('25. the verify panel opens on failure and stays shut on success', () => {
  const { verifyPanelHtml } = api()
  const fail = { state: 'done', verdict: { malformed: false, verify: { commands: ['a'], exitCode: 1, failedAt: 0, state: 'fail', tail: '' } } }
  const pass = { state: 'done', verdict: { malformed: false, verify: { commands: ['a'], exitCode: 0, failedAt: null, state: 'pass', tail: '' } } }
  assert.match(verifyPanelHtml(fail, {}), /data-pk="verify" open/)
  assert.ok(!/ open>/.test(verifyPanelHtml(pass, {})), 'a passing verify need not be expanded')
  // An explicit snapshot always wins, so a live refresh cannot slam a panel the user opened.
  assert.match(verifyPanelHtml(pass, { verify: true }), /open/)
  assert.ok(!/ open>/.test(verifyPanelHtml(fail, { verify: false })))
})

test('26. an empty verify tail renders no panel at all', () => {
  const { verifyTailHtml } = api()
  const noTail = { verdict: { verify: { commands: ['a'], exitCode: 0, failedAt: null, state: 'pass', tail: '' } } }
  assert.equal(verifyTailHtml(noTail, {}), '', 'a passing run must not show an empty box')
  assert.match(verifyTailHtml(FLOW_RUN, {}), /output tail/)
})

test('27. preexisting dirty files are attributed away from the worker', () => {
  const { changedFilesPanelHtml } = api()
  const html = changedFilesPanelHtml(FLOW_RUN, {}, 'x')
  assert.match(html, /already dirty before this worker started/)
  assert.match(html, /not its work/)
  assert.match(html, /CLAUDE\.md/)
  // The patch link is offered, and the true size stated.
  assert.match(html, /href="\/api\/worker\/x\/diff"/)
  assert.match(html, /1359 bytes/)
})

test('28. a stranded worktree that is gone offers no cleanup command', () => {
  const { runEnvPanelHtml } = api()
  const gone = runEnvPanelHtml(FLOW_RUN, {})
  assert.match(gone, /recorded at run end/, 'stated as a recorded fact, not live truth')
  assert.match(gone, /no longer on disk/)
  assert.ok(!/worktree remove/.test(gone), 'must not tell the user to remove a directory that is not there')
  assert.ok(!/⚠/.test(gone), 'stranded alone is the expected outcome of a successful run')

  // ...and when it IS still there, the command is built from the resolved source repo.
  const present = runEnvPanelHtml({
    ...FLOW_RUN,
    verdict: { ...FLOW_RUN.verdict, worktreeExists: true, sourceRepo: '/Users/x/repo' },
  }, {})
  assert.match(present, /still on disk/)
  assert.match(present, /git -C "\/Users\/x\/repo" worktree remove/)
  assert.match(present, /worktree prune/)
  assert.match(present, /cli-dispatch:clean --worktree-days/)

  // With no resolvable repo, only the form that does not need one is offered.
  const noRepo = runEnvPanelHtml({
    ...FLOW_RUN,
    verdict: { ...FLOW_RUN.verdict, worktreeExists: true, sourceRepo: '' },
  }, {})
  assert.match(noRepo, /git -C "\/tmp\/ds-wt-oUSONx" worktree remove/)
  assert.ok(!/git -C "" /.test(noRepo), 'must never emit an empty repo path')
})

test('29. verdict.state and the live state are only compared when they differ', () => {
  const { verdictStripHtml } = api()
  assert.ok(!/at run end/.test(verdictStripHtml(FLOW_RUN)), 'agreeing states add no noise')
  const drifted = verdictStripHtml({ ...FLOW_RUN, state: 'running', verdict: { ...FLOW_RUN.verdict, state: 'human-controlled' } })
  assert.match(drifted, /state now: running/)
  assert.match(drifted, /at run end: human-controlled/)
})

test('30. an auth failure gets its own panel pointing at the fix', () => {
  const { authPanelHtml } = api()
  assert.equal(authPanelHtml({ errorKind: null }), '')
  const html = authPanelHtml({ errorKind: 'auth', error: 'missing DEEPSEEK_API_KEY' })
  assert.match(html, /never ran/)
  assert.match(html, /cli-dispatch:doctor/)
  assert.match(html, /missing DEEPSEEK_API_KEY/)
})

test('31. hostile verdict strings cannot inject markup into any detail panel', () => {
  const { verifyPanelHtml, verifyTailHtml, changedFilesPanelHtml, runEnvPanelHtml, authPanelHtml } = api()
  const XSS = '<img src=x onerror=alert(1)>'
  const flow = {
    state: 'done',
    errorKind: 'auth',
    error: XSS,
    verdict: {
      malformed: false, stranded: true, worktreeExists: true,
      // Attacker-influencable: these come out of files five external CLIs write.
      branch: XSS, baseRef: XSS, worktree: XSS, sourceRepo: XSS,
      completedVia: XSS, diffstat: XSS, changedFiles: [], recordedAt: '', startedAt: '',
      state: 'done', exitCode: 1,
      verify: { commands: [XSS], exitCode: 1, failedAt: 0, state: 'fail', tail: XSS },
    },
    changedFiles: {
      source: 'changed-files.json', diffstat: XSS, truncated: false,
      files: [{ path: XSS, status: '<b>' }], preexistingDirty: [XSS],
    },
    diff: { available: true, source: XSS, bytes: 1, truncated: false, url: '/api/worker/' + XSS + '/diff' },
  }
  // As in test 8, the invariant is an ALLOWLIST, not a substring grep: escaped text may legitimately
  // still contain the characters "onerror=" once its '<' became '&lt;', because no tag can form
  // around it. Grepping for scary substrings would fail on safe output and pass on unsafe output
  // that used a different attribute name.
  const PANEL_TAG = /^<\/?(details|summary|div|span|pre|a|b)(\s[^>]*)?>$/
  for (const [label, html] of [
    ['verify', verifyPanelHtml(flow, {})],
    ['tail', verifyTailHtml(flow, {})],
    ['files', changedFilesPanelHtml(flow, {}, 'ds-run-1')],
    ['env', runEnvPanelHtml(flow, {})],
    ['auth', authPanelHtml(flow)],
  ]) {
    assert.ok(!html.includes('<img'), label + ': raw tag leaked')
    for (const tag of html.match(/<[^>]*>/g) || []) {
      assert.match(tag, PANEL_TAG, label + ': unexpected tag ' + tag)
    }
    // No attacker text may end up inside an attribute value.
    for (const attr of html.match(/\w+="[^"]*"/g) || []) {
      assert.ok(!attr.includes('onerror'), label + ': attacker text reached an attribute: ' + attr)
    }
  }
  // The git status code must never reach a class attribute unfiltered.
  const files = changedFilesPanelHtml(flow, {}, 'ds-run-1')
  assert.ok(!/class="badge <b>/.test(files), 'status went into a class attribute')
})

// Markdown rendering stays limited to prose. Running it on tool output or a filename would turn
// data into markup — mdInline deliberately BUILDS <a>/<strong>/<code>.
test('32. md() is never applied to verdict-derived text', () => {
  const { verifyTailHtml, changedFilesPanelHtml } = api()
  const flow = {
    ...FLOW_RUN,
    verdict: { ...FLOW_RUN.verdict, verify: { ...FLOW_RUN.verdict.verify, tail: '**bold** and `code`' } },
    changedFiles: { ...FLOW_RUN.changedFiles, files: [{ path: '**star**.py', status: 'M' }] },
  }
  assert.match(verifyTailHtml(flow, {}), /\*\*bold\*\*/, 'the tail must stay literal')
  assert.ok(!verifyTailHtml(flow, {}).includes('<strong>'), 'no markdown transform on tool output')
  assert.match(changedFilesPanelHtml(flow, {}, 'x'), /\*\*star\*\*\.py/, 'a filename must stay literal')
})

// ---- worker row: the start time sits at the right edge of the metadata line ---------------

test('workerMetaLineHtml: the timestamp is last in the DOM and carries the right-pinning class', () => {
  const { workerMetaLineHtml } = api()
  const html = workerMetaLineHtml(
    { cwd: '/tmp/blinkfin/api', started: '2026-07-26T22:20:19.000Z', lastTool: 'Edit' },
    true,
    '71.2k in / 12.0k out',
  )

  // Order is the point of the change: left tokens, then the time.
  const whenAt = html.indexOf('class="when"')
  assert.notEqual(whenAt, -1, 'the time needs the .when class — that is what pins it right')
  assert.ok(html.indexOf('blinkfin/api') < whenAt, 'repo token must precede the time')
  assert.ok(html.indexOf('71.2k in') < whenAt, 'usage must precede the time')
  // .when is the LAST element, so nothing can be appended after it and still read as right-aligned.
  assert.match(html.slice(whenAt), /^class="when">[^<]*<\/span><\/div>$/)

  // The left group is a single ellipsis-able box: the rail truncates the repo name, never the time.
  assert.match(html, /<span class="lt">/)
  assert.ok(html.indexOf('<span class="lt">') < whenAt)
})

test('workerMetaLineHtml: parent session is the first token when resolved, id-only, or absent', () => {
  const { workerMetaLineHtml } = api()
  const parentSessionId = '0f3b3761-0c73-4650-abde-d5374bb04f3b'

  const resolved = workerMetaLineHtml({
    parentSessionId,
    parentProject: '-Users-someone-Repos-blinkbrosai-blinkfin',
    cwd: '/tmp/blinkfin/api',
    started: '',
  }, false, '')
  assert.match(resolved, /<span class="lt">blinkbrosai\/blinkfin 0f3b3761 · blinkfin\/api<\/span>/)

  const idOnly = workerMetaLineHtml({
    parentSessionId,
    parentProject: null,
    cwd: '/tmp/blinkfin/api',
    started: '',
  }, false, '')
  assert.match(idOnly, /<span class="lt">0f3b3761 · blinkfin\/api<\/span>/)

  const absent = workerMetaLineHtml({ cwd: '/tmp/blinkfin/api', started: '' }, false, '')
  assert.match(absent, /<span class="lt">blinkfin\/api<\/span>/)
  assert.doesNotMatch(absent, /0f3b3761|blinkbrosai/)
})

test('workerMetaLineHtml: absent tokens leave no dangling separators', () => {
  const { workerMetaLineHtml } = api()

  // No cwd, not live, no usage — the left box is empty but the time still renders.
  const bare = workerMetaLineHtml({ started: '2026-07-26T22:20:19.000Z' }, false, '')
  assert.match(bare, /<span class="lt"><\/span>/, 'empty left group, not a stray separator')
  assert.doesNotMatch(bare, /·/, 'no separator without two tokens to separate')
  assert.match(bare, /class="when">.+<\/span>/)

  // lastTool is suppressed on a finished row even when present (3.40.2: fossils do not ship).
  const dead = workerMetaLineHtml({ cwd: '/tmp/x/y', started: '', lastTool: 'Bash' }, false, '')
  assert.doesNotMatch(dead, /Bash/, 'lastTool must not survive on a non-live row')

  // A missing start time must not print the literal "Invalid Date".
  assert.doesNotMatch(dead, /Invalid Date/)
})

test('workerMetaLineHtml: hostile cwd and lastTool are escaped', () => {
  const { workerMetaLineHtml } = api()
  const html = workerMetaLineHtml(
    { cwd: '/tmp/"><script>alert(1)</script>/x', started: '2026-07-26T22:20:19.000Z', lastTool: '<img src=x onerror=alert(1)>' },
    true,
    '1 in',
  )
  assert.doesNotMatch(html, /<script/)
  assert.doesNotMatch(html, /<img/)
  for (const tag of html.match(/<\/?[a-zA-Z][^>]*>/g) || []) {
    assert.match(tag, /^<\/?(div|span)(\s[^>]*)?>$/, `unexpected tag rendered: ${tag}`)
  }
})
