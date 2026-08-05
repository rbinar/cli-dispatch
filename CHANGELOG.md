# Changelog

All notable changes to **cli-dispatch** (formerly **claude-ds**) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: the `README.md` is in Turkish by design; this changelog and all other docs are in English.

## [4.16.0] — 2026-08-05

### Fixed

- **The statusline's staleness-boundary test was a zero-margin race, and failed intermittently
  under full-suite load.** `session at exactly 90s is counted (≤ stale threshold)` wrote a
  fixture whose `status.json` mtime was exactly `now - 90`, then spawned the script, which
  computes `now - mtime` against `-le 90` using its own wall clock. Any real second elapsing
  between the write and the spawn turned 90 into 91 and flipped the assertion. Measured
  directly: at 0s delay the script sees 90 (counted), at 2s delay it sees 92 (not counted).
  Reproduced as 1 failure in 3 full-suite runs; 0 in 5 after the fix.
  `cli-dispatch-statusline.sh` now reads `now` from `CLI_DISPATCH_NOW` when set, falling back
  to `date +%s` — so behaviour outside tests is unchanged — and both boundary tests anchor the
  clock to the fixture's own mtime instead of the wall clock. The 91s sibling was never flaky
  (91 drifting to 92 stays excluded) but is pinned too, which is what makes the pair an actual
  boundary test rather than two loosely-related assertions.
  Negative-controlled: moving the threshold to 89, and changing `-le` to `-lt`, both make the
  90s test fail — so it still measures the boundary rather than merely passing.

## [4.15.0] — 2026-08-02

### Added

- **`verdict.json` now carries the worker's evidence record.** `cli-dispatch-run` appends a
  standing instruction asking the worker to write `worker-report.json` in its working
  directory — `claims[]` of `{claim, howVerified, command, result}`, plus `notDone[]` and
  `assumptions[]`. `verdict-writer.mjs` normalizes it and folds it into the verdict under
  `workerReport`. Opt out with `CLI_DISPATCH_NO_WORKER_REPORT=1`; it is a separate block
  from the working-directory contract and has its own switch.

  **This is a self-report, and it is deliberately not treated as evidence.** It exists
  because workers already prove things when asked — across three delegated runs the worker
  was told to prove output equivalence, did prove it, and the proof reached the orchestrator
  only as a 300-character clipped preview, so the orchestrator re-derived all of it by hand.
  The record makes that proof machine-readable, turning "re-check everything" into a
  specific list of what to re-check. It does not make any claim true, and `--verify` still
  only ever says "the tests pass" — never "the output is unchanged".

  Consequences of that framing, baked into the shape:
  - `unevidencedClaims` counts claims with **no command** behind them, so an assertion can
    never read like a measurement. Such claims are kept, not dropped — hiding them would be
    worse than counting them.
  - a missing report is `null`; a written-but-unusable one is `{valid: false, reason}`.
    "The worker wrote garbage" and "the worker claimed nothing" must not look identical.
  - claims/lists are capped at 50 entries and 2000 chars per field, so a runaway report
    cannot bloat the verdict every consumer reads.

- `__tests__/worker-report.test.mjs` (10 tests) and two runner-brief tests covering the
  default-on behaviour and the opt-out. Suite: 479 → 490.

### Changed

- `.specs/dev/sdd/deterministic-runner.md` documents the `workerReport` block, including the
  explicit "kanıt DEĞİL, kanıt KAYDI" framing, so the next reader of the schema cannot
  mistake it for a verification result.

## [4.14.0] — 2026-08-01

### Added

- **Session dirs are now capped passively, at write time.** Every parser calls
  `parse-utils.mjs`'s new `pruneSessionRoot()` once, right after creating its own session
  dir, trimming the root to the newest `CLI_DISPATCH_MAX_SESSIONS` (default **100**)
  *finished* sessions. Until now the root only ever shrank if someone ran
  `/cli-dispatch:clean` or installed the scheduled job — and a machine with neither was
  found holding 41 sessions / 54 MB with nothing pruning it. Idea borrowed from
  codex-plugin-cc's `MAX_JOBS`.

  This deletes data, so the guarantees matter:
  - a **non-terminal** session (`running`, `human-controlled`) is never removed, however
    old it sorts — a live worker survives a sibling's prune
  - a session that never wrote a state at all is **left alone**: a parser that died before
    its first status write is indistinguishable from one that never started, and only
    `cli-dispatch-clean` has the idle-time evidence to judge it
  - `verdict.json` / `verdict-diff.patch` are copied into `sessions/verdict-archive/`
    before the directory goes, so a passive cap can never destroy the only record of a
    deterministic run
  - the calling session's own dir is exempt, and every failure is swallowed — housekeeping
    must not be able to break the run that triggered it
  - `CLI_DISPATCH_MAX_SESSIONS=0` disables pruning; a negative or unparseable value is also
    read as "off" rather than "prune everything"

  This is a floor, **not** a replacement for `/cli-dispatch:clean`: the cap does no
  staleness detection, no takeover reaping and no age-based sweep.

- `__tests__/session-prune.test.mjs` — 14 tests, most of them pinning down the two
  dangerous failure modes (deleting a live session, losing a verdict) rather than the happy
  path. Includes a test that all five parsers actually call the prune, prune the session
  *root* rather than their own dir, and do it *after* `mkdirSync`. Suite: 465 → 479.

## [4.13.0] — 2026-08-01

Completes the pre-execution rollout over the read-only commands.

### Changed

- **The five per-backend `*-balance` commands now share `cli-dispatch-balance.sh`.** Same
  shape as 4.12.0's `*-status` collapse: a `--backend <slug>` flag limits the report to one
  backend's section, no flag prints the full five-section report unchanged. 15,401 → 3,977
  bytes (-74%). Unknown or missing slug exits 2 with a usage line.
  As with `*-status`, the per-backend text and *exit status* were never the aggregate's:
  `ds-balance` exits 1 when the config or key is missing where the aggregate prints
  `key: not set (skip)` and carries on, and `cx-balance` prints a snapshot line the
  aggregate omits. `--backend` preserves the per-command behaviour, verified by comparing
  both output and exit code against each old block.
  `ds-balance.md` keeps its native-Windows PowerShell block.

### Added

- `preexec-commands.test.mjs` gains a row per converted `*-balance` command, a test
  asserting each passes its correct `--backend` slug, and a test that `ds-balance.md` still
  carries a fenced PowerShell block but no fenced bash block. The shared forbidden-pattern
  loop gained an opt-in `stripFencedPowerShell` flag, used only by `ds-balance` — whose
  legitimate PowerShell block contains the very endpoint the bash extraction forbids.
  Suite: 443 → 465.

### Notes

- While verifying equivalence, the Antigravity section turned out to be **nondeterministic
  upstream**: the local language server returns `clientModelConfigs` in a different order on
  consecutive calls, so two runs of the *same* code produce differently-ordered model lists.
  This is pre-existing and unrelated to the refactor (confirmed by diffing the old block
  against itself); equivalence was therefore established on the sorted output. Worth knowing
  before anyone diffs a `balance` report and concludes something changed.

## [4.12.0] — 2026-08-01

### Changed

- **The five per-backend `*-status` commands now share `cli-dispatch-status.sh`.** The
  script gained a `--backend <slug>` flag (`deepseek`/`antigravity`/`codex`/`opencode`/
  `copilot`) that limits the report to one backend's section; with no flag it prints
  today's full five-backend report, unchanged. `ds-status`, `ag-status`, `cx-status`,
  `oc-status` and `cp-status` pre-execute it instead of embedding their own probes:
  9320 → 2808 bytes (-70%). The flag is deliberately not a second positional, so the
  existing `[pluginRoot]` argument contract is untouched. An unknown or missing slug exits
  2 with a usage line.
  Per-backend output is byte-identical to the five blocks it replaces, and the aggregate
  report is byte-identical to before — verified per command. Note the per-backend text was
  never the same as the aggregate's corresponding section (they differ in wording and in
  how much they probe); `--backend` preserves the *per-command* text, not the aggregate's.

### Added

- `preexec-commands.test.mjs` gains a row per converted `*-status` command plus a test
  asserting each passes its correct `--backend` slug. Suite: 422 → 443.

## [4.11.0] — 2026-08-01

Continues the pre-execution rollout. The six `sessions` commands turned out to be copies
of one another, so they collapse into a single parameterized script rather than six.

### Changed

- **The whole `sessions` family now pre-executes one script.** `sessions`, `ds-sessions`,
  `ag-sessions`, `cx-sessions`, `oc-sessions` and `cp-sessions` embedded the same node
  program six times over, differing only in a backend slug, the presence of the `backend`
  column, and two messages. They now all call `cli-dispatch-sessions.sh [backend]`: no
  argument gives the aggregate view, a backend slug gives the filtered one. Command
  markdown drops from 13,480 to 3,684 bytes (-73%), and the duplication is gone with it.
  An unknown backend argument exits 2 with a usage line. Output is byte-identical to the
  six blocks it replaces, verified per command.
- **`/cli-dispatch:help` pre-executes `cli-dispatch-help.sh`.** 3501 → 376 bytes (-89%);
  the file was almost entirely the reference box, which the model had been re-typing in
  full on every invocation.

### Fixed

- **The worktree leak post-check blamed the worker for the orchestrator's own edits.** The
  guard snapshots the guarded repo before the run and fails on any NEW entry afterwards —
  but a snapshot cannot attribute authorship, so editing the main repo while a run is in
  flight is indistinguishable from a worker resolving a path out of its worktree. The old
  message asserted the worker leaked, and the resulting exit 1 killed the run *before*
  `--verify` ever executed, discarding a perfectly good worker result over the caller's own
  edits. The failure now names both possible causes, states that the worker's output is
  intact in the worktree, and points at the new `CLI_DISPATCH_ALLOW_CONCURRENT_EDITS=1`
  opt-out, which downgrades the case to a warning so `--verify` still runs. Applied to all
  five `*-worktree-run.sh` runners, which carried a byte-identical copy of the block.

### Added

- `preexec-commands.test.mjs` gains rows for all seven newly converted commands plus a
  test asserting each per-backend `*-sessions` command passes its correct backend slug.
- `worktree-in-place.test.mjs` gains two tests per backend (ten total) covering the
  concurrent-edit opt-out and the reworded failure. Suite: 383 → 422.

## [4.10.0] — 2026-08-01

Spreads 4.9.0's pre-execution pattern to the three largest remaining read-only commands,
and fixes a regression that made 4.9.0's own pre-execution quietly lose data.

### Fixed

- **`${CLAUDE_PLUGIN_ROOT}` is interpolated into a `!` pre-execution line but is NOT
  exported into the subprocess.** `cli-dispatch-status.sh` read it as an environment
  variable, so its version-staleness check silently never fired for the whole of 4.9.0 —
  the report looked healthy while the installed wrappers were several versions behind.
  Both `status` and `doctor` now receive the plugin root as an argument (`$1`), falling
  back to the env var. `cli-dispatch-status.ps1` gained a matching `-PluginRoot` parameter.

### Changed

- **`/cli-dispatch:doctor`, `/cli-dispatch:balance` and `/cli-dispatch:clean-schedule` now
  pre-execute an extracted script** instead of embedding shell the model has to re-emit
  verbatim as a Bash tool call. Combined, their command markdown drops from 21,372 to
  4,979 bytes (-77%): `doctor` 9135 → 707, `balance` 6410 → 1280, `clean-schedule`
  5827 → 2992. The new `cli-dispatch-doctor.sh`, `cli-dispatch-balance.sh` and
  `cli-dispatch-clean-schedule.sh` run from the plugin cache and are **not** installed to
  `~/.local/bin` — same arrangement as `cli-dispatch-status.sh`, so they can never go
  stale relative to the plugin.
- **`clean-schedule` pre-executes a read-only `status` probe only.** It is the one
  converted command that mutates system state (a launchd plist, a crontab), and
  pre-execution runs before the model sees anything, so it has no opportunity to confirm.
  `install`/`uninstall` stay a deliberate step that forwards `$ARGUMENTS` to the same
  script. The script's own default action is `status` for the same reason — a bare run
  can never write a plist or rewrite a crontab. The command's documented default is still
  `install`; the markdown passes it explicitly. The script also picks launchd vs cron from
  `uname` instead of asking the model to choose the right block; the native-Windows
  Scheduled Tasks path stays inline in the markdown.

### Added

- `__tests__/preexec-commands.test.mjs` — table-driven guard over all four converted
  commands (23 tests): the `!` line exists and points at a script that exists, the shell
  has not leaked back into the markdown, each markdown stays under its size ceiling, each
  script passes `bash -n`, no API key VALUE is ever echoed, the plugin root travels as an
  argument, and `clean-schedule`'s pre-execution is a `status` probe that carries neither
  `install` nor `$ARGUMENTS`. Replaces `__tests__/status-command.test.mjs`, whose
  status-only assertions it subsumes.

## [4.9.0] — 2026-07-31

Stops making the model re-type `/cli-dispatch:status`'s shell. Pilot for a pattern the
read-only commands can all follow.

### Changed

- **`/cli-dispatch:status` now pre-executes an extracted script instead of embedding its
  shell in the command markdown.** The 100-line bash block moved to
  `scripts/cli-dispatch-status.sh`; `commands/status.md` invokes it through a `` !`…` ``
  pre-execution line and only says how to render the result.
  - The old shape cost twice per invocation: the shell entered the context as *input*
    (7615 bytes of command markdown), then the model re-emitted it verbatim as a Bash
    tool call — paying for the same 7 KB again in *output* tokens, which are the
    expensive ones. Pre-execution runs the script before the model sees anything, so the
    shell is never transcribed and the tool-call decision turn disappears too.
  - `status.md`: **7615 → 940 bytes (-88%)**. Output verified byte-identical to the
    embedded block's, mutation-checked in both directions.
  - The script runs from the plugin cache (`${CLAUDE_PLUGIN_ROOT}/scripts/`) and is
    **not** installed into `~/.local/bin` — the same arrangement
    `cli-dispatch-statusline.sh` already uses, which also sidesteps the install-staleness
    trap where `/plugin update` refreshes commands but never the installed wrappers.
  - Kept as bash rather than rewritten in Node on purpose: `status` is the command whose
    job includes reporting `node: MISSING`, so it must not need Node to run.
  - `cli-dispatch-status.ps1` ships alongside for native Windows (DeepSeek + Codex only,
    matching the previous PowerShell block), reached via the fallback note in the command.

### Fixed

- **The full test suite no longer hangs indefinitely under load.** `cp-stream-parse.test.mjs`'s
  reconcile helper waited a fixed 350ms for the parser's throttled `status.json` write, then
  overwrote it. When that write had not landed yet, `writeFileSync` threw `ENOENT` *inside a
  timer callback* — which could not reject the enclosing promise — so the `proc.stdin.end()`
  on the next line never ran and the parser waited on stdin forever. Observed live: a
  `cp-stream-parse.mjs` child sitting at 0% CPU for 10+ minutes while `node --test` blocked.
  The helper now polls for `status.json` (10s deadline) instead of sleeping, and ends stdin in
  a `finally` so a write failure fails loudly rather than hanging. Same class as the
  `cx-stream-parse` timing race fixed in 4.7.3; adding a 27th test file raised concurrency
  enough to tip this one. Previously misattributed to machine load — it was a real defect.

### Added

- **`__tests__/status-command.test.mjs`** (6 tests) — guards the markdown/script pair:
  the pre-execution line must point at the script, both platform twins must exist, the
  bash block must not creep back into the markdown, the markdown must stay under 2500
  bytes, the script must pass `bash -n`, and no backend's API key value may ever be
  echoed (only set/MISSING).

## [4.8.0] — 2026-07-29

Makes the safe cleanup behaviour the default one, and gives the statusline fragment its first test.

### Changed

- **`cli-dispatch-clean` now archives verdicts by default; `--no-preserve-verdicts` opts out.**
  Archiving used to sit behind `--preserve-verdicts`, so the destructive behaviour was what you
  got by forgetting a flag. For a session whose worktree is already gone, `verdict-diff.patch` is
  the *only* surviving record of the worker's changes — and the runner never commits, so that is
  the normal end state, not an edge case.
  - Measured on this machine: a sweep of 105 old session dirs, 7 of them carrying a patch, would
    have destroyed all 7. The complete archive is 128 KB; there was never a cost argument for the
    old default.
  - `--preserve-verdicts` still parses and still works — it now names the default rather than
    enabling it. Nothing in a cron entry or script breaks.
- **The summary line stops implying an archive attempt that never happened.** With archiving off
  it used to print `archived verdicts for 0 session(s)`, which reads as "we looked and found
  none". It now says archiving was disabled. The dry-run note likewise points at the opt-out
  instead of telling you to pass a flag that is already the default.
- The `/cli-dispatch:clean` slash command inlines its own copy of the cleaner logic, so it carries
  the identical change — otherwise the command and the installed binary would disagree about what
  a sweep destroys. Both READMEs updated.

### Tests

- **First test for `cli-dispatch-statusline.sh`** (`__tests__/statusline-fragment.test.mjs`, 14
  tests). It runs on every statusline refresh and had no coverage at all. Pinned: empty output
  when inactive (the combining wrapper depends on emptiness, not on a marker), `[CD]` when policy
  injection is enabled, `▶N` counting, terminal states excluded, and — the subtle one — that a
  `state: "running"` session whose `status.json` mtime is older than 90s is NOT counted, because a
  crashed worker keeps that state until a sweep and would otherwise pin a phantom counter forever.
  Mutation-checked independently: widening the staleness window fails 3 of the 14.
- Four new cleaner tests cover archive-by-default, the opt-out, `--preserve-verdicts` backward
  compatibility, and the summary wording.

## [4.7.4] — 2026-07-29

Closes the last way a run could report success without ever producing a verdict.

### Fixed

- **A `build-verdict` that printed nothing but exited 0 made the whole run exit 0.** The
  empty-output branch already existed — it writes an error-shaped `verdict.json` so downstream
  `JSON.parse` consumers don't crash — but it then trusted the helper's exit status. So a run with
  no verdict at all (no `state`, no `verify`, no `changedFiles`) reported success.
  - That combination was reachable until 4.7.3: `verdict-writer.mjs`'s entry-point guard silently
    no-opped when its path contained a symlink, and the runner puts its worktrees under `/tmp`,
    which is one on macOS. The guard is fixed, but the runner must not depend on a helper never
    failing that way.
  - Both the empty-output verdict's own `exitCode` field and the runner's exit status are now
    **5** — the contract's setup-error code — with a one-line diagnostic on stderr. When
    `build-verdict` does produce output, nothing changes: same exit status, same file, same
    cleanup.
  - Fixed in `cli-dispatch-run.ps1` identically; the twin had the same hole.
- The verdict-build tail of `cli-dispatch-run` is now a `build_and_write_verdict` function, called
  by the normal path and by the test hook alike, so the two cannot drift.

### Tests

- New integration scenario h): pins `CLI_DISPATCH_VERDICT_WRITER` to a stub that prints nothing
  and exits 0, then asserts the runner exits 5, `verdict.json` parses, carries `error`, and its
  `exitCode` is 5 rather than 0. Mutation-checked: restoring the old `exit "$BUILD_EXIT"` fails it.
- A `--_test-verdict-build <session-dir>` hook makes that reachable without launching a real
  worker CLI. It is an early-exit block next to the existing `--_test-cleanup` one, so the
  production path stays unconditional — a hook that can alter the normal flow is worse than the
  bug it tests for.

## [4.7.3] — 2026-07-29

Fixes a guard that made four scripts do nothing, silently, when invoked through a symlinked path.

### Fixed

- **`gain-report.mjs`, `verdict-writer.mjs`, `check-version-sync.mjs` and `policy-inject.mjs`
  ran their main function only when `process.argv[1]` happened to contain no symlinks.** The
  entry-point guard compared `import.meta.url` — which Node has already resolved — against the
  raw invocation path. When they differ the script exits 0 having printed nothing and done
  nothing: no error, no warning, no output.
  - macOS makes this reachable by default, because `/tmp` is a symlink to `/private/tmp`:
    `node /tmp/wt/…/gain-report.mjs` printed nothing while
    `node /private/tmp/wt/…/gain-report.mjs` printed the report.
  - `verdict-writer.mjs` is where it could have done damage. `cli-dispatch-run` creates its
    worktrees under `/tmp`, and `CLI_DISPATCH_VERDICT_WRITER` may point into one — a silent
    no-op there means `build-verdict` writes no verdict and `mark-worktree-removed` records
    nothing, while every exit code still reports success.
  - Each guard now resolves `process.argv[1]` with `realpathSync` before comparing, falling back
    to the raw path if that throws, so a non-existent path can never make the guard itself crash.
- **A fixed sleep in the cx-stream kill test was racing the status writer.** It slept 400ms for a
  200ms-throttled write, which held only while the suite was light; adding one more spawning test
  file made the kill land before the first flush and the test failed in the full suite while
  passing alone. It now polls for the artifact its assertions need, with a 10s ceiling.

### Tests

- New `__tests__/entrypoint-guard.test.mjs` (5 tests): symlinks the repo root into a temp dir and
  runs each of the four scripts through that path, asserting each actually produces its output —
  plus a source-level check that the raw `import.meta.url === pathToFileURL(process.argv[1]).href`
  comparison is gone. Mutation-checked: restoring the old guard in one file fails 2 of the 5.

## [4.7.2] — 2026-07-29

Promotes the report's most decision-relevant number out of a footnote.

### Added

- **`gain` prints an "Anthropic subagents vs workers" block**, right after the deterministic-runs
  line. The figure it leads with already existed — as the last line of a section labelled
  "historical", worded as an exclusion note (`other (non-runner) subagents: N agents, output X —
  excluded from ratio`). That number answers the question the whole report exists to answer: how
  much work went to an Anthropic model instead of a worker. On this machine it reads 36.1M output
  tokens against the workers' 108k.
  - The block reuses the exact values the footnote prints rather than recomputing them, and the
    footnote stays where it was. Everything else in the report is byte-identical — verified by
    diffing full output before and after.
  - Computing it earlier meant hoisting the subagent-transcript scan above the first `console.log`.
  - `ratio: n/a (workers reported no usage)` when worker output is zero, instead of dividing by it.
- **A retention caveat on that ratio.** The two sides are pruned differently: worker output comes
  from session dirs, which `cli-dispatch-clean` deletes, while the Anthropic side reads
  `~/.claude/projects`, which nothing here prunes. Sweeping 105 old sessions moved the ratio from
  ~28× to ~332× without any change in behaviour. Unlabelled, that reads as a trend; it is an
  artifact, and the line now says so.

## [4.7.1] — 2026-07-28

Fixes #133: `agy models` changed its output format, which made `ag-stream` warn about models
that were working fine and quietly pinned `--effort` to a hardcoded model family.

### Fixed

- **`ag-stream` no longer warns that a valid model is "not listed by `agy models`".** As of agy
  1.1.8 that command prints kebab-case slugs (`gemini-3.6-flash-high`); it used to print display
  names (`Gemini 3.6 Flash (High)`). `agy --model` still accepts **both** — only the listing
  changed — but validation was an exact-match `grep -qxF` against the listing, so every config
  written in the format this repo documented started printing a warning claiming agy had fallen
  back to its default. It had not: a session transcript confirms the requested model ran. The
  false alarm mattered because the warning is otherwise correct — agy really does fall back
  silently on a typo, so an alert people learn to ignore is worse than no alert.
- **`--effort` without `--model` stopped taking the hardcoded fallback.** The old code picked a
  model with `agy models | grep -m1 "($SUF)$"`. Slugs have no ` (High)` suffix, so that match
  never succeeded and every effort-only run silently used `Gemini 3.5 Flash (<effort>)`,
  regardless of what agy actually offered. This one changed which model ran, without saying so.
- Comparison is now done on a key that lowercases and drops every non-alphanumeric character,
  because the slug transform is **not** mechanical: agy keeps the dot in `gemini-3.5-flash-high`
  but turns Claude's into a dash in `claude-opus-4-6-thinking`. Four shell helpers carry it —
  `model_key`, `model_listed`, `apply_effort_suffix`, `pick_model_for_effort` — and they work in
  both directions, so a display-name config survives an agy upgrade and a slug config still
  validates against an older agy that lists display names. A genuine typo still warns.
- `apply_effort_suffix` preserves the caller's format: `--model gemini-3.6-flash --effort low`
  gives `gemini-3.6-flash-low`, while `--model "Gemini 3.6 Flash" --effort low` gives
  `"Gemini 3.6 Flash (Low)"`.
- An unusable `agy` (not installed, not signed in, empty listing) now suppresses the warning
  instead of reporting the model as unknown — that was a second false positive, aimed at exactly
  the person who has not finished setup yet.
- **The worktree scan is isolatable in tests (`CLI_DISPATCH_WT_SCAN_ROOTS`).** `GET
  /api/clean?worktrees=1`'s test pointed `TMPDIR` at a fixture, but `/tmp` is scanned
  unconditionally, so a real leftover worktree on the developer's machine — which a successful
  delegated run leaves behind **by design**, since the runner never commits — was counted with
  the fixtures and failed the test. The new env var replaces both default roots. Production
  behaviour is unchanged; nothing sets it outside the tests.

### Changed

- Docs and the config editor now present both model formats instead of asserting display-name
  only: the `install.sh` config skeleton comments, both `AG_MODEL`/`AG_MODELS` `<datalist>`s in
  the dashboard config editor (refreshed from live `agy models` output — they were listing a
  model generation that no longer leads the list), `commands/ag-run.md`, and the backend table in
  `skills/ds-delegate/SKILL.md`. `commands/ag-run.md` said in so many words *"not a loose slug
  like `gemini-3.5-flash`"*, which is now the opposite of the truth.
- Not touched, and verified so deliberately: `ag-transcript-parse.mjs` and its tests still scrape
  the **display name**, because that is what agy writes into its transcript regardless of how
  `agy models` prints (checked against a fresh session). `README.md` / `README.tr.md` only say
  *"list: `agy models`"*, which stays correct.

### Tests

- New `__tests__/ag-model-format.test.mjs` (15 tests) extracts the four helpers from the shipped
  `ag-stream` and runs them under real bash with a stubbed `agy`, so the assertions grade the
  script rather than a copy of it — the technique `ps1-bash-quoting.test.mjs` introduced. It
  covers both listing formats in both directions, the true-positive typo case, the empty-listing
  case, and pins that the old `grep -m1 "($SUF)$"` pattern is gone. Mutation-checked: weakening
  `model_key` fails 3 of them, dropping the empty-listing guard fails 1.
- A guard test rejects bash 4 case expansions (`${var,,}` / `${var^^}`) anywhere in `ag-stream`.
  macOS still ships `/bin/bash` 3.2 and no other script in this repo uses them; the helpers were
  re-run under 3.2 directly to confirm.
- A new dashboard test pins that `CLI_DISPATCH_WT_SCAN_ROOTS` **replaces** the default roots
  rather than adding to them, so the isolation cannot silently regress.

## [4.7.0] — 2026-07-26

Splits the dashboard's router — the one structural item deliberately left out of 4.3.0 and the
last open piece of #125.

### Changed

- **`dashboard-server.mjs`'s router is a route table instead of a 288-line `if`-chain.** Every
  request used to re-test every path string in order (`/api/clean` three times, `/api/config`
  twice), and two handlers — the config writer and the OpenRouter model fetch, ~120 lines
  together — sat inline in the middle of the dispatcher. Each handler is now a named function
  with a uniform `(req, res, params, url)` signature, and the table declares
  `{method, path | pattern, handler}`.
  - Route coverage is unchanged and was diffed row by row against the old chain: 11 exact paths,
    7 pattern routes, 3 vendor assets. The vendor rows are **generated from `VENDOR_FILES`**, so
    that allowlist stays the single source of truth for which static files exist.
  - The table is kept in the old chain's order. Order does not affect correctness — no two rows
    share a `(method, path)` — but it keeps the introducing diff reviewable.
  - Handler `params` are the RAW regex captures. Decoding and `okId()` validation stay inside
    the handlers, where they already were; the dispatcher was not given a chance to "helpfully"
    decode a path segment before the containment checks run.

- **Every route now has a method guard, and a wrong verb answers `405` with an `Allow` header.**
  This is a real behaviour change: `POST /api/sessions` used to run the GET handler and return
  200, because the old chain matched on path alone. Only three routes had ever been given a
  guard.
  - `405 {"error":"method not allowed","allow":"GET"}` — a path that exists under a different
    verb is not a 404, and the `Allow` header is the only way a caller learns which verb to use.
    Unknown paths keep the pre-existing `404 {"error":"no route"}` shape exactly.
  - **`HEAD` is served by the `GET` handler.** It worked before only because the old chain never
    looked at the method at all, so adding guards would otherwise have made `curl -I` a 405.
    Node suppresses the body for HEAD responses on its own.

### Tests

- 319 → 322, and one existing assertion updated: the diff route's POST rejection was pinned at
  `404` (the old fall-through) and is now `405` + `Allow: GET`.
- New coverage: 405 + `Allow` across GET-only, POST-only and GET+POST paths; the 404 shape for an
  unknown path (and that it carries no `Allow`); every table row answering its own verb; bad ids
  still failing closed on the pattern routes; and HEAD returning headers with an empty body.
- Mutation-verified: dropping HEAD support fails 1 test, removing the 405 branch fails 2.

## [4.6.0] — 2026-07-26

Closes the two items left open after 4.5.0: the `worktreeRemoved` field that could never be
true (#128), and the `.ps1` worktree runners no code path selected (#125).

### Fixed

- **`worktreeRemoved` in `verdict.json` was structurally always false (#128).** The SDD
  (`.specs/dev/sdd/deterministic-runner.md:217`) requires it to be true once
  `--cleanup-if-clean` removed the worktree, but `buildVerdict()` cannot know the answer: the
  verdict is written *before* cleanup runs, because it is the escalation artifact and has to
  exist even if cleanup dies. The only truthful place to set it is afterwards, so the runner now
  comes back and records the removal — from the one branch that has proved the directory is
  gone. New `verdict-writer.mjs mark-worktree-removed` subcommand, mirrored in the PowerShell
  twin (`Set-WorktreeRemovedInVerdict`).
  - **Fail-soft by contract:** at that point the work is done, the verify verdict is on disk and
    the worktree really is gone, so a bookkeeping write that does not land must never turn a
    finished run into a failed one. Every error path returns false; the CLI exits 0 regardless.
  - It writes **one boolean**. The `{schemaVersion, error, sessionId, exitCode}` shape
    `cli-dispatch-run` produces when `build-verdict` throws is left untouched — adding a lone
    `worktreeRemoved` there would dress a crash record up as a verdict that was never built.
    The guard keys on the *absence of* `state`, not on the presence of `error`, because `error`
    is also a legitimate `status.state`.
  - Writes go through temp + rename: the dashboard caches this file on `(mtime, size)` and reads
    it while runs finish, so it must never observe a half-written verdict.
  - The dashboard deliberately keeps using its **live** `worktreeExists` check rather than this
    recorded flag. A live answer beats a claim recorded at run end, and that is unchanged.
- **`cli-dispatch-run.ps1` broke on paths containing an apostrophe (#125).** The `bash -lc`
  launch line interpolated four values between bare single quotes, so `C:\Users\O'Brien\repo`
  — an ordinary Windows path — closed the quoting early and handed the remainder to bash as
  syntax: a broken run at best, an injection at worst. Every value now goes through
  `ConvertTo-BashSingleQuoted`. Verified by round-tripping apostrophes, spaces, `$`, backticks,
  backslashes, `;`, `&&`, newlines and the empty string through real bash, and by asserting the
  four values still arrive as exactly four argv entries.

### Changed

- **Workers list: the start time moved to the right edge of the row's metadata line.** It used to
  lead that line, which pushed the three tokens you actually scan down the rail — repo, live tool,
  token usage — right by a variable amount, because a locale timestamp is not fixed-width. Pinned
  right it forms its own column, and the left group gets the whole remaining width to ellipsis
  into (so a 260px rail truncates the repo name, never the time).
  - The line was extracted out of `loadList`'s inline row template into `workerMetaLineHtml` so
    the layout is testable at all: a grep for a CSS class is not an assertion about order. Three
    tests cover it — DOM order with `.when` last, no dangling ` · ` when tokens are absent, and
    escaping of a hostile `cwd`/`lastTool` — and the order assertion is mutation-verified.

### Removed

- **`ds-worktree-run.ps1` and `cx-worktree-run.ps1` (#125).** Nothing selected them:
  `cli-dispatch-run.ps1` hardcodes the `.sh` runner name and exits 5 without bash. What shipped
  was a second copy of the leak-guard logic that no code path could exercise — and 4.2.0 had
  already had to fix three cases of exactly that kind of silent `.ps1`/`.sh` drift. They are no
  longer installed by `install.ps1`.
  - **This is a real Windows behaviour change, not only a cleanup:** repo tasks (worktree runs)
    on Windows now require bash — WSL or Git Bash — which `cli-dispatch-run.ps1` already
    required anyway. `commands/ds-run.md` documented the `.ps1` as the native-Windows path, and
    that block is gone. Generation, sessions, watch, kill, gain and the dashboard stay native
    PowerShell and need no bash.
  - `install.ps1` also **removes** any copy an earlier version installed into `~/.local/bin`. An
    upgrade only overwrites what it ships, so without that sweep a machine keeps a runner on PATH
    that nothing selects and that no longer receives fixes.
  - `CLAUDE.md` now records `*-worktree-run.sh` as being outside the cross-platform pairing
    rule, so the next reader does not "restore parity" by re-adding them.

### Tests

- 305 → 319. `markWorktreeRemoved` (field flip with everything else byte-identical, idempotence,
  error-shape refusal, fail-soft on unreadable/unparseable/non-object input, CLI exit codes);
  three runner-level scenarios driving the real cleanup path (removed → recorded, kept →
  still false, missing verdict → run unaffected); and the first pwsh-driven test in the repo,
  which extracts `ConvertTo-BashSingleQuoted` **verbatim** from the shipped script so it cannot
  pass against a drifted copy, and skips where pwsh or bash is absent.
- Both new suites were mutation-verified: dropping the `record_worktree_removed` call fails
  exactly the one scenario that asserts it, and reverting the quoting helper to bare
  interpolation fails the round-trip test.
- The integration test now pins `CLI_DISPATCH_VERDICT_WRITER` to this checkout. It was resolving
  `~/.local/share/cli-dispatch/verdict-writer.mjs` — the last-*installed* engine — so it graded
  installed code instead of the code being changed. That bug surfaced as a genuine failure here.

### Notes

- The two remaining `#125` items were already resolved before this release and are verified, not
  re-done: `--base-ref` is gone from both runners, and the `policy-injection.md` fail-closed
  contradiction is corrected with `policy-inject.test.mjs` test 2b pinning it.

## [4.5.0] — 2026-07-26

Closes the four audit issues left open since 4.2.1 (#122 AU4, #123, #124, #125's decision-free half)
and adds a token-offload summary to the dashboard. Along the way it fixes a **2x error in the
headline savings number** — see Fixed.

### Added

- **Token offload on the Workers overview.** `Offloaded from Anthropic — 3.5M in / 785.5K out across
  120 worker sessions`, with the deterministic-runner subset called out separately (those carry zero
  Anthropic supervision by construction). Deliberately worded **offloaded**, not *saved*: which
  tokens did not hit the Anthropic account is measurable, whereas a saving is a counterfactual —
  nobody knows what an inline Claude would have spent on the same task, and the dashboard does not
  get to guess. Both caveats ride along with the number rather than being left implicit: how many
  sessions report no usage at all (so the total is a **floor**, not a total) and how many were
  counted from a mid-run snapshot.
- **`/cli-dispatch:gain` now reports deterministic runs** — count, verify outcome breakdown, worker
  tokens, and explicitly `Anthropic babysitter tokens: 0 (the runner is plain shell)`. Detected from
  `verdict.json`, which until now `gain` did not read at all. Resolves #122's `gain` half (AU4).
- **The leak post-check now guards all five backends** (#124). It answers one question — did the
  worker write OUTSIDE the tree it was given? — and only `ds-worktree-run.sh` asked it (11
  `GUARD_REPO` references; **0** in ag/cx/oc/cp). On the other four a worker that resolved an
  absolute path back out of its worktree did so silently. All five now carry the same
  `--post-check` mode, pre-run dirt snapshot (so only NEW dirt fails), and recovery-patch output.
  Covered by 20 new tests that run the real scripts against real repos, per backend.
- **`CLI_DISPATCH_AUTH_PROBE_TIMEOUT_MS`** overrides the 3-second auth-probe deadline. The ceiling
  is about machine load, not correctness: on a loaded machine a trivial probe can miss it and be
  reported `unknown` — honest, but it made a test flaky.

### Fixed

- 🔴 **The dashboard over-reported worker input tokens by ~2x.** Codex reports cache-INCLUSIVE
  `input_tokens` with `cached_input_tokens` as a subset — **88% of the total on real data**
  (3.38M of 3.82M). `gain` subtracts it (issue #99); the dashboard did not, so the same session
  files produced `6.8M in` in one surface and `3.5M in` in the other. Both now report
  `3,464,536 in / 785,496 out` exactly. The `cached <= input` guard is load-bearing rather than
  defensive: OpenCode reports `cached_input_tokens` as a **separate** counter that can exceed
  `input_tokens` (196k in / 300k cached on real data), where subtracting would yield a negative
  token count. Pinned by tests, including that negative case.
- **`gain`'s babysitting section said the opposite of the truth.** Its caveat described
  "non-pinned-model CLI-invoking subagents" as the excluded anomaly, when post-4.0.0 that is the
  **normal** case; the heading claimed to measure "runner subagents only" after those subagents had
  been retired. The section is now explicitly labelled LEGACY (pre-4.0.0) and says where today's
  runs are counted instead. `cli-dispatch-run` stays deliberately out of `RUNNER_RE` — it is the
  sanctioned path and spends no Anthropic tokens, so matching it would score the fix as the problem.
- **Cross-platform threshold semantics** (#123), with bash as canonical:
  - `cli-dispatch-clean.ps1` swept worktrees a full day earlier than bash. `find -mtime +N`
    truncates the age to whole 24-hour periods and then requires strictly more than N, so the real
    threshold is **N+1 whole days** — measured, not assumed: a 3.5-day-old directory is *not* swept
    by `+3`, a 4.0-day-old one is. The `.ps1` now mirrors that. Deleting someone's worktree a day
    early is the worse failure, so bash wins.
  - `cli-dispatch-clean.ps1` **crashed** on a non-numeric `--worktree-days` (`[int]"abc"` throws in
    PowerShell, taking the whole sweep with it). Bash silently falls back to the default; the `.ps1`
    now uses `TryParse` and does the same.
  - `cli-dispatch-wait.ps1` polled one extra interval past the requested deadline (`-gt` vs bash's
    `-ge`). At exactly `--timeout` seconds the wait is now over on both platforms.

### Changed

- **`--base-ref` removed from `cli-dispatch-run` and its `.ps1` twin** (#125). It was parsed and
  assigned on both platforms and **read nowhere** — the worktree runners compute their own base ref.
  A caller passing it now gets `unknown arg` and exit 5 instead of silently getting nothing, which
  is the honest outcome: the flag never worked.
- **`cli-dispatch-run-integration.test.mjs` converted to `node:test`** (#125). Its hand-rolled
  `main()` + `process.exit()` collapsed four scenarios into one reporting unit, so a failure told
  you the file broke, not which case. No correctness was lost by the old shape — `process.exit(1)`
  does surface as a failure under `node --test` — only observability.
- **`"subagent"` dropped from `marketplace.json`'s keywords** (#125) — the subagents it described
  were retired in 4.0.0.

Test suite 278 → 305.

## [4.4.0] — 2026-07-26

The ⚙ Configuration view answered "is this backend authenticated?" by asking "is there a key for it
in `~/.config/cli-dispatch/config`?" — which is the wrong question for three of the five backends.
`setup.md`, the comments `install.sh` writes into the generated config, and `README.md` all state
that Antigravity, Codex and Copilot normally sign in through their own CLI and have **no key in the
config at all**. So the view reported `○ not set` for backends that demonstrably work, and
`doctor.md` answered the same question with an unverified guess phrased as a pass ("using Google
sign-in"). `README.md` has meanwhile advertised per-backend "CLI auth ✓/✗" that only `gh` delivered.

### Added

- **Per-backend auth state in the ⚙ Configuration view.** Each backend group now leads with an
  `auth` line that combines both credential sources and never claims more than it knows:
  `✓ key in config` / `✓ logged in (ChatGPT)` / `✓ logged in (gh)` / `✗ not logged in` +
  the command that fixes it / `could not check` / `CLI not installed`. New
  `GET /api/backend-auth` — its own route rather than extra cost inside `/api/config`, since it
  spawns child processes and caches on a different clock (60 s TTL; ~590 ms cold, ~1 ms warm).
- **Real probes replace the guesses in `/cli-dispatch:doctor`** for all four backends that have a
  login: `codex login status` (a local read of `~/.codex/auth.json`, and it reports the *method* —
  a ChatGPT subscription and an API key bill differently), `gh auth token` for Copilot (the repo's
  own definition of "logged in", and unlike `gh auth status` it reads the keyring with **no network
  round-trip**, so it cannot stall the view offline), and `opencode auth list` for OpenCode.
- **Session history as evidence where no probe exists.** `agy` has no auth subcommand at all, and
  the repo's only existing Antigravity check spawns a real `agy -p "ping"` with a 35-second cap —
  far too slow for a config view. For Antigravity and DeepSeek the view says so plainly and adds
  the strongest cheap evidence available, which the session dirs already carry: the last successful
  run per backend and its count of `errorKind: 'auth'` failures.
- **The four credential env vars the view could not see** are now reported (presence only, never a
  value): `ANTIGRAVITY_API_KEY`, `OPENAI_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`. Every one is honoured
  by a wrapper but absent from `CONFIG_KEYS`, so a user authenticated through any of them still read
  as "not set".

### Security

- **No probe output ever leaves the server.** Each result is parsed into an enum plus a short method
  string inside `dashboard-server.mjs`; the client receives no account names, no emails and no token
  material. This matters most for Copilot: `gh auth token` *prints the token*, so it is
  length-checked and discarded, never stored, logged, or included in a response. A test asserts the
  payload contains no `gho_`/`sk-or-v1`/account identity even when every probe is made to emit them.
- **Probes cannot prompt.** Fixed argv (no shell), `stdin` closed, 3-second timeout, `SIGKILL` on
  expiry — so a login prompt can never sit waiting behind a dashboard request.
- **A probe that cannot run reports `unknown`, never `logged-out`.** "Could not check" and "not
  logged in" are different claims and only one of them is safe to assert; a timeout, a missing CLI
  and unrecognised output each get their own state. Pinned by tests.

### Fixed

- **`doctor.md` no longer reports a pass it did not verify.** The Antigravity, Codex and Copilot
  sections printed reassuring sign-in text purely because the key was absent. Codex and Copilot now
  probe for real; Antigravity reports the key honestly and falls back to run history; OpenCode's
  missing key is no longer treated as automatically fatal, since `opencode auth login` exists.
- **`codex login status` parsing bug caught by its own test:** `"Not logged in"` lower-cased still
  contains `"logged in"`, so the naive positive match reported a logged-out user as logged in. The
  negation is now tested first.

## [4.3.0] — 2026-07-25

Realigns the dashboard with the architecture 4.0.0 shipped. The dashboard had not been
meaningfully touched since 3.43.x — 4.0.0 changed two lines of `public-page.mjs` — so the
deterministic runner's entire output was invisible in it (`verdict`, `changed-files`,
`changedFiles`, `--verify` and `cli-dispatch-run` had **zero** occurrences across
`dashboard-server.mjs`, `public-page.mjs` and `dashboard-utils.mjs`) while a dead
"Babysitter cost" panel still occupied space. Closes the dashboard half of #122 (AU5).

### Added

- **`verdict.json` and `changed-files.json` are now first-class dashboard data.** New
  `readVerdict` / `readChangedFiles` / `clipLines` in `dashboard-utils.mjs`, mtime+size-gated
  through two new caches in `dashboard-server.mjs`. `/api/workers` rows gain `hasVerdict`,
  `verdictPending`, `changedFileCount`, `diffstat`, `hasDiff`, `usagePartial`, `errorKind`,
  `error`, and a compact `verdict` object (`exitCode`, `outcome`, `verify`, `verifyExit`,
  `stranded`, `branch`, `state`, `recordedAt`, `malformed`, `error`). `/api/worker/<id>/flow`
  gains the full verdict (verify commands, `failedAt`, output tail), the changed-file list with
  per-file git status and `preexistingDirty`, `worktreeExists`, `sourceRepo`, `branch`,
  `endedAt`, and a `diff` pointer. The size cap matters: `verdict-writer.mjs` caps a verify tail
  at 40 *lines* with no byte limit, so `clipLines` caps both — and unlike `clip()` it preserves
  line structure, which is the whole payload of a failing test report.
- **The worker row shows what a run actually did.** A `⚙RUN` marker when a verdict exists, a
  compact `verify ✓` / `verify ✗ e4` badge, and a second line carrying the verify result and the
  change size (`1 file +67`). A worker with no verdict renders exactly as before — the common
  case by far (107 of 120 session dirs on a real machine) — with no marker, no verify token and
  nothing red.
- **A worker's detail view now leads with its verdict**, in the slot the deleted babysitter panel
  occupied: an always-visible strip translating the runner's exit code into a sentence, then
  collapsible panels for the verify commands (marking commands after the failure as `not run`,
  because `runVerify` stops at the first one), the output tail, the changed files, and the run
  environment. All five preserve their open/closed state across live refreshes via `data-pk`
  snapshotting — the previous single-panel snapshot would have slammed four new panels shut every
  600 ms, regressing 3.15.2's flicker fix.
- **`GET /api/worker/<id>/diff`** serves `verdict-diff.patch` (else `diff.patch`) as
  `text/plain` with `nosniff`, capped at 512 KB via `readHead`, reporting the true size and
  truncation in response headers. It **recomputes** the candidate paths from `WORKERS_ROOT + id`
  and never reads `verdict.diffPatchPath`: that field is an absolute path out of a file five
  external worker CLIs write, so following it would be an arbitrary-file-read primitive gated
  only on "can write into a session dir". A test pins that.
- **A `verify-fail` filter chip.** Every verify failure has `state: "done"` and so hides inside
  the `done` chip; the lifecycle chips are structurally unable to express it.
- **A run summary on the Workers empty state**, derived client-side from the rows the list already
  fetched (no new endpoint, so it can never disagree with the chip counts):
  `runs 13 · verify ✓ 6 · ✗ 5 · none 2`, plus a pointer to ⚙ Maintenance when any run recorded
  uncommitted changes in a worktree.
- **A leftover-worktree listing** — new `GET /api/clean?worktrees=1` scans `/tmp` and `$TMPDIR` for
  `*-wt-*` artifacts and reports each one's backend, age, dirty/clean state and resolved source
  repo; surfaced behind a **Leftover worktrees** button in the ⚙ Maintenance panel, next to
  "Clean stale sessions". It is **read-only by design — there is no delete button**:
  `cli-dispatch-clean`'s sweep deliberately never removes a worktree with uncommitted changes
  (`commands/clean.md`), and a dirty worktree is exactly what a successful run leaves behind (the
  runner does not commit), so nothing automated will ever clean these and — until now — nothing
  reported them either. They could only be found by hand. The panel lists them with a copyable
  `git worktree remove` command per entry and leaves the decision to the human; a directory that
  merely *looks* like a worktree reports its state as unknown rather than clean, so it can never
  be mistaken for something safe to delete.
- **`public-page.test.mjs`** — the first test to ever cover the dashboard's 764-line client SPA.
  It compiles each inline `<script>` exactly as a browser would (CHANGELOG 3.15.2 credits such a
  test with catching a template-literal escape that broke the entire page, but none was ever
  committed), evaluates the SPA against a fake DOM to unit-test its pure functions, and pins the
  escaping rules with hostile fixtures. Verified non-vacuous by re-injecting 3.15.2's exact bug:
  the suite goes from green to 8 failures. It caught three real escaping mistakes while this
  release was being written.

### Changed

- **`killed` and `stale` are no longer reported as errors.** `workerBucket`'s catch-all sent the
  5th enum state `killed` to the `error` bucket — the identical bug the function's own comment
  records having already fixed once for `human-controlled` — and merged `stale` into `error`,
  making a stale worker unfindable except by hunting the error list. Both now have their own
  bucket, dot colour and filter chip; a worker that *died* gets a new red `.dead` dot while
  `killed` stays amber. The catch-all is now an explicit `unknown` bucket, so a 6th state added
  later surfaces as unknown instead of being libelled a failure. A table-driven test asserts every
  bucket the function can return has a chip and a dot.
- **A verify failure is presented on its own axis from the worker's state**, and the runner's
  exit code is spelled out and attributed (`runner exit 1 — worker finished (done), verify
  failed`) rather than printed as a bare number beside a state badge. Exit 124/126/127 are
  reported as a broken *harness* (`⚠ verify command not found`), not as a failure of the work.
  A run with `verify: null` reads `no verify requested` and never gets a green tick.
- **The worker row dropped `from <parent session>` and the standalone project line.** The former
  is babysitter-era provenance and was the single most expensive field on `/api/workers`; the
  latter rendered `tmp/ds-wt-oUSONx` for a run, i.e. the throwaway worktree rather than the repo.
  The parent-session linkage itself is unchanged and still shown in full — it simply moved to the
  detail route. **`/api/workers` is 4480 ms → 36 ms** on 120 real sessions as a result, and
  `linkedWorkers` stopped triggering the same scan for fields it discarded.
- **`normalizeBackend` moved to `parse-utils.mjs`** (re-exported from `verdict-writer.mjs`) so the
  dashboard can map the short/long backend spellings without importing a module its own header
  explains it must not statically depend on.

### Removed

- **Babysitter accounting, entirely** — the "Babysitter cost" panel, the 4× "high overhead" badge,
  `parentSession.babysitterUsage`, the never-read `parentSession.subagentId`, and the subagent
  scan that produced them. On the sanctioned post-4.0.0 path `babysitterUsage` was always `null`
  so the badge never fired; when it did fire it billed an unrelated subagent's entire token usage
  to the worker, because the match was a substring search for the worker id in transcript text.
  **The worker → parent-Claude-Code-session linkage and the `linkedWorkers` panel are NOT removed**
  — only the accounting bolted onto them.
- The removal takes the most expensive I/O in the server with it: a 4 MB `readTail` plus a
  `JSON.parse` of every line of every matching subagent transcript, on the SSE-refreshed
  `/api/workers` path, re-paid on every write to a live transcript. `dashboard-server.mjs` is
  1409 → ~1400 lines with the verdict feature added on top.

### Fixed

- **`POST /api/clean` performed an unauthenticated recursive delete.** It called
  `fs.rmSync(recursive, force)` on stale session dirs with no auth check at all, while
  `POST /api/config` on the same server correctly required the Origin + Host + custom-header gate.
  `readBody` ignores `Content-Type`, so any page the user had open could send `text/plain` (a
  CORS-simple type, no preflight) with `{"staleSecs":1}` — which matches every running worker
  quiet for a second — and delete its transcript, prompt and recovery diff. Now gated identically;
  `GET /api/clean` still only lists. The test asserts on the filesystem, not the status code.
- **`readBody`'s 64 KB cap bounded nothing.** Past the limit it rejected the promise but left the
  `data` handler attached, so the buffer kept growing for the rest of the request. It now destroys
  the request.
- **A mid-run token snapshot is no longer presented as a total.** `status.usagePartial` had zero
  occurrences in the dashboard, so a killed worker's snapshot rendered as `51.7k in / 0 out` — a
  specific wrong number, in a product whose selling point is token accounting. Partial counts are
  now labelled, and a zero output count is shown as `out not captured` rather than `0 out`.
- **An authentication failure is no longer shown as a generic red error.** `errorKind: 'auth'`
  means the worker never started, so nothing about the prompt, model or repo is at fault — and the
  flow it sent you to read has no steps in it. It now gets an amber `auth` badge and a panel
  pointing at `/cli-dispatch:doctor` and the ⚙ configuration view.
- **The open detail view would never have shown a verdict.** `watchDetail` unsubscribes the moment
  a worker reports `done` — which is *before* `cli-dispatch-run` runs verify (up to 600 s) and
  writes `verdict.json`. The predicate now also keeps the stream open while a verdict is pending,
  detected from the `verdict-diff.patch` marker the runner creates before verify starts.
- **`stranded` is no longer presented as a warning.** `.specs/dev/sdd/deterministic-runner.md`
  defines `stranded: true` as the *expected* value of a normal successful run — the runner never
  commits, so uncommitted changes mean the worker did its job — and 4 of the 9 stranded verdicts on
  a real machine had passed verify. The detail view states it as a recorded-at-run-end fact with
  its timestamp, and offers a cleanup command **only** when a live `stat` confirms the worktree
  still exists, resolving the parent repo from the worktree's own `.git` pointer (it is recorded
  nowhere in the session dir). When the worktree is gone it says so instead of telling you to
  remove a directory that is not there.
- **A malformed or corrupt `verdict.json` can no longer read as a pass.** `cli-dispatch-run` writes
  a `{schemaVersion, error, sessionId, exitCode}` shape when `build-verdict` throws, where
  `exitCode` is a *node exit status* rather than the 0-5 contract value; unparseable JSON and an
  unknown future `schemaVersion` are treated the same way. All three surface as `malformed` with
  outcome `unknown`, and one corrupt file cannot poison its neighbours in the response.
- **Docs corrected:** the dashboard was described as "read-only" in `dashboard-server.mjs`'s
  banner, its startup line, `commands/dashboard.md` and both READMEs, which was false on two
  counts — `POST /api/clean` deletes directories and `POST /api/config` writes API keys to disk.
  `CLAUDE.md`'s session-dir contract gained the `verdict.json` entry it never had (including both
  of its traps) and `changed-files.json`'s `preexistingDirty` field. `README.md:141` /
  `README.tr.md:141` no longer advertise the legacy cost badge this release deletes.

## [4.2.1] — 2026-07-25

Second batch of audit follow-ups: the findings that needed no design decision. The rest are
tracked in #122 (accounting semantics), #123 (cross-platform thresholds), #124 (guard
coverage), #125 (dead code).

### Fixed

- **Statusline `▶N` counted dead workers.** `cli-dispatch-statusline.sh` treated
  `state: running` as liveness, so a crashed worker pinned a phantom `▶1` until
  `cli-dispatch-clean` swept it — and could be the only reason the badge showed at all. It
  now applies the same staleness signal the rest of the repo uses (status.json mtime, 90s),
  with portable `stat` handling for BSD/macOS and GNU.
- **`install.ps1` left the API-key config world-readable.** `install.sh` protects it with
  `umask 077` + `chmod 600`; the PowerShell installer wrote it with a plain `Set-Content`.
  It now breaks ACL inheritance and grants FullControl to the current user only,
  best-effort (an ACL failure warns instead of aborting the install).
- **Stale `*-runner.md` references printed at runtime.** `oc-stream`/`cp-stream` pointed
  users at deleted files on every worker run, and `install.sh` advertised
  "zero-token polling for *-runner subagents" on every install. Also cleaned from
  `oc-agent`/`cp-agent` comments.

### Changed

- **`CLAUDE.md` inventory corrected** — it still claimed the plugin ships "subagent
  definitions" (deleted in 4.0.0) and omitted `hooks/`, `cli-dispatch-run`,
  `cli-dispatch-gain`, and `cli-dispatch-statusline.sh`. Since this file loads into every
  session, a wrong inventory leaks straight into agent behavior. The cross-platform pairing
  rule now also records the deliberate statusline exception and notes that parity is a
  *behavior* rule (4.2.0 fixed three silent `.ps1` drifts).
- **`TERMINAL.md`** now documents the backend-agnostic tools it omitted entirely —
  `cli-dispatch-run` (the delegation path) was not mentioned once.
- **`commands/setup.md`** — fixed a stale "question 4" reference (there are three) and the
  user-facing text that described the hook as firing only on new/resumed/cleared sessions
  (4.1.3 added `compact` and `fork`).
- **README uninstall step** (EN + TR) actually removes what the installer installs — it
  listed 2 of ~18 binaries while presenting itself as "a full cleanup".
- `.specs/dev/sdd/policy-injection.md` corrected: it claimed a missing `enabled` field
  defaults to `true`, while the implementation fails closed. The code is right; the spec
  was not.

### Added

- `policy-inject.test.mjs` test 2b — pins the fail-closed contract for a missing/non-boolean
  `enabled` field, previously untested (and asserted backwards by the spec above).

## [4.2.0] — 2026-07-25

Findings from a full read-only audit of the post-4.0 codebase. This release fixes the
correctness bugs; the remaining findings are tracked as issues.

### Fixed

- **`--resume` was completely unreachable on Windows.** `cli-dispatch-run.ps1`'s
  prompt-required check had no `$Resume` exemption, so `--resume <id>` died there (exit 5)
  and `--resume <id> --prompt …` died at the later "resume cannot take a prompt" guard —
  there was no third path. The bash twin was always correct
  (`[ -z "$RESUME" ] && [ -z "$PROMPT$PROMPT_FILE" ]`); the `.ps1` check now matches.
- **`git worktree add` failures were silently ignored in both PowerShell worktree runners.**
  `ds-`/`cx-worktree-run.ps1` discarded the exit code *and* the error output (`2>$null`),
  so a failed `add` fell through and the worker ran in a nonexistent/wrong directory — its
  work silently lost. Both now retry once with a fresh path (matching the bash twins) and
  hard-fail with a diagnostic if that also fails.
- **A crashed `run-verify` could be reported as a passing verify.** `verdict.json` is the
  escalation path's only data source, but the `run-verify` call sat under `set -e`, so a
  node-level crash killed the script before any verdict was written. The naive fix would
  have been worse: `build-verdict`'s `readJson()` swallows parse errors and returns `{}`,
  which maps to `exitCode: 0` — an unreadable verify file would have read as **success**.
  The runner now fails **closed**, synthesizing an explicit verify failure that says the
  result is unknown. `cli-dispatch-run.ps1` gained the matching empty-verdict fallback its
  bash twin already had.

### Added

- **`__tests__/cli-dispatch-run-verify.test.mjs`** — six end-to-end tests for the
  `--verify` → `verdict.json` wiring, previously uncovered (only the engine underneath was
  tested). Uses `--resume` as the seam, since re-attaching to a seeded session drives the
  real verify → verdict path without launching a worker. Includes a regression test for the
  fail-closed behavior above, verified by mutation (reverting the fix fails test 4).

## [4.1.3] — 2026-07-25

### Fixed

- **The injected delegation policy now survives auto-compaction and session forks** (#118).
  `hooks/hooks.json` wired `policy-inject.mjs` to only `startup`/`resume`/`clear`, so a long
  session's compaction silently dropped the `[cli-dispatch policy]` block from context —
  exactly in the highest-density window for delegation decisions — and `/fork`/`/branch`
  sessions started without it. The `compact` and `fork` `SessionStart` matchers are now
  wired too. No pile-up: compaction drops the previous copy and the hook injects a fresh
  one, netting one live copy per context. READMEs updated (the old "deliberately not
  compact" rationale is retired).

## [4.1.2] — 2026-07-25

### Fixed

- **`cli-dispatch-run.ps1` cleanup guard now canonicalizes paths via git** (carried over
  from PR #111). The `--cleanup-if-clean` belt compared paths resolved with .NET only —
  `GetFullPath` merely normalizes the string and `ResolveLinkTarget`/`.Target` chase only
  the LAST path component, so a symlinked *parent* directory (`/var` → `/private/var`, a
  junctioned drive root) still compared unequal and the guard could misjudge the caller's
  `--cwd`. The resolver now asks git first (`git -C <p> rev-parse --show-toplevel`, same
  spelling for both sides), falling back to the .NET steps. `cx-`/`ds-worktree-run.ps1`
  comments corrected to state what `Resolve-RealPath` actually guarantees (last-component
  links only — sufficient there because both compared values come from git itself).

### Changed

- `TERMINAL.md` refreshed (also from PR #111): scoped explicitly to the DeepSeek wrappers,
  legacy-path mentions trimmed, and the worktree description corrected (based on the
  repo's current state, not `origin/main`).

## [4.1.1] — 2026-07-24

### Changed

- **Docs refreshed and simplified.** `README.md`/`README.tr.md`: the five per-backend
  install paragraphs collapsed into one comparison table (CLI/auth/model-select), the
  worktree/sandbox explanation centralized under "Security and data", the `[CD]`
  statusline badge documented (new section + Features bullet), and `/cli-dispatch:run`
  / `wait` / `gain` added to the previously incomplete Usage table.
  `skills/ds-delegate/SKILL.md`: four near-identical backend sections merged into one
  "Other backends" section + differences table (−27% length, no information dropped);
  seven missing commands added to its Commands list. `help.md`: `/cli-dispatch:run` row
  relabeled from "Escalation:" to "Runner:", missing `wait` row added, one-line `[CD]`
  badge note appended.

### Fixed

- Broken pre-existing README anchor to the deterministic-runner section
  (`#deterministic-runner-clidispatchrun--no-llm-babysitter` →
  `#deterministic-runner-cli-dispatchrun--no-llm-babysitter`) — verified against the
  real `github-slugger` algorithm in both READMEs.

## [4.1.0] — 2026-07-24

### Added

- **Statusline badge (`[CD]`)** — new `scripts/cli-dispatch-statusline.sh`, a statusline
  *fragment* (same pattern as caveman's): a combining `~/.claude/hooks/statusline.sh`
  wrapper pipes the statusline stdin JSON to it and appends its output. Prints a cyan
  `[CD]` badge when cli-dispatch is active (policy injection enabled, or ≥1 worker
  running) plus a yellow `▶N` counter while N worker sessions are running; prints
  nothing when inactive. Reads only tiny `status.json` files (never
  `transcript.jsonl`) so it stays statusline-cheap. Wire-up is one glob line in the
  combining wrapper (documented in the script header); the fragment ships in the
  plugin cache, nothing extra is installed. Unix statusline setups only.

## [4.0.0] — 2026-07-24

### Removed

- **BREAKING: the five LLM babysitter runner subagents are retired** (#114) —
  `ds-runner`, `ag-runner`, `cx-runner`, `oc-runner`, `cp-runner` (`agents/*-runner.md`)
  are deleted. Measured across 604 runner agents on a real workstation, babysitter
  transcripts cost ~9x the workers' own output in Anthropic tokens (~7.1M babysitter
  output vs ~785k worker output), defeating the plugin's token-saving purpose — even
  with the model pinned to haiku. Delegation now has exactly two shapes:
  - **Mechanical work with a machine-checkable check** → the deterministic runner
    (`/cli-dispatch:run <backend> "<task>" --verify '<cmd>'`) — worker + worktree
    isolation + verify + `verdict.json`, zero Anthropic tokens.
  - **No verify command, or verify failed** → the *escalation path*: the orchestrator
    reads the compact verdict + diff itself and follows up with `/cli-dispatch:resume`.
    Cost is incurred only on failure/ambiguity, not on every run.
- The `runners` field is dropped from the `policy.json` skeleton written by
  `install.sh`/`install.ps1` and from `/cli-dispatch:setup`'s policy questions. Existing
  `policy.json` files keep working — `policy-inject.mjs` silently ignores a legacy
  `runners` array (back-compat, schemaVersion stays 1).

### Changed

- The injected session policy now teaches the escalation path ("read the verdict + diff
  yourself, follow up with `/cli-dispatch:resume`") instead of routing judgment-heavy
  work to runner subagents.
- Docs (`README.md`, `README.tr.md`, `CLAUDE.md`, `skills/ds-delegate/SKILL.md`,
  command references) rewritten around the deterministic runner + escalation model;
  the demo script's runner scene now shows `/cli-dispatch:run`.
- `/cli-dispatch:gain`'s Anthropic babysitting section still reports legacy runner
  sessions — accounting is unchanged so historical ratios stay visible.

## [3.44.0] — 2026-07-19

### Added

- **In-place worktree mode** (#108, #109). When `--cwd` is *already* a linked git
  worktree, the runner no longer opens a nested `/tmp/<backend>-wt-*` worktree — it
  runs the worker directly in the directory the caller handed it. Detection is
  `git-dir != git-common-dir`; a main checkout still gets the usual isolated
  worktree. `CLI_DISPATCH_NO_IN_PLACE=1` forces the legacy behaviour.
- **A working-directory contract is appended to every brief** (#109). Workers have
  reported "ruff check: all checks passed" after running the check in the tree they
  were *started* in rather than the tree they *edited*, linting untouched originals.
  Every brief now instructs the worker to `pwd` first, prefix every verification
  command with an explicit `cd <that directory> &&`, report the directory alongside
  each claimed result, and treat its own self-report as non-authoritative — only the
  caller's `--verify` chain is the gate. The caller's `--prompt-file` is never
  modified in place (a copy is written); `CLI_DISPATCH_NO_CWD_CONTRACT=1` opts out.

### Fixed

- **`--backend cx` (and `ag`/`oc`/`cp`) rejected a linked worktree as "Not a git
  repo"** (#107). A linked worktree's `.git` is a *file*, not a directory, so the
  `test -d "$REPO/.git"` probe failed before the job ever started. All five bash
  runners and both PowerShell twins now ask git — `git rev-parse
  --is-inside-work-tree` — which also handles submodules. (`ds` had been patched to
  `test -e` earlier; it now uses the same check as the rest.)
- **`--cwd <worktree>` false-failed with "worker leaked NEW changes outside the
  worktree" on every run** (#108). The worker, following the absolute paths in its
  brief, correctly wrote into the target worktree — and the post-check counted that
  as a leak and exited 1, making the exit code useless (4/4 runs in one reported
  session). In in-place mode the leak guard now watches the **main checkout**, never
  the directory the caller explicitly asked the worker to write to.
- **Cleanup can no longer touch the caller-provided `--cwd`** (#108). `--cleanup-if-clean`
  now checks two independent belts — the runner's own `>>> cli-dispatch: in-place=1`
  marker (the mode it actually took) and a resolved-path comparison against `--cwd` — and
  leaves the directory alone; the runner only removes worktrees it created itself.

### Security / robustness

- **An inherited `GIT_DIR`/`GIT_WORK_TREE` can no longer hijack repo detection.** Git
  hooks, `git rebase --exec`, and any parent git process export these, and they override
  `git -C <path>` — so every probe would describe the *inherited* repo. In the worst case
  a **main checkout** was detected as a linked worktree and the worker was handed the
  user's own checkout with zero isolation. All seven runners now clear `GIT_DIR`,
  `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` and
  `GIT_NAMESPACE` before their first git call.
- **Bare repos and `.git` admin directories are rejected instead of run in.**
  `git rev-parse --is-inside-work-tree` exits 0 while *printing* `false` for both; the
  gate now compares the output, not the exit status.
- **The main checkout is located with `git worktree list --porcelain`**, not
  `dirname(git-common-dir)` — the latter is wrong for `--separate-git-dir` layouts and
  worktrees of a bare repo, where it either silently disabled the leak guard or pointed it
  at an unrelated enclosing repo (which then snapshotted `$HOME` and failed every run).
- **The leak patch is written to the temp dir**, no longer next to the guarded repo — that
  parent is a directory the runner does not own (in in-place mode often the user's whole
  repos folder).
- **The in-place marker is printed on stderr**, the stream `cli-dispatch-run` actually
  captures (`2>&1 >/dev/null | tee`) — on stdout it was discarded, leaving the primary
  cleanup belt inert. The PowerShell runners use `[Console]::Error.WriteLine` for the same
  reason (`Write-Host` writes to the host stream and is not capturable at all).
- **`--post-check` was brought in line with the normal run**: same bare-repo/`.git` gate,
  same temp-dir patch location.
- In-place mode reports how many uncommitted changes the target worktree already had, so a
  reader can tell that `verdict-diff.patch` may include work the worker did not do.
- In-place mode now says so when `--branch` is supplied but ignored, and the PowerShell
  twins gained the `git < 2.31 --path-format` fallback, symlink/junction/8.3-aware path
  resolution (`Get-Item` instead of `[System.IO.Path]::GetFullPath`), and the bash twin's
  `--resume` + prompt rejection (previously `--resume` on Windows built a temp brief
  containing nothing but the contract).

### Documentation

- `/cli-dispatch:run` documents in-place mode and gains a "Writing a good `--verify`"
  section: worker self-reports are not a gate, and Python move/refactor delegations
  should include `ruff check --select F821 <target>` — body-move fidelity and import
  fidelity fail independently (#109).

### Internal

- New `__tests__/worktree-in-place.test.mjs` (17 cases): linked-worktree acceptance
  across all five backends, in-place worker cwd, target-write-is-not-a-leak,
  main-checkout leak still caught, worktree list untouched, legacy path preserved,
  both env escape hatches, the two cleanup guards, `GIT_DIR` hijack, bare-repo and
  `.git`-dir rejection, patch-file location, and `--prompt-file` immutability. Verified
  to fail (10/17) against the pre-fix scripts. One case asserts the in-place marker
  survives `cli-dispatch-run`'s capture — the defect that would otherwise have shipped.

## [3.43.5] — 2026-07-17

### Fixed

- **`gain`'s babysitter/worker ratio no longer overstates cost.** The numerator
  previously summed the output of *every* Anthropic model that appeared in a
  CLI-invoking subagent transcript, so it folded in main-loop `/cli-dispatch:run`
  invocations and forbidden model overrides (sonnet-5/opus/…) alongside the only
  sanctioned runner model (haiku), and it still counted babysitting for backends
  whose worker sessions report no usage at all (antigravity). On a real machine
  this printed a ~2500% ratio; the corrected numerator — pinned-haiku runners on
  non-blind backends only — reports ~370%. Excluded output is now surfaced on its
  own line so the number is auditable.
- **The `polling instead of cli-dispatch-wait?` line was a false alarm.** It fired
  when a runner exceeded 20 *assistant turns*, but a runner is a babysitter **and**
  reviewer — dispatch, a single blocking `cli-dispatch-wait` (one turn), diff
  verification, test runs, worker iteration, and reporting easily exceed 20 turns
  with no hot-loop at all. It now counts only runners that read a session
  `status.json` **directly** more than 5 times (a real poll that `cli-dispatch-wait`
  would have avoided); `cli-dispatch-wait` invocations are never counted.

### Internal

- `gain-report.mjs` split into import-safe pure helpers (`isStatusPollCommand`,
  `backendFromCommand`, `analyzeAgentEvents`, `computeBabysitRatio`) behind a
  main-module guard, covered by a new `__tests__/gain-report.test.mjs` (12 cases).

## [3.43.4] — 2026-07-13

### Changed

- **Delegation policy now routes by task shape instead of defaulting every
  delegation to an LLM babysitter.** The SessionStart policy injection
  (`policy-inject.mjs`) leads with the deterministic path: mechanical work with
  a machine-checkable check should go to `/cli-dispatch:run <backend> "<task>"
  --verify '<cmd>'` (zero LLM babysitter tokens), trivial single-file fixes stay
  inline, and the LLM `*-runner` subagents are reserved for judgment-heavy work
  (ambiguous scope, output no command can verify). Rationale: `/cli-dispatch:gain`
  showed babysitting overhead dominating on small-grained delegations — the
  deterministic runner already existed (3.38.0) but the policy defaulted past it.
  No behavior change to the runners themselves; this is a routing/guidance
  update to the injected context.

## [3.43.3] — 2026-07-12

### Fixed

- **Mid-run human-takeover of a Copilot worker no longer fails with a 500.**
  `buildTakeoverCommand` required `meta.threadId` for copilot, but the GitHub
  Copilot CLI emits its resume `sessionId` only in the final `result` event —
  so for the entire duration of a *running* worker `meta.threadId` is empty,
  which is exactly when takeover happens. `buildCopilot` now falls back to
  `copilot --continue` (resume the most recent session) when `threadId` is
  missing/empty, and keeps `copilot --resume <id>` when it is known (e.g. a
  finished session). The `meta.cwd` requirement is unchanged. Race caveat:
  `--continue` targets the globally-most-recent copilot session, which could be
  wrong if another copilot session starts between metadata capture and takeover
  — acceptable for a single-user local dashboard. The other four backends were
  unaffected (they surface their session id at start). Surfaced by a
  multi-backend takeover test pass.

## [3.43.2] — 2026-07-12

### Fixed

- **Dashboard live list now reflects worker state transitions inside an
  existing session dir without a manual page reload.** The live list SSE
  (`/api/stream?watch=sessions`) watches `WORKERS_ROOT` shallowly, so a new
  worker dir fired it but a `status.json` write *inside* an existing dir
  (running → `human-controlled` on takeover, or running → `done`) did not —
  the badge/filter stayed stale until reload. Fix: on a state transition only,
  `parse-utils.mjs` bumps a `<WORKERS_ROOT>/.cli-dispatch-transitions` sentinel
  (a direct child of the watched root), which the existing shallow watch sees.
  Wired into `createStatusWriter` (fires only when `status.state` changes, not
  on every ~200 ms running flush) and into `markTakeoverActive` /
  `clearTakeoverState` (the takeover transitions the dashboard triggers
  directly). Deliberately not a recursive watch — that would fire on every
  `transcript.jsonl` append across hundreds of session dirs, regressing the
  repo's transcript-hot-loop cost model. `listWorkers()` already skips
  non-directory entries, so the sentinel never surfaces as a bogus worker.

## [3.43.1] — 2026-07-12

### Changed

- **Example model IDs across config templates and docs live-verified against
  installed worker CLIs and provider docs, and refreshed where stale.**
  Antigravity (`agy models` live output) and DeepSeek
  (api-docs.deepseek.com) examples were checked and found already accurate —
  no changes needed for those two backends.
- **Codex:** `~/.codex/models_cache.json` (live catalog pulled from Codex's
  own API) now surfaces a new `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`
  family ranked above `gpt-5.5`; `gpt-5.2` and `gpt-5.3-codex` have dropped
  out of the catalog entirely. Updated the `CX_MODEL` example comment in
  `scripts/install.sh` and `scripts/install.ps1`, the model list paragraph in
  `commands/cx-run.md`, the "Model selection" block in
  `skills/ds-delegate/SKILL.md`, `README.md`, and the dashboard's
  `dl_CX_MODEL` / `dl_CX_MODELS` datalists in `scripts/public-page.mjs`
  (three new options added).
- **OpenCode:** live `opencode models openrouter` (343 models) confirms
  `google/gemma-4-31b-it:free` is still valid, but `deepseek/deepseek-v4:free`
  and `meta-llama/llama-4.1-8b-instruct:free` are no longer in the catalog.
  Replaced both stale examples in `commands/oc-run.md` with
  `meta-llama/llama-3.3-70b-instruct:free` and `qwen/qwen3-coder:free`.
- **GitHub Copilot:** `copilot --help` confirms `gpt-5.4` and `auto`;
  `gpt-5.2` could not be verified. Changed the `CP_MODEL` example in
  `scripts/install.sh` from `gpt-5.2` to `gpt-5.4`, and removed `gpt-5.2`
  entirely from the `dl_CP_MODEL` / `dl_CP_MODELS` datalists in
  `scripts/public-page.mjs`.

## [3.43.0] — 2026-07-12

### Added

- **Per-session policy injection (opt-in, off by default).** A new plugin
  `SessionStart` hook (`hooks/hooks.json` → `scripts/policy-inject.mjs`, plain
  `node` — deliberately no bash/`.ps1` twin since the hook `command` field
  cannot branch per-platform) injects a compact (~60-word) cli-dispatch
  delegation policy into every new/resumed/cleared session via
  `hookSpecificOutput.additionalContext`. The `compact` matcher is deliberately
  excluded so long sessions don't accumulate repeated injections. Preferences
  live in `~/.config/cli-dispatch/policy.json` (`enabled`, `runners`,
  `issueReminder`, `claudeMdBlock`, `schemaVersion`); missing/corrupt file,
  `enabled:false`, or a future `schemaVersion` → silent no-op (empty stdout,
  exit 0 — session start is never blocked). `runners` values are whitelisted
  against the five known runner names; unknown strings are silently dropped and
  never interpolated into context. Covered by
  `__tests__/policy-inject.test.mjs` (12 tests, incl. subprocess integration).
- **`/cli-dispatch:setup` step 7 now configures the policy** with four
  preference questions (enable injection / runner priority / issue reminder /
  static CLAUDE.md block), writes `policy.json` idempotently, and migrates the
  legacy `<!-- cli-dispatch:orchestration-priority -->` CLAUDE.md marker to
  `<!-- cli-dispatch:policy:v1 -->` in place (find-and-replace, never delete).
  Enabling both the hook and the CLAUDE.md block triggers a double-injection
  warning; `/cli-dispatch:doctor` gained a `── Policy injection ──` section that
  reports `policy.json` state, plugin-package `hooks/hooks.json` presence
  (cache-staleness signal), and after-the-fact double-injection.
- **Installer: `--policy-injection <on|off>` / `-PolicyInjection` and
  `--non-interactive` / `-NonInteractive` flags.** `on` writes a `policy.json`
  skeleton (never clobbers an existing one) with `runners` derived from the
  selected backends. The config skeleton was refactored into per-backend blocks
  with idempotent missing-line appends (`ensure_config_block` /
  `Ensure-ConfigBlock`, keyed on the `^KEY=` line itself — existing lines,
  filled or empty, are never touched; covered by
  `__tests__/install-config-block.test.mjs`, 7 tests). The editor auto-open
  trigger changed from "DeepSeek/OpenCode selected + key empty" to "config
  created or a block was appended, AND the install is interactive" (explicit
  flag or TTY detection) — no GUI opener found means instructions are printed
  instead of launching a TUI editor that would hang a non-TTY run.

## [3.42.0] — 2026-07-11

### Added

- **`/cli-dispatch:clean` now sweeps stale worktree leftovers.** cli-dispatch
  worktrees (`ds-wt-*`, `ag-wt-*`, `cx-wt-*`, `oc-wt-*`, `cp-wt-*`) abandoned
  under `/tmp`/`$TMPDIR` (`$env:TEMP` on Windows) are removed once older than
  a threshold (`--worktree-days N`, default 3; `--skip-worktrees` opts out).
  Dirty worktrees (uncommitted changes) are never deleted — they are reported
  and skipped, as are broken/non-git `*-wt-*` dirs. After deletion the source
  repo (resolved from the worktree's `.git` gitdir pointer) gets a best-effort
  `git worktree prune`. Implemented in `cli-dispatch-clean`, its `.ps1` twin,
  and both fenced blocks of `commands/clean.md`; `git` is probed defensively
  for minimal-PATH launchd/cron/Scheduled-Task runs.
- **Integration tests for `/cli-dispatch:kill`'s bash block**
  (`__tests__/kill-flow.test.mjs`, 8 tests). The fenced bash is extracted from
  `kill.md` and exercised against real throwaway process trees in a fake
  session dir: worker.pid tree-kill, terminal-state guard (`done`/
  `human-controlled` skipped), no clobber of a parser-written terminal
  `error`, legacy `pgrep` fallback, and bad-input errors.

### Fixed

- **`oc-stream` no longer reports `exitCode: 0` for a real nonzero exit when
  the parser flagged `state: error`** — same fix `cx-stream` got in 3.41.0:
  reconcile is still skipped (the parser's specific error message wins), but
  `meta.json`'s `exitCode` is now patched with OpenCode's real exit code.
- **`ag-stream`'s preflight/auth block no longer references a broken
  `$SCRIPT_DIR/parse-utils.mjs` path.** In a real install the script lives in
  `~/.local/bin` while `parse-utils.mjs` lives in
  `~/.local/share/cli-dispatch/` — the legacy references now use the robust
  `PARSE_UTILS` resolution added in 3.41.0.
- **Windows watchdog/kill PID resolution is now deterministic**
  (`claude-ds-stream.ps1`, `cx-stream.ps1`). The `Win32_Process` command-line
  substring scan is scoped to direct children of the wrapper's own `$PID`,
  yielding a single precise worker PID; the old system-wide scan remains only
  as a last-resort fallback. The streaming launch pipeline and the
  `worker.pid` contract (wrapper tree-root PID) are untouched.
- **Windows `changed-files.json` no longer credits/blames a worker for
  pre-existing dirt** (`claude-ds-stream.ps1`, `cx-stream.ps1`) — parity with
  3.41.0's bash fix: dirty/untracked paths are snapshotted before launch,
  excluded from `files`, and recorded under `preexistingDirty`; `diff.patch`
  still carries the full working-tree diff.
- **The test suite is now cwd-independent.** Six test files
  (`ag-transcript-parse`, `cp/cx/ds/oc-stream-parse`, `check-version-sync`)
  resolved fixtures/parsers relative to `process.cwd()`, so running
  `node --test` from `plugins/cli-dispatch/scripts/` failed ~20 tests and
  littered a junk `scripts/plugins/...` tree. Paths are now
  `import.meta.url`-based and temp dirs use `os.tmpdir()` + `mkdtemp`; the
  suite is green from any cwd and writes nothing into the repo.
- **Dashboard module-level caches are now bounded** (`dashboard-server.mjs`):
  `parentIndexCache`, `subagentCache`, and `sessionTailCache` share a
  500-entry cap with oldest-insertion eviction — no behavior change, just no
  more unbounded growth.

## [3.41.0] — 2026-07-11

### Fixed

- **`/cli-dispatch:kill` now kills the real worker via `worker.pid` tree-kill.**
  The command matched processes with `pgrep -f "$SID"`, but oc/cp/ag workers
  never carry the session id in their argv — so no signal was ever sent while
  a fake `killed` landed in `status.json` and the live worker kept burning
  tokens (and could later clobber the record). `kill.md` now reads
  `$DIR/worker.pid` (written by every `*-stream` wrapper for exactly this),
  TERM→KILLs the whole snapshotted process tree (same pattern as
  `stream-utils.sh`'s takeover kill), falls back to the old `pgrep` path —
  now also tree-killing — for legacy sessions, and only forces
  `state: killed` if the status is still non-terminal, so a parser-written
  terminal `error`/`done` is never overwritten.
- **`cp-stream` cleanup no longer orphans the native Copilot binary.** The
  interrupt path killed only the node wrapper PID with a single `kill -TERM`;
  the `copilot-darwin-arm64` child reparented to init and ran forever.
  `cleanup()` now uses `stream-utils.sh`'s tree-kill like every other
  backend wrapper.
- **Copilot CLI 1.0.70 streamed text is no longer dropped.**
  `cp-stream-parse.mjs`'s `textFrom()` didn't recognize the `deltaContent`
  field that `assistant.message_delta` events carry text in, so live output
  never reached `finalText`/`progress.log` — a killed session lost its entire
  answer. Deltas now accumulate through the existing `handleText` path, and
  a final `assistant.message` overwrites rather than appends, so nothing is
  double-counted. Covered by new unit tests using the real 1.0.70 event
  shape (with and without a final message).
- **Parser `finalize()` no longer clobbers a reconciled terminal state — all
  five backends.** After a kill/timeout, the wrapper's
  `reconcile_session_error` correctly wrote `state:"error"`, but the parser's
  async stdin-EOF finalize then overwrote it with `done`/`exitCode:0`.
  `finalize()` now reads the on-disk `status.json` first and defers to an
  already-terminal `error`/`killed` record (using `TERMINAL_STATES` from
  `parse-utils.mjs`), preserving the reconciled `exitCode`. Applied to
  `ds-`, `cx-`, `oc-`, `cp-stream-parse.mjs` and `ag-transcript-parse.mjs`.
- **`cx-stream` records the real worker exit code on error.** When the parser
  had already recorded `state:"error"` (e.g. invalid model), the wrapper's
  reconcile block skipped entirely — leaving `exitCode: 0` in `meta.json`
  despite codex exiting 1. The error branch now patches `meta.exitCode` with
  the real `$CODEX_RC` while keeping the parser's more specific error text.
  Synced to `cx-stream.ps1`. (`oc-stream` has the same pattern — flagged as
  a follow-up, not changed here.)
- **`*-worktree-run.sh` no longer exits 127 without an installed PATH.** All
  five scripts invoked their sibling `*-stream` as a bare PATH call; they now
  use the same `command -v X || X="$SCRIPT_DIR/X"` fallback the `*-agent`
  wrappers already had. `ds-worktree-run.ps1`/`cx-worktree-run.ps1` twins
  synced with the pwsh-idiomatic equivalent.
- **Antigravity conversation-id discovery can no longer hijack a parallel
  run's session.** `discover_cid` picked the conversation from the shared
  `last_conversations.json` cwd key after launch — two same-cwd parallel
  runs could attach to each other's conversation, leaving one conversation
  with no session dir at all. Discovery now snapshots the pre-launch
  conversation-id set, considers only new ids, and attaches solely to the
  conversation whose first `USER_INPUT` (`<USER_REQUEST>` block) matches this
  run's own prompt (pure matching helpers added to `parse-utils.mjs`, unit
  tested). If no candidate verifies, the run fails loudly with
  `state:"error"` instead of silently mis-attaching.
- **`changed-files.json` no longer blames pre-existing dirty files on the
  worker.** Every `*-stream` wrapper now snapshots `git status --porcelain`
  before launch; `write_diff_artifacts` excludes those paths from `files`
  and records them under a new informational `preexistingDirty` field.
  `diff.patch` is unchanged, and runs in clean repos still produce
  `"preexistingDirty": []` (backward compatible).

## [3.40.2] — 2026-07-11

### Changed

- **Dashboard header simplified.** The "· read-only by default · opt-in
  takeover" tagline is gone, and the "Clean stale sessions" trigger moved
  out of the header into the config view (⚙) alongside the rest of the
  session-maintenance controls. The header now surfaces only what changes
  moment to moment — the title, the active-worker count, and the
  theme/config buttons — leaving static explainer text and one-off actions
  to the config panel instead of competing for space on every page load.

## [3.40.1] — 2026-07-11

### Fixed

- **Takeover heartbeat timer now stops itself once the guard fires.** 3.39.4
  guarded `touchTakeoverHeartbeat` against resurrecting a reaped takeover
  (skip the write + one stderr note when the freshly-read state is no longer
  `human-controlled` with `takeover.active`), but `dashboard-server.mjs`'s
  30-second PTY-bridge heartbeat timer kept firing forever in that no-op
  state — spamming stderr every 30s for as long as the browser tab stayed
  connected after an out-of-process reap. The bridge now inspects the status
  returned by each heartbeat call and, when the guard has fired, clears its
  own interval (swap-safe: it only nulls `entry.heartbeatTimer` if it still
  owns it, matching the existing teardown pattern). Socket teardown still
  arrives via its natural close/exit path.

### Changed

- **`listSessions` no longer re-reads every Claude Code transcript tail on
  each `/api/sessions` request.** The per-`.jsonl` head/tail read and
  tail-parse (including model extraction) in `dashboard-server.mjs` is now
  behind the same mtime-gated module-level cache pattern
  `buildWorkerParentIndex` already uses — unchanged files reuse the previous
  parse result; live-status, size, and subagent counts stay fresh every call.
  Response shape and ordering are unchanged; only repeat file I/O drops.
- **State-set membership check in `findStaleSessions` migrated to the shared
  enum.** The hardcoded `state === 'running' || state === 'human-controlled'`
  check now uses `NON_TERMINAL_STATES.has(state)` from `parse-utils.mjs`, per
  the repo contract. Deliberately single-state checks (the `running`-only
  stale heuristic, the takeover `running` precondition) were left as-is —
  their semantics are not "non-terminal".

## [3.40.0] — 2026-07-11

### Removed

- **`/cli-dispatch:gain --log` history logging.** The `--log` flag (and its
  `GAIN_LOG` env var equivalent) used to append a timestamped JSON snapshot of
  each report to `~/.cache/cli-dispatch/gain-history.jsonl`, so runs could be
  compared over time even after `/cli-dispatch:clean` deleted old session
  dirs. That history mechanism — the flag, the env var, and the
  `gain-history.jsonl` writer in `gain-report.mjs` — is removed;
  `commands/gain.md` no longer documents it. The live `/cli-dispatch:gain`
  report itself (worker token totals by backend + Anthropic babysitting
  accounting) is unchanged; an unrecognized `--log` argument is now silently
  ignored rather than crashing, consistent with the script's existing
  permissive arg handling.

## [3.39.4] — 2026-07-11

### Fixed

- **Heartbeat can no longer resurrect a reaped takeover session (AU7).**
  `parse-utils.mjs`'s `touchTakeoverHeartbeat` (called every 30s by
  `dashboard-server.mjs`'s PTY bridge) used to write status.json back whenever a
  `takeover` sub-object was present in its in-memory copy — so if
  `cli-dispatch-clean` reaped a stale takeover (killing the PTY and transitioning
  the session to `error`) between the heartbeat's read and write, the heartbeat
  would rewrite the dead session back to `human-controlled`. The guard is now
  re-checked immediately before the write: unless the freshly-read state is still
  `human-controlled` with `takeover.active === true`, the heartbeat skips the
  write entirely (one-line stderr note, no lock — per the human-takeover SDD's
  no-lock stance the sub-millisecond TOCTOU window remains, but the common
  stale-read-then-write revival path is closed). Covered by a new
  reap-then-heartbeat no-op scenario in `takeover-integration.test.mjs`.
- **`Find-WorkerPid` multi-match guard (`claude-ds-stream.ps1`).** The
  interrupt/exit-path worker lookup fed `Kill-WorkerTree` from an unguarded WMI
  `Win32_Process` command-line substring match, taking the first hit — with more
  than one matching process it could kill the wrong tree. It now applies the same
  AU5 pattern the watchdogs got in 3.39.2: matches are collected into an array,
  and on multiple hits the kill is skipped with a stderr warning (single match
  unchanged, zero matches unchanged). `cx-stream.ps1` was audited for an
  equivalent: its only `Win32_Process` lookup (watchdog job) already carries the
  AU5 guard and there is no separate `Find-WorkerPid` — no change needed.

### Changed

- **Atomic full-file JSON writes in `parse-utils.mjs` (temp + rename).**
  `createStatusWriter.flush`, `writeMetaFile`, and the internal `writeJsonFile`
  (used by the takeover state helpers) previously wrote with a direct
  `writeFileSync`, so readers polling status.json/meta.json could observe a
  half-written file (guarded readers didn't crash, but saw stale/empty data).
  All three now route through an internal `atomicWriteFileSync`: write to a
  same-directory `<target>.tmp-<pid>` sibling, then `renameSync` over the target.
  If the rename fails (notably Windows EPERM/EACCES while the target is open —
  DeepSeek/Codex parsers run natively on Windows) it falls back to the previous
  direct write, preserving the existing stderr warning path; temp files are
  best-effort removed in every path. `createStatusWriter`'s ~200ms throttle
  semantics and return shape are unchanged.

## [3.39.3] — 2026-07-11

### Changed

- **Dead export cleanup (AU8, behavior-preserving refactor).** `parse-utils.mjs`'s
  `writeJsonFile`, `verdict-writer.mjs`'s `readJson`, `check-version-sync.mjs`'s
  `defaultVersionSyncPaths`/`runVersionSyncCli`, and `takeover-cmd.mjs`'s
  `loadConfigDefaults` were exported but had no importers anywhere in the repo (static or
  dynamic) — re-verified before removal. Each stays a private, file-local function; no
  behavior change. `parse-utils.mjs`'s `isNonTerminalState()` is exported but also
  unreferenced — it was deliberately kept, since it's documented in `CLAUDE.md` as part of
  the session-state public API contract.
- **`.ps1` version-staleness check deduplicated (AU9).** `cli-dispatch-dashboard.ps1`,
  `ds-agent.ps1`, and `cx-agent.ps1` each carried their own ~40-line copy of the
  installed-vs-cached-plugin-version check (the 3.39.2 entry above notes this duplication
  was accepted at the time). Extracted into a new shared `version-check.ps1` module — the
  `.ps1` mirror of the existing `version-check.sh` — that all three now dot-source from
  next to themselves; `install.ps1` copies it into `~/.local/bin` alongside its
  consumers. Semantics are unchanged, including the strict `^\d+\.\d+\.\d+$` version-folder
  match (intentionally not aligned to bash's looser glob — that would be a behavior
  change, out of scope here).

## [3.39.2] — 2026-07-11

### Fixed

- **`version-check.sh` was never installed (AU3).** All five agent wrappers (`ds-agent`,
  `cx-agent`, `cp-agent`, `ag-agent`, `oc-agent`) source `version-check.sh` at runtime,
  but no installer copied it — so the stale-version warning was a dead feature on every
  installed system. `install.sh` now installs it alongside the wrappers (target verified
  against the wrappers' actual source path). `install.ps1` needs no change: the `.ps1`
  agents duplicate the check inline.
- **`cli-dispatch-run.ps1` leaked temp files on error paths (AU4).** `stderrFile`,
  `launchMarker`, and `verifyResultsPath` were only cleaned up on the happy path. The
  main flow is now wrapped in `try/finally` with a `$script:TempFiles` registry — the
  PS1 equivalent of the bash twin's `trap cleanup_tmp EXIT INT TERM` — so temp files are
  removed on every exit path, including early `exit` and Ctrl-C.
- **Windows watchdog could kill the wrong process (AU5, minimal guard).**
  `claude-ds-stream.ps1` and `cx-stream.ps1` locate the worker PID via a WMI
  `Win32_Process` command-line substring match; with concurrent similar sessions this
  can match more than one process. When the match count is not exactly 1, the kill is
  now skipped with a stderr warning; single-match behavior is unchanged.
- **`parse-utils.mjs` swallowed write errors silently (AU6).** The catch blocks in
  `createStatusWriter.flush`, `writeMetaFile`, and `writeJsonFile` were `/* ignore */` —
  a disk-full or permission error left `status.json` stuck at `running` forever with no
  trace. Each now writes a one-line warning to stderr (with a once-per-writer guard on
  the ~200ms `flush` path to avoid spam). Write behavior itself is unchanged.
- **`cli-dispatch-run` (bash) `--prompt-file` missing-file check (AU13).** The PS1 twin
  validated `--prompt-file` existence at parse time; bash failed late with an obscure
  error. Bash now mirrors the PS1 check: clear `prompt file not found` message on stderr
  and `exit 1` right after argument parsing.

## [3.39.1] — 2026-07-11

### Fixed

- **`cli-dispatch-wait.ps1` infinite loop when the session dir vanishes (AU1).** The
  terminal-state check used a fixed `@('done','error','killed')` allowlist, so a
  missing/unreadable `status.json` (state resolves to `$null`) was treated as
  non-terminal; with the default `-Timeout 0` the timeout branch never fires, so the
  poll loop spun forever — hanging the Windows run pipeline that calls it
  (`cli-dispatch-run.ps1`). The loop now mirrors the bash twin's polarity: break on any
  state other than `running`/`human-controlled`, and emit a stderr warning on an
  empty/unreadable state instead of silently treating it as normal.
- **`cli-dispatch-run` (bash) crash when the worktree is already gone (AU2).** The
  `git -C "$WORKTREE_PATH" status/diff` calls that build `verdict-diff.patch` were
  unguarded under `set -euo pipefail`; if the worktree had been removed (e.g.
  `--cleanup-if-clean` followed by `--resume`), git exits 128 and the script died before
  writing `verdict.json`. The git calls are now guarded by a `[ -d "$WORKTREE_PATH" ]`
  check that falls through to an empty diff — matching the PS1 twin — so `verdict.json`
  is still written.

## [3.39.0] — 2026-07-11

### Added

- **Windows parity epic (#106) — all three waves.** The `.ps1` twins are brought up to
  parity with their bash reference implementations (native Windows backends: ds + cx):
  - `claude-ds-stream.ps1` / `cx-stream.ps1`: worker exit code now propagates through the
    parser pipeline (rc-file pattern — the bash `PIPESTATUS[0]` equivalent); `--verify-cmd`
    flag; `worker.pid` written to the session dir; interrupt/error reconciliation (a crash
    or Ctrl-C no longer leaves `state:"done"`/`"running"`); diff artifacts (`diff.patch` +
    `changed-files.json`); model env-var overrides (`DS_MODEL`/`CX_MODEL`/`CODEX_MODEL`)
    with bash-identical precedence; cx network toggle (`--network`/`--no-network` +
    `CX_NETWORK`); ds read-only runs get MCP isolation + post-run integrity guard.
  - `ds-agent.ps1`: `--effort` flag + script-adjacent stream fallback; `cx-agent.ps1`:
    network flags + fallback; `claude-ds.ps1`: env-var model overrides.
  - `ds/cx-worktree-run.ps1`: worker failures propagate (the empty `catch {}` that turned
    any failure into exit 0 is gone); cleanup instructions always print via try/finally.
  - `install.ps1`: ships `pty-host.mjs`, `takeover-cmd.mjs`, and the vendor xterm assets
    (dashboard terminal/takeover parity; takeover on native Windows remains untested);
    honors `CLI_DISPATCH_EDITOR` alongside legacy `CLAUDE_DS_EDITOR`.
  - `cli-dispatch-wait.ps1`: timeout message reports actual elapsed seconds;
    `cli-dispatch-clean.ps1`/`cli-dispatch-gain.ps1`: Windows node probing (NVM_SYMLINK,
    Volta, Program Files, scoop) before failing on a minimal PATH.
  - All 13 `.ps1` files validated with the real PowerShell parser
    (`Language.Parser::ParseFile`) — the parser caught two real syntax errors
    (`"$Label:"` scope-parse trap, statement-in-parentheses) that static review missed.

### Fixed

- **Worktree post-check false positive.** `ds-worktree-run.sh` (and the new `.ps1` port)
  failed a run when the MAIN repo was dirty for any reason — pre-existing untracked files
  (a stray `CLAUDE.md`) failed perfectly good runs in production. The check now snapshots
  `git status` before the worker launches and fails only on NEW entries; the leak patch is
  only written when there is a real leak (no more empty `leaked-changes-*.patch` litter).

## [3.38.0] — 2026-07-11

### Fixed

- **cli-dispatch-run: session-id discovery was dead for 4 of 5 backends (#105).** The
  per-backend markers (`cx session:` etc.) matched nothing the stream wrappers actually
  print, and under `set -e` the no-match grep killed the script **silently** before the
  newest-dir fallback could run — every cx/ag/oc/cp run exited 1 with zero diagnostics
  while the worker's finished work sat stranded in the worktree. Markers now match the
  real startup lines (cx `thread:`, ag `conv:`, oc/cp `session:` — all carry the final
  post-relocation id) with an explicit `|| true` guard; same fix in the `.ps1` twin.
- **verdict-writer: backend-name contract mismatch (#105).** It validated `meta.backend`
  against short names (`ds|ag|cx|oc|cp`) while every parser writes long names (`codex`,
  `antigravity`, …) — so `build-verdict` rejected every real session. Long names are now
  normalized via an alias map, with `status.backend` as fallback; the ds parser now also
  writes the previously missing `backend` field into both `status.json` and `meta.json`.
- **cli-dispatch-run hardening (#105).** stderr capture switched from process substitution
  to a pipe (`PIPESTATUS[0]`) so the marker grep can never read a partially flushed file;
  `--resume` now loudly rejects `--prompt` (it re-attaches, it does not converse — use
  `/cli-dispatch:resume`) instead of silently ignoring it; a failed `build-verdict` writes
  a valid `{"error": …}` JSON verdict instead of an empty file that crashed downstream
  `JSON.parse`; the wait subprocess inherits the resolved node binary via
  `CLI_DISPATCH_NODE`.
- **cli-dispatch-wait: bare `node` + silent empty-state (#105).** Now honors
  `CLI_DISPATCH_NODE`, probes common version-manager locations (same pattern as
  `cli-dispatch-clean` — launchd/cron run with a minimal PATH), and prints a diagnostic
  when status.json is missing/unreadable instead of treating it as a normal terminal state.
- **clean: never-finalized sessions were kept forever (#105).** A session dir whose worker
  died before status.json was ever written (state `?`) is now a stale candidate via the
  dir's own mtime, marked `(no status.json)`. Old-finished pruning now uses the shared
  `TERMINAL_STATES` enum (also covers `killed`, previously missed). New regression test.
- **stream-utils: `reconcile_session_error` failures are no longer invisible.** Swallowed
  status/meta write errors (and a missing `node`) now warn on stderr — a silent failure
  there leaves status.json stuck at `running` forever.
- **`/cli-dispatch:run` summary hardening.** `verdict.json` parse errors and error-verdicts
  print a one-line fallback instead of an uncaught Node stack trace; a comment documents
  why the `$ARGUMENTS` line must NOT be wrapped in eval (textual substitution already
  preserves quoting — verified with a stub-binary harness).

### Verified

- **Full 5-backend E2E smoke matrix now green:** one `cli-dispatch-run` per backend
  (ds/ag/cx/oc/cp) with a real task + `--verify` → 5/5 exit 0, correct verdict.json
  (normalized backend, `verify.exitCode: 0`, `stranded: true` for kept work). Test suite:
  97/97. Windows `.ps1` parity gaps are tracked separately as the #106 epic.

## [3.37.0] — 2026-07-11

### Added

- **`/cli-dispatch:run` slash command (#102).** Wraps the deterministic runner
  `cli-dispatch-run` for one-line orchestrator use:
  `/cli-dispatch:run <backend> "<prompt>" [--verify '<cmd>'] [--cleanup-if-clean] [flags]`.
  Prints a compact verdict summary after the run (exit code, session id, state, verify
  result, diffstat, `verdict-diff.patch` path) consistent with `/cli-dispatch:wait`, and
  falls back gracefully to `/cli-dispatch:setup` guidance when the binary is missing.
  All five runner defs (`*-runner.md`) now tell the babysitter to recommend the
  deterministic runner for purely mechanical delegations with a machine-checkable verify.
- **clean: verdict lifecycle (#101, SDD TL8).** `cli-dispatch-clean.mjs` (and the inline
  bash/PowerShell mirrors in `commands/clean.md`) now understand the deterministic runner's
  artifacts: dry-run marks deletion candidates that still carry a non-empty
  `verdict-diff.patch` (`⚠ has verdict patch` + a summary hint), and a new
  `--preserve-verdicts` flag (PowerShell: `-PreserveVerdicts`) archives
  `verdict.json`/`verdict-diff.patch` to `<sessions-root>/verdict-archive/<id>.{json,patch}`
  before removal. The `verdict-archive` dir itself is never scanned or deleted. Covered by
  a new `cli-dispatch-clean.test.mjs` suite (5 tests).

### Fixed

- **install.sh/install.ps1 did not ship `*-worktree-run.sh` (#103).** `cli-dispatch-run`
  resolves its per-backend worktree runners next to itself in `~/.local/bin`, but the
  installers never copied them — every backend failed with `backend runner not found`
  (ds only worked when a stale manual copy existed). `install.sh` now installs all five;
  `install.ps1` ships the ds/cx pair (`.sh` for the bash-driven Windows path + `.ps1` twins).
- **cli-dispatch-run crashed with `ERR_INPUT_TYPE_NOT_ALLOWED` at the verdict phase (#104).**
  `node --input-type=module <file>` is invalid (the flag is only allowed with `-e`/stdin);
  both `cli-dispatch-run` and `cli-dispatch-run.ps1` used it on the file-based
  `verdict-writer.mjs` invocations, so every run with `--verify` crashed after the worker
  finished — no `verdict.json`, no cleanup, work stranded in the worktree. The flag is
  dropped (`.mjs` extension already selects module mode).

## [3.36.0] — 2026-07-11

### Added

- **ds-agent: pre-flight snapshot of dirty checkouts (#94).** When an agentic run targets
  a git checkout with uncommitted changes, `ds-agent` (and its `.ps1` twin) first captures
  the ENTIRE state — tracked and untracked — as a dangling commit via a temporary index
  (`git read-tree` + `add -A` + `commit-tree`; zero working-tree impact) and prints the
  recovery SHA. A worker that later runs `git restore`/`git clean` can no longer destroy
  work irrecoverably: `git restore --source=<sha> -- <path>` brings anything back.

### Changed

- **Runner defs ×5: the task's mode choice is absolute (#98).** If the task prompt says
  "no worktree" / "in-place", the runner must run `*-agent --cwd <repo>` directly and may
  never fall back to `*-worktree-run.sh`; worktree setup failures now fail fast (one
  retry max) instead of looping over generated branch names.
- **Runner defs ×5: rogue-worker detection in verification (#94).** When the task names
  an allowed-file list, the babysitter must diff `git status --short` against it —
  out-of-list modifications, and especially deletions/reverts of unmentioned files, are
  reported as FAILED, never `verified ✓`, regardless of the worker's own checks.

### Fixed

- **Gain: named ratio caveat for usage-blind backends (#97).** Backends whose sessions
  report no usage at all (antigravity — agy exposes none) inflate the babysitter/worker
  ratio: their babysitting counts in the numerator while contributing zero to the
  denominator. The report now names them with session counts and states the true ratio
  is lower than shown.

## [3.35.0] — 2026-07-11

### Added

- **`/cli-dispatch:wait` slash command.** Thin wrapper over the `cli-dispatch-wait`
  binary: one blocking call until the session reaches a terminal state, then a compact
  summary — use it instead of repeated `/cli-dispatch:watch` polling. Recovered from a
  stale 2026-07-09 worktree where it had been stranded uncommitted (the #93 failure mode,
  found during worktree cleanup); its exit-code documentation was corrected to the actual
  contract (`0` done, `1` error/killed, `2` timeout) before landing.

## [3.34.0] — 2026-07-11

### Added

- **Deterministic runner: `cli-dispatch-run` — babysit a delegation with zero LLM cost.**
  New standalone CLI (bash + `.ps1` twin) that runs the mechanical part of a delegation
  end-to-end without an LLM babysitter: launch a backend worktree run (`--backend
  ds|ag|cx|oc|cp`), block on `cli-dispatch-wait` (bounded loop that detects
  `human-controlled` takeovers and stands down), write `<session-dir>/verdict-diff.patch`
  unconditionally BEFORE verification, run `--verify` commands via Node `child_process`
  (macOS ships no `timeout(1)`), and emit `<session-dir>/verdict.json`
  (`schemaVersion: 1`) with a 0–5 exit-code contract (0 done+verified, 1 verify failed,
  2 worker error/killed, 3 timeout, 4 human takeover, 5 setup error) mirrored as the
  process exit code — the orchestrator reads one small JSON instead of paying a runner
  subagent's turns (measured: 60+ turns and ~2.5M cache-read tokens per LLM babysitter).
  Pure core lives in `scripts/verdict-writer.mjs` (unit-tested); the PowerShell twin
  supports ds/cx (the other backends are Unix-only). Installed by `install.sh` /
  `install.ps1`. Design: `.specs/dev/sdd/deterministic-runner.md` rev.1, issue
  [#100](https://github.com/rbinar/cli-dispatch/issues/100). LLM `*-runner` subagents
  remain for delegations needing judgment.
- **`cli-dispatch-run --cleanup-if-clean`** — opt-in worktree removal gated on a
  two-signal AND (verdict exit code 0 AND empty `git status --short`), with an
  integration-test suite including the issue #93 regression: a worktree holding
  uncommitted work is never removed and its diff always survives in the session dir.

## [3.33.0] — 2026-07-11

### Changed

- **Runner defs: `cli-dispatch-wait` is now the mandatory wait primitive in all five
  runners.** Measured 2026-07-11: runners averaged 60+ Anthropic turns and ~2.5M
  cache-read tokens each because the defs offered the blocking wait as a mere suggestion
  and runners kept hand-rolling `sleep && cat status.json` poll loops (issue #88, fresh
  data in comments). All five defs now state `cli-dispatch-wait <session-id>` is the ONLY
  sanctioned way to wait for a terminal state; a bounded long-sleep poll loop is permitted
  solely as a fallback when the binary isn't installed.

### Added

- **Standalone `cli-dispatch-gain` CLI.** The token-accounting script moves out of the
  `/cli-dispatch:gain` command body into `scripts/gain-report.mjs`, with `cli-dispatch-gain`
  / `cli-dispatch-gain.ps1` wrappers (defensive node resolution for cron/launchd, same
  pattern as `cli-dispatch-clean`) installed by `install.sh` / `install.ps1` — so weekly
  `cli-dispatch-gain --log` snapshots can run from the OS scheduler without Claude. The
  command now prefers the installed binary and falls back to the plugin-root script.
- **Gain: turns-per-runner metric.** The babysitting section reports average babysitter
  turns per runner and warns when runners exceed 20 turns (the polling signature); both
  figures land in the `--log` snapshot for trend tracking.

### Fixed

- **Gain: Codex "input offloaded" was inflated ~13x.** Codex CLI's `turn.completed` usage
  reports cache-INCLUSIVE `input_tokens` (`cached_input_tokens` is a subset, measured
  65–95% of it); gain summed the raw field as fresh input, reporting 204.6M for 132
  sessions where the real fresh input was ~15.6M. `usage()` now subtracts
  `cached_input_tokens` when present. ([#99](https://github.com/rbinar/cli-dispatch/issues/99))

## [3.32.0] — 2026-07-11

### Changed

- **Dashboard: layout rework — Configuration moves to a header gear, backend usage moves
  to a Workers overview.** The Configuration rail tab (which had no list to show) is now a
  `⚙` header button opening the same config editor in the main pane; the rail keeps two
  tabs, renamed **Sessions** and **Workers** (no more wrapped labels). The per-backend
  token aggregate leaves the rail: the Workers tab's empty state now renders an overview
  card grid (one card per backend — in/out tokens plus a "N sessions no data" note), so
  the main pane's empty space does the work instead of the list column. Empty states show
  guidance text instead of the bare `←` arrow.

### Added

- **Dashboard: draggable rail width + responsive breakpoint.** The session list column is
  resizable (260–400px) via a drag handle, persisted to `localStorage`; below ~1100px the
  side panel collapses and the rail narrows so the dashboard stays usable at half-screen
  laptop widths.

### Fixed

- **Dashboard: two rail-rendering bugs.** (1) The rail-width restore script ran
  `Number(null)` → `0` when nothing was stored, silently clamping every fresh visitor's
  rail to the 260px minimum instead of the 320px default. (2) `loadList()` had no
  staleness guard, so a slow in-flight fetch from the previous tab could resolve late and
  overwrite the just-rendered list of the newly selected tab; a generation counter now
  discards stale responses.

## [3.31.0] — 2026-07-11

### Changed

- **Dashboard: Vercel/Geist visual redesign with a dark/light theme toggle.** The web UI
  drops the Dracula palette for Vercel-style design tokens — dark (`#0a0a0a` background,
  `#52a9ff` accent) and light (`#fafafa`/white, `#0070f3` accent) themes defined as dual
  CSS variable sets on `html[data-theme]`. A ☀/☾ button in the header flips the theme and
  persists it to `localStorage`; first paint follows `prefers-color-scheme` (no flash,
  set by an inline head script). Typography moves to the system sans stack for chrome and
  keeps monospace for data/logs; panels/chips get 1px `var(--bd)` borders and 6–8px radii.
  All previously hardcoded colors were converted to variables so both themes render
  correctly. Pure visual reskin — no behavior, API, or DOM-structure changes.

## [3.30.10] — 2026-07-10

### Changed

- **Runner defs: removed the "reserve sonnet for rare cases" escape hatch from all five
  `*-runner` descriptions.** Measured across 509 runner agents, only 18% actually ran on
  haiku despite the "always haiku" rule — sonnet/opus overrides added ~65% pure babysitting
  cost with zero quality gain (the orchestrator re-verifies the diff and tests anyway).
  The descriptions now state a hard prohibition against passing a model override; frontmatter
  stays pinned to `model: haiku`. ([#95](https://github.com/rbinar/cli-dispatch/issues/95))

### Added

- **cp-stream-parse: regression test with a real GitHub Copilot `assistant.message`
  fixture.** Investigation of [#96](https://github.com/rbinar/cli-dispatch/issues/96) showed
  the parser already captures `outputTokens` correctly since 3.29.0 — the `usage: null`
  sessions all predate that fix. A production transcript line is now a test fixture
  asserting `output_tokens` lands in `status.json`, so the capture path can't silently
  regress again. (Copilot CLI emits no input-token data — upstream limitation, documented
  in-code.)

## [3.30.9] — 2026-07-10

### Changed

- **`/cli-dispatch:setup`'s distributable "delegation priority" persistent-instructions
  block now includes a resume-vs-new-delegation rule.** When a delegated worker's output
  needs a follow-up (an edit didn't persist, wrong scope, a small correction), the block
  now tells the orchestrator to continue with `/cli-dispatch:resume <session-id>` instead
  of launching a fresh `*-runner`/`*-agent` delegation for the same task — a fresh
  delegation pays full babysitting cost again for what should be one continued
  conversation. Also points at `/cli-dispatch:gain`'s retry-cluster detection (#91) as the
  signal to watch for. Previously this guidance only lived in one user's private global
  `CLAUDE.md`, so it never reached anyone who installs the plugin fresh and opts into the
  setup-time reminder.

## [3.30.8] — 2026-07-10

### Fixed

- **`/cli-dispatch:clean-schedule`'s scheduled auto-clean silently failed
  every run for anyone whose `node` isn't on the system PATH** (nvm,
  Homebrew, volta, asdf) — launchd/cron run jobs with a minimal PATH (no
  shell rc sourced), so `cli-dispatch-clean` exited immediately with
  `'node' not found in PATH`, logged to `clean.log` and nowhere else,
  leaving stale worker session dirs to accumulate indefinitely with no
  visible error. `cli-dispatch-clean` now probes common node install
  locations (fnm, volta, asdf, Homebrew, the highest installed nvm
  version) before giving up, fixing every already-scheduled job the next
  time it runs — no re-install needed. The `clean-schedule` launchd
  install path also now bakes the resolved node dir into the job's own
  `EnvironmentVariables.PATH` for new installs.

## [3.30.7] — 2026-07-09

### Added

- **`/cli-dispatch:gain` now flags "possible retry-as-new-delegation"
  clusters among trivial delegations** (#91). Trivial sessions (diffstat
  1-49 lines) are grouped by `(cwd, backend)`, sorted by `startedAt`, and
  chained into a cluster whenever consecutive start times are under 15
  minutes apart. Clusters of size ≥2 print a line —
  `<cwd> (<backend>): <sessionId1>, <sessionId2>, ...  (N sessions, <first
  time> → <last time>)` — right after the existing "trivial delegations
  (diff < 50 lines): N" line, surfacing cases where the same task was
  retried as several brand-new delegations (each paying full babysitting
  cost again) instead of continued via `/cli-dispatch:resume`. `--log`
  snapshots gain a matching `trivialClusters` array field (`{cwd, backend,
  sessionIds, count, firstStartedAt, lastStartedAt}` per cluster) for
  tracking the pattern over time. Purely additive — `trivialCount` and all
  other gain output are unchanged.

## [3.30.6] — 2026-07-09

### Fixed

- **`ag-runner`'s mode-B (worktree-isolated) verification could silently drop
  finished work** (#90). If the agy worker timed out or exited nonzero
  mid-run, the runner could still write a clean-looking final report (e.g.
  "MOSTLY COMPLETE ✓, tests passing") even though the file changes existed
  only in the temporary worktree and were never merged back to the target
  repo — a real incident where a `/var/folders` worktree with a passing
  build/test run was silently lost, since nothing ports it back
  automatically and the worktree gets swept on reboot/cleanup. Added
  **Rule 3** to the mandatory mode-B verify protocol: whenever a worktree
  run doesn't end cleanly, the runner must check for uncommitted worktree
  changes, either rescue them into the target repo or dump a durable
  `git diff` patch (preferring a path inside the target repo over
  `/tmp`/`/var/folders`) before any cleanup, and report any build/test
  result qualified with which tree it ran against. The `Return format`
  status line gains a third value, `INCOMPLETE — STRANDED`, distinct from
  `verified ✓`/`FAILED`, for exactly this case.

## [3.30.5] — 2026-07-09

### Fixed

- **DeepSeek (claude-ds) and Codex worker sessions could permanently lose
  token usage on a hard kill/timeout/crash** (#89). `status.json.usage` was
  written only on the final stream event (`result` for DeepSeek; in
  practice usually reached per-turn via `turn.completed` for Codex). If the
  process died before that event, `usage` stayed `null` forever even though
  most or all tokens had already been spent. `ds-stream-parse.mjs` now
  accumulates usage incrementally from every `assistant` stream event
  (deduped by `message.id`, reusing the same accumulation logic as
  `dashboard-utils.mjs`'s `sumUsageFromEvents()`) and writes it to
  `status.json` as events arrive; `cx-stream-parse.mjs`'s existing per-turn
  `turn.completed` usage write now carries the same marker. Both set a new
  `status.usagePartial: true` flag while the recorded usage is not yet the
  authoritative final total, clearing it once the true final usage lands —
  so `/cli-dispatch:gain` (or anything else) can tell a genuine final total
  apart from a best-effort snapshot left behind by a killed session.

## [3.30.4] — 2026-07-09

### Added

- **`cli-dispatch-wait <session-id> [--timeout SECS] [--poll SECS]`** — a
  blocking wait primitive for `*-runner` babysitters (#88). Polls
  `status.json` via a plain shell loop (zero LLM tokens) until the session
  reaches a terminal state (`done`/`error`/`killed`), then prints a compact
  summary (state, usage, diffstat, `finalResultPreview`, last 20 lines of
  `progress.log`). Exit 0 if done, 1 if error/killed, 2 on timeout. Replaces
  hand-rolled `sleep 30 && cat status.json` poll loops in runner agent defs
  — measured at ~1.38B tokens of runner-only cache-read across 493 runner
  subagents, dominated by poll-turn context re-reads. Installed alongside
  `cli-dispatch-clean`/`cli-dispatch-dashboard` (backend-agnostic; Windows
  twin `cli-dispatch-wait.ps1`). `ag/ds/cx/oc/cp-runner.md` now recommend it
  as the preferred primitive for blocking on an already-running background
  session — additive to, not a replacement for, the existing synchronous-
  wait / terminal-state-gate requirements.

## [3.30.3] — 2026-07-09

### Changed

- **Runner defs: explicit never-opus rule for the babysitter model.** Task
  difficulty never escalates a `*-runner`'s own model — the worker does the
  work, the runner only monitors/verifies, and the orchestrator re-verifies
  anyway. Measured per delegation: opus ~20x, sonnet ~12x haiku babysitting
  cost with zero quality gain.

## [3.30.2] — 2026-07-09

### Fixed

- **`/cli-dispatch:gain` babysitting table now counts runner subagents only**
  (#87). A subagent counts as a runner when it actually invoked a wrapper CLI
  (`claude-ds`/`ds-agent`/`ag-*`/`cx-*`/`oc-*`/`cp-*`) in a Bash tool call;
  non-runner subagents (reviewers, explorers, unrelated projects) collapse to a
  one-line total and no longer inflate the babysitter/worker ratio (~8x on real
  data). The `--log` snapshot gains an `otherSubagents {agents, output}` field.

## [3.30.1] — 2026-07-08

### Added

- **`/cli-dispatch:gain --log`** appends a timestamped JSON snapshot of the
  report (`{ts, workers, trivialDelegations, anthropic}`) to
  `~/.cache/cli-dispatch/gain-history.jsonl`, one line per run — history
  survives `/cli-dispatch:clean`. Default behavior unchanged without the flag.

## [3.30.0] — 2026-07-08

### Added

- **Post-run diff artifacts in all 5 stream CLIs.** On worker completion,
  if the cwd is a dirty git worktree, the shared `write_diff_artifacts()`
  writes `diff.patch` (tracked diff + no-index patches for untracked
  files, `git apply`-able on a clean checkout) and `changed-files.json`
  (per-file status + diffstat) into the session dir. The orchestrator
  merges from these two small files instead of visiting the worktree;
  artifacts survive worktree cleanup. Best-effort, never changes exit
  codes.
- **`--verify-cmd <cmd>` in all 5 stream CLIs** (env fallback
  `CLI_DISPATCH_VERIFY_CMD`): after a clean worker exit, runs the command
  in the worker cwd and records `{cmd, exit, tail}` into
  `status.json.verify`. Non-zero verify exit is recorded, not escalated.
- **`/cli-dispatch:gain` reports the Anthropic babysitting side**: a
  second table summing `message.usage` from all subagent transcripts
  under `~/.claude/projects` per model (streamed line-by-line), plus a
  babysitter-output/worker-output ratio and total worker input
  offloaded. Only `claude-*` models are counted — claude-ds (DeepSeek)
  workers write the same transcript layout and are excluded. Documented
  as an upper bound (covers ALL subagents on the machine).
- **4-layer triviality guard** — stop delegating work cheaper done
  inline (single-file, under-50-line, unambiguous edits): runner
  frontmatter warnings at spawn-decision time; a 3-question Triviality
  gate in the ds-delegate skill; a runner-side early-exit that returns
  `trivial — do inline: <reason>` without launching the worker; and a
  `/cli-dispatch:gain` counter flagging completed delegations whose
  diffstat totals under 50 lines.
- **Batch-small-fixes guidance** in all 5 runner defs + the ds-delegate
  skill: several small related changes go into ONE delegation/worktree —
  per-delegation fixed cost dominates for small changes.

## [3.29.0] — 2026-07-08

### Added

- **Token accounting (#85).** `oc-stream-parse` now sums `step_finish` token
  usage across all LLM calls into the standard
  `input_tokens/cached_input_tokens/output_tokens/reasoning_output_tokens`
  shape (previously: last-event snapshot in a nonstandard nested shape);
  `cp-stream-parse` accumulates per-turn `assistant.message` outputTokens
  (Copilot exposes no input-token count — intentionally omitted, not zero);
  `ag-transcript-parse` documents in-code that agy 1.0.16 exposes no token
  data at all (`usage` stays `null`). New dashboard endpoint
  `GET /api/workers/aggregate` plus a compact per-backend usage panel in the
  workers view, and a new read-only `/cli-dispatch:gain` skill reporting
  per-backend token totals over session `status.json` files (handles both
  old and new usage shapes).

### Changed

- **Runner definitions: haiku babysitting is now the default for ALL
  delegations** (ds/ag/cx/cp/oc). Measured over a long real session,
  sonnet/opus babysitters cost more Anthropic tokens than doing the work
  natively (~\$338 vs ~\$143 API-equivalent), while haiku babysitters cost
  ~\$80 — the orchestrator independently re-verifies diffs/tests anyway.
  Cost-conscious sections gained lean-waiting rules: prefer one blocking
  foreground call; if polling, 30-60s bounded sleeps; never read full
  transcripts/diffs into the runner's own context.

### Fixed

- **cx-stream `--resume` fail-safe (#82 follow-up).** If a session died via
  SIGKILL (or before its `threadId` was recorded) the provisional session
  dir was never relocated, and a later `--resume` silently adopted the
  invoking shell's cwd — in a real incident this wrote 11 files into the
  wrong repository checkout. Resume now rescues provisional `cx-*` dirs by
  threadId match, and refuses to run (exit 1) when no recorded cwd can be
  found and no explicit `--cwd` was passed. `cx-stream.ps1` gains the
  equivalent restore/rescue/fail-safe (it previously had no cwd restoration
  at all).
- **cx-stream `--resume` model drift (#84).** Resume now restores the
  recorded model from `meta.json` (stripping the `" (effort)"` display
  suffix) when no explicit `--model` is passed, instead of silently
  re-resolving from the current config default.
- **cp-stream-parse usage contamination.** An unrelated Task sub-agent's
  `subagent.completed.totalTokens` could leak into `status.usage`; removed.
- **dashboard-utils `collectProcTree`** gains `ps` / active-child-handle
  fallbacks when `pgrep` is unavailable (no behavior change where `pgrep`
  works).

## [3.28.0] — 2026-07-07 17:35

### Added

- **Dracula color palette for the dashboard.** The dashboard client UI
  (`public-page.mjs`) moved from the old GitHub-dark tones to the Dracula
  palette (background `#282a36`, purple `#bd93f9` accent, cyan `#8be9fd`
  links, green `#50fa7b` / yellow `#f1fa8c` status, red `#ff5555` error).
  The flow view's step rows also gained a diff-style treatment:
  success/error result lines get a faint tinted background (green/red)
  matching diff +/- styling, and thinking steps are now purple-italic
  instead of plain gray-italic. Scope is palette + step styling only —
  sidebar/title-bar chrome is unchanged. Verified live via Playwright
  screenshots plus the full test suite.

### Fixed

- **ds-runner sessions could fail on the very first command with "command
  not found"** (Fixes #77), because Claude Code's persistent Bash shell
  doesn't source `~/.zshenv`. `ds-runner.md` now documents the required
  inline `PATH` export as the first command of a session; `cp-runner.md`
  gained the same note for consistency (docs-only, no issue).
- **DeepSeek worker briefs could hang until idle-timeout when asked to run
  a build/test command directly** (Fixes #69), since the worker inherits
  host Claude Code hooks (e.g. context-mode) that can redirect the command
  to an MCP tool the worker can't reach. Worker briefs must no longer
  instruct the worker to run build/test commands — the babysitter
  (ds-runner) now runs all verification itself, in its own shell.
- **A worker could silently leak edits outside its assigned worktree back
  into the main checkout** (Fixes #68), since `--cwd` isolation isn't a
  hard filesystem boundary. Added `ds-worktree-run.sh --post-check
  <repo-path>`, which fails loudly (with a saved patch file) if the main
  checkout is left dirty after a worker run, instead of relying on a
  babysitter to remember a manual check.
- **Codex worker briefs for worktree tasks could fail mid-task with
  "Operation not permitted"** (Fixes #70), because Codex's sandbox can
  edit files inside a worktree but can't write to the worktree's real git
  metadata (which lives outside the sandbox's writable root, under the
  main repo's `.git/worktrees/`). `cx-runner.md` now scopes worker briefs
  to file edits only — all git-metadata operations (commit/branch/push)
  happen in cx-runner itself, after the worker's turn.
- **`oc-stream --resume` passed our own `oc-<id>` session id straight to
  OpenCode**, which doesn't recognize it and fails with "Session not
  found" (Fixes #72), the same class of bug already fixed for cx/cp-stream.
  Also fixed a self-corrupting variant where a successful resume with the
  wrong raw id would overwrite the correctly-recorded thread id in
  `meta.json`, permanently breaking future resumes of that session.
  `oc-runner.md` also gained guidance that the OpenCode (kimi) worker
  degrades on broad/multi-part tasks and should get narrow, single-step
  briefs instead.
- **A logged-out Antigravity session would burn a full `ag-stream` run
  producing zero events before landing on a generic, unexplained error**
  (Fixes #73). A fresh (non-resume) run now does a cheap, bounded auth
  preflight check before launching the real backgrounded run; on a
  confirmed auth failure it now writes a clear, Turkish-language auth
  error immediately and exits 3, instead of silently proceeding to an
  empty, confusing failure.

## [3.27.0] — 2026-07-07

### Added

- **Model-ID datalist suggestions in the dashboard Configuration editor.** The 8 model
  fields (`AG_MODEL`/`AG_MODELS`, `CX_MODEL`/`CX_MODELS`, `CP_MODEL`/`CP_MODELS`,
  `OC_MODEL`/`OC_MODELS`) now suggest known-good model IDs as you type, via a native HTML
  datalist — free text is still accepted, this is a suggestion only. AG/CX/CP lists are
  static, sourced from installed-CLI metadata where discoverable (agy models,
  `~/.codex/models_cache.json`, `copilot --help`) with repo-internal fallbacks. OpenCode's
  list is live: a new `GET /api/models/opencode` route proxies OpenRouter's public models
  API server-side (empty list on any fetch failure, never crashes the dashboard).
- **Stale-install version drift detection.** `install.sh`/`install.ps1` now stamp the
  installed plugin version to `~/.config/cli-dispatch/.installed-version`;
  `/cli-dispatch:status` warns when an installed copy no longer matches the current
  `plugin.json`, since installed copies are separate deploys from the repo and could
  silently drift.
- **`check-version-sync.mjs` added** to catch `CHANGELOG.md`/`CHANGELOG.tr.md`/
  `marketplace.json` version drift automatically — both files have silently fallen behind
  the plugin version before (v3.21.0 and v2.1.0 respectively) with no automated way to
  notice. Used to verify this very release stays in sync.

### Fixed

- **`cx-stream --resume` now restores the session's original working directory**, and
  **`cp-stream --resume` now resolves the real Copilot `threadId`** instead of passing our
  own `cp-<id>` session id straight to `copilot` (Fixes #75, #71). Also fixed an error-
  serialization bug where a tool-error payload with an object `error`/`message` field
  rendered as the literal string `"[object Object]"` instead of the actual message.
- **Worktree-based delegation no longer hardcodes `origin/main` as the base branch**
  (Fixes #74). Repos without a `main` branch (develop-only, feature-branch-based) either
  failed outright or silently based the worktree on a stale/mismatched ref; base ref is now
  resolved in order: the repo's current checked-out branch, then origin's remote HEAD, then
  `origin/main` as a last resort.
- **OpenCode sessions with no explicit `OC_MODEL` now show the actual model in use** in the
  dashboard, via a new `OC_META_MODEL` fallback (scraped from OpenCode's own config),
  mirroring the existing Codex `META_MODEL`/`META_EFFORT` pattern.
- **Windows (PowerShell) wrappers reach parity with their bash equivalents.**
  `claude-ds-stream.ps1`, `cx-agent.ps1`, and `cx-stream.ps1` gained `--effort` support,
  `META_MODEL`/`META_EFFORT` config-scrape fallback, and `gh`-token forwarding — previously
  bash-only.

### Changed

- **`dashboard-server.mjs` split into `public-page.mjs` (client SPA template) and
  `dashboard-utils.mjs` (pure flow/process helpers)** for maintainability — no behavior
  change (verified byte-identical via HTTP response diff before/after). Added missing
  regression test coverage for `cx-stream-parse.mjs`, `ag-transcript-parse.mjs`, and the
  newly-extracted `dashboard-utils.mjs` hot paths, none of which had tests before despite
  recent real bugs in `readHead`/`readTail` and `collectProcTree`.
- **Deduplicated the `watchdog()` runtime-cap/idle-timeout logic** across `cx-stream`,
  `oc-stream`, and `cp-stream` (previously byte-identical copy-paste in each) into the
  shared `stream-utils.sh` — internal maintainability improvement, no behavior change.

## [3.26.1] — 2026-07-06 15:00

### Fixed

- **`claude-ds-stream` now records interruptions instead of leaving sessions
  stuck `running` forever.** It was the only backend wrapper with no INT/TERM
  trap, so an interrupted DeepSeek session's `status.json` never left the
  `running` state. Backported the same interrupt-handling pattern the other
  stream wrappers already use (with a new ordering marker so the parser exit
  is sequenced correctly); verified live against a real interrupt, which now
  cleanly records `interrupted: INT`. `cp-stream` also picked up the same
  bounded-wait-for-parser handling its siblings already had, plus a missing
  cleanup safeguard.
- **Dashboard robustness fixes.** Log tailing (`readHead`/`readTail`) no
  longer leaks file descriptors on error. A take-over action that failed
  partway through could previously leave a worker permanently stuck
  reporting "in use" (409) — it's now cleanly killed and released on
  failure. Process-tree collection now tells the difference between "the
  process-list lookup itself failed" and "the worker simply has no child
  processes," and logs the failure once instead of silently mis-reporting
  it.
- **Documentation brought back in sync with actual behavior.** The
  `--effort` reasoning-level flag is now documented for the DeepSeek,
  Antigravity, and Codex runners (previously only documented for Copilot,
  though all four support it). Codex's `--no-network` flag is documented.
  The Antigravity runner guide gained its missing "Model selection" and
  "Resume" sections; the OpenCode runner guide's stale version note was
  corrected; the DeepSeek runner guide gained "Read-only" and "Resume"
  sections.

## [3.26.0] — 2026-07-06

### Added

- **Dashboard shows which Anthropic model a Claude Code subagent used.** The subagent chip
  list and the subagent detail breadcrumb now display a model badge (e.g. Sonnet, Opus, Haiku)
  next to each Claude Code subagent, using the same tail-scan technique already used for the
  top-level Claude Code session list's model badge. Makes it easy to see at a glance which
  model actually ran a given subagent, not just the top-level session.

### Fixed

- **Hardened all 5 runner agents against fire-and-forget waits and unverified claims
  (#63, #64, #65).** ds/ag/cx/oc/cp-runner all had a reliability gap where a babysitter
  subagent's turn could end before confirming the worker actually reached a terminal state,
  leaving workers orphaned or their Task registration a zombie. Added a mechanical
  terminal-state gate — the babysitter's turn must not end until a fresh `status.json` read
  confirms a terminal state — plus two mandatory claim-verification rules: never label a
  failure "pre-existing" without proving it against the base state, and never report "done"
  without a mechanical checklist against the task's own named requirements.

## [3.25.0] — 2026-07-06

### Added

- **`/cli-dispatch:setup` offers to persist the delegation-priority reminder into CLAUDE.md.**
  Setup now has a new step that asks, via `AskUserQuestion`, whether to write a standing
  "runner delegation priority" reminder into your global or project `CLAUDE.md`. Once
  accepted, the reminder is idempotent and marker-guarded
  (`<!-- cli-dispatch:orchestration-priority -->`), so you no longer have to manually
  re-paste delegation-priority instructions into every session — the plugin can write it
  once and leave it in place.

### Fixed

- **`cp-stream-parse` no longer lets ephemeral reasoning clobber the final answer (#62).**
  GitHub Copilot's `assistant.reasoning` events (marked `ephemeral: true`) could arrive right
  after the true final `assistant.message` and overwrite the captured final answer with an
  internal reasoning fragment instead of the real report. Root-caused by replaying a real
  historical session transcript through the parser. The fix excludes ephemeral/reasoning
  events from ever touching `finalText`, and a new regression test
  (`plugins/cli-dispatch/scripts/__tests__/cp-stream-parse.test.mjs`) locks the behavior in.

## [3.24.0] — 2026-07-06

### Added

- **Config-level candidate model lists for ag/cx/oc/cp-runner (`AG_MODELS`, `CX_MODELS`,
  `OC_MODELS`, `CP_MODELS`).** These four runners now accept a standing, comma-separated
  candidate-model list in config, matching the existing single-value `_MODEL` keys, so you
  don't have to retype the list in every delegation prompt. When the orchestrator's
  delegation gives no explicit model or inline candidate list, the runner checks these
  config keys first and picks the best-fit candidate itself, before falling back to the
  existing single-value `_MODEL` default. Wired into the dashboard Configuration UI (new
  fields + hint text) and the `install.sh`/`install.ps1` config templates. `DS_MODELS` is
  intentionally excluded — ds-runner stays out of this feature.

### Fixed

- **`cx-stream` now surfaces Codex's default reasoning effort in the dashboard label.**
  When `--effort` wasn't passed, Codex silently applied its own `~/.codex/config.toml`
  `model_reasoning_effort` default (e.g. "high"), but the dashboard showed no thinking-level
  suffix at all, making it look like no reasoning effort was applied when one actually was.
  Mirrors the existing `META_MODEL` fallback pattern (scrapes `config.toml` the same way) so
  the label always reflects what actually ran.

## [3.23.0] — 2026-07-06

### Added

- **Dashboard config editor (secrets write-only).** The dashboard now has a config editor for
  the cli-dispatch config file — API keys and other secret fields are write-only (never
  echoed back once saved), and non-secret fields can be viewed and edited directly. A masked
  preview (e.g. `sk-...a1b2`) shows just enough of a saved key to confirm which one is
  configured without ever exposing the full value in the UI.
- **`_MODEL` config fields now document that they're single-value only** — clarified in
  docs to prevent confusion with the new multi-candidate model list feature below.
- **ag/cx/oc/cp-runner can pick from a candidate model list.** Instead of a single fixed
  `_MODEL` config value, these four runners now accept a list of candidate models; the
  babysitter subagent picks whichever fits the task best from the list at dispatch time.
- **Terminal-styled session/subagent/worker flow box.** The dashboard now renders the
  session → subagent → worker relationship inside a terminal-styled box, making the
  delegation chain easier to read at a glance.
- **Claude Code tab shows each session's current model.** Session rows in the Claude Code
  tab now display the model currently in use for that session.
- **Dashboard shows total delegation cost + high-overhead warning.** The dashboard now
  aggregates and displays the total cost across all delegated worker sessions, and surfaces
  a warning when delegation overhead is disproportionately high relative to the work done.
- **Each worker row resolves its specific babysitter subagent + that subagent's token
  usage.** Worker detail views now show which babysitter subagent (ds/ag/cx/oc/cp-runner)
  is responsible for a given worker and that subagent's own token usage, not just the
  worker's.
- **Worker rows show their parent Claude Code session.** A worker's detail view now links
  back to the Claude Code session that spawned it, making it easier to trace a worker back
  to the conversation that dispatched it.

### Fixed

- **`parent-index` prefers a resolved subagent match over a bare top-level match.** When
  both a specific subagent and a generic top-level session could plausibly be a worker's
  parent, the index now prefers the more specific subagent match instead of falling back to
  the bare top-level one.
- **`oc-stream` no longer treats OpenCode's own interrupted-call cancellations as fatal.**
  OpenCode occasionally cancels its own in-flight tool calls internally as part of normal
  operation; `oc-stream` was misreading these as fatal errors and killing the session. They
  are now recognized and ignored.
- **`cp-stream-parse` now extracts the real tool name/args from Copilot's actual event
  schema.** The previous parser assumed a documented event shape that didn't match what the
  Copilot CLI actually emits, so tool calls in the worker log showed blank or incorrect
  names/args. Reworked to match the real, undocumented schema.
- **`cx-runner` reports Codex rate-limit clearly and suggests a reroute.** When Codex hits
  its rate limit mid-task, the runner now surfaces a clear rate-limit message instead of a
  generic failure, and suggests rerouting the task to another backend.
- **`worktree-run.sh` scripts no longer auto-delete their worktree on kill.** Killing a
  worker mid-run previously triggered the script's cleanup trap and deleted the git
  worktree along with any in-progress work; the trap no longer fires on a kill signal.
- **`install.sh` never installed the human-takeover support files.** Fresh installs were
  missing `pty-host.mjs`, `takeover-cmd.mjs`, and the `vendor/` directory needed for the
  dashboard's "Take control" feature, so takeover silently failed on any machine set up
  after that feature shipped. The installer now copies all three.
- **Takeover spawn failure no longer crashes the whole dashboard.** If spawning the
  underlying CLI for a human-takeover session failed (e.g. missing binary), the error
  previously propagated up and took down the entire dashboard process instead of just that
  one takeover attempt.

## [3.22.0] — 2026-07-04

### Added

- **Human-takeover for the dashboard (all 5 backends).** A worker row's detail view now has
  a "Take control" action: kills the headless worker process, spawns the underlying CLI
  (DeepSeek/Antigravity/Codex/OpenCode/Copilot, resuming its session where supported) under a
  PTY, and streams it into an xterm.js terminal in the browser over a hand-rolled WebSocket —
  so a human can step in on a stuck or ambiguous session without losing its context. "Hand
  back" tears the PTY down and hands the session back to headless tracking. Read-only by
  default; this is an explicit opt-in write path scoped to already-owned worker sessions only.
- **CC session / subagent token usage.** The Claude Code tab's session and subagent detail
  views now show a "Usage: N in / M out" line, aggregated from the transcript's own per-turn
  `usage` (deduped by `message.id`, since Claude Code emits one JSONL line per content block
  with the same usage repeated on each).
- **Worker flow: tool calls vs. AI messages are now visually distinct.** Worker progress.log
  lines already carried a leading glyph per event type (`·` message, `✻` thinking, `$` shell
  command, `✎` edit, `▸` tool, `✗` error) but the dashboard rendered all of them as one flat
  "log" bucket. The renderer now maps each glyph to the same message/tool/thinking step
  styles native Claude Code sessions get, plus a distinct style for indented tool-result lines.
- **Dashboard filter defaults.** The Claude Code tab now defaults to the "busy" filter on
  load instead of "all". The workers tab shows a derived project label (last two path
  segments of the worker's cwd) under the backend/model line.

### Fixed

- **Exit-code reconciliation in all 5 stream wrappers.** `claude-ds-stream`, `ag-stream`,
  `cx-stream`, and `oc-stream` now reconcile the parser-written status against the
  underlying CLI's real exit code on SIGINT/SIGTERM, matching `cp-stream`'s existing
  handling — a killed worker no longer leaves `status.json` claiming `done`.
- Dashboard: worker detail header now reflects `stale` sessions instead of showing the raw
  (and misleading) `running` state text.
- OpenCode takeover resume now passes `--continue` alongside `--session`, matching
  `oc-stream`'s own verified resume invocation.

## [3.21.0] — 2026-07-04

### Added

- **Worker usage visibility in the dashboard.** Parsers now capture token/cost usage where
  the worker CLI exposes it (DeepSeek: from the claude stream-json `result` event; Copilot:
  defensive multi-pattern match over the undocumented event schema; Antigravity: none
  available, stays `null`; Codex/OpenCode already captured). The dashboard normalizes all
  shapes server-side to `{inTok, outTok, costUsd}` and renders a compact usage badge in the
  worker list ("1.5k in / 4.1k out · $0.042") plus a detailed usage line in the worker view.
  Fully backward compatible: sessions without usage render nothing.

## [3.20.0] — 2026-07-04

### Added
- **New backend: GitHub Copilot (`cp-*`).** Adds GitHub Copilot (npm `@github/copilot`, binary `copilot`) as cli-dispatch's 5th worker backend. Full parity with the OpenCode (`oc-*`) backend's footprint: `cp-agent` / `cp-stream` / `cp-worktree-run.sh` / `cp-stream-parse.mjs`, the `cp-runner` babysitter subagent, and commands `/cli-dispatch:cp-run`, `cp-status`, `cp-sessions`, `cp-balance` — plus updates to every cross-backend aggregator (`setup`, `doctor`, `status`, `help`, `sessions`, `balance`, `resume`, `clean`), the dashboard worker-panel label, `plugin.json`, and the README.
- **No real sandbox for Copilot.** Like OpenCode, GitHub Copilot has no OS-level or tool-level write-deny; `--allow-all-tools --no-ask-user` (always passed) enables headless use, not a safety opt-in — git-worktree isolation is the only safety boundary.
- **Copilot auth/model/effort support.** `cp-stream` reuses the shared `maybe_export_gh_token` helper (`COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`), honors `CP_MODEL`, passes `--add-dir "$CWD"`, `--no-auto-update`, and maps repo-wide `--effort low|medium|high` to Copilot's `--reasoning-effort=<level>`.
- **Copilot balance is documented honestly.** `cp-balance` and the aggregate balance command report that usage is not queryable from the CLI; `/usage` is interactive-only inside a Copilot REPL, and actual usage/limits live in GitHub Billing.
- **Windows deferred for Copilot.** Copilot v1 is Unix-only (macOS/Linux/WSL); `install.ps1` and any `.ps1` twins were not touched.

## [3.19.0] — 2026-07-04

### Added
- **`--install-missing` / `-InstallMissing` — opt-in auto-install of missing worker CLIs.** Passed to `install.sh`/`install.ps1`, it triggers only when a selected backend's underlying worker CLI is missing (`claude`, `agy`, `codex`, `opencode`): the installer attempts to install it automatically instead of just warning.
  - **claude**: npm (`npm i -g @anthropic-ai/claude-code`) preferred, `curl | bash` vendor installer as fallback.
  - **agy**: `curl | bash` vendor installer only (no npm package).
  - **codex**: npm (`npm i -g @openai/codex`), then `brew install --cask codex`, then `curl | bash` vendor installer as a last resort.
  - **opencode**: npm (`npm i -g opencode-ai`) only.
  - After each attempt it re-checks with `command -v` (`Get-Command` on Windows) and prints success/`FAIL`; on failure it falls back to the existing WARNING + manual-instructions block, unchanged.
  - **Default is OFF** — omitting the flag leaves current installer behavior byte-for-byte unchanged.
  - **Auth is never automated**: agy sign-in, `codex login`, and DeepSeek/OpenRouter API keys are always left to the user, even after a successful auto-install.
  - `/cli-dispatch:setup` only appends the flag after asking the user's explicit approval via `AskUserQuestion`, listing exactly which CLIs are missing and which commands will run.

## [3.18.0] — 2026-07-03

### Added
- **Forward the host's `gh` auth into sandboxed workers** ([#56](https://github.com/rbinar/cli-dispatch/issues/56)). On macOS, `gh` stores its OAuth token in the system Keychain (not `~/.config/gh/hosts.yml`), which sandboxed workers can't reach — so any delegated `gh issue`/`gh pr`/`gh api` call ran unauthenticated and silently returned nothing (observed on the Codex `workspace-write` and DeepSeek workers: *"gh auth status 7 denemede de geçersiz token döndürdü"*). Fix:
  - New shared helper `maybe_export_gh_token` in `stream-utils.sh`, called after `source_config` in **all four** stream wrappers (`cx-stream`, `ag-stream`, `claude-ds-stream`, `oc-stream`) — so it covers both the `*-agent` and `*-worktree-run.sh` launch paths for every backend. It exports the host's token as `GH_TOKEN` (which `gh` prefers over the keyring) only when the user hasn't already set `GH_TOKEN`/`GITHUB_TOKEN`. Uses `gh auth token` (no network round-trip).
  - **Opt-out:** set `CLI_DISPATCH_NO_GH_TOKEN=1` to disable forwarding (the token can carry broad scopes — `repo`, `workflow`, even `delete_repo` — and travels into the worker sandbox / provider context).
  - **`doctor`** gains a *GitHub CLI (gh)* section reporting the state: forwarding-disabled (opt-out), user-set token, auto-forwarded, or *not authenticated → delegated gh tasks will fail*.
  - Documented under *Security and data* in the README.
- **Codex worker now has network access by default** (workspace-write sandbox). Codex disables network in `workspace-write` by default, so even with `GH_TOKEN` forwarded, `gh`/`curl`/`pip` failed with *"error connecting to api.github.com"* — while the other backends (ds/agy/oc, no sandbox) had full network. `cx-stream` now injects `-c sandbox_workspace_write.network_access=true` by default so cx matches the others. Opt out per-call with `cx-agent --no-network`, or globally with `CX_NETWORK=0` in the config; `--read-only` stays fully isolated (no network). The status line shows `sandbox: workspace-write (network: on|off)`. Verified live: `cx-agent` reads a private GitHub issue via `gh` with no flags.

## [3.17.0] — 2026-07-02

### Added
- **`--effort low|medium|high` — per-task reasoning-effort selection on three backends** (agent + stream wrappers):
  - **antigravity**: agy exposes effort only through the model display-name suffix, so `--effort` composes it — `--model "Gemini 3.5 Flash" --effort low` → `"Gemini 3.5 Flash (Low)"` (an existing suffix is replaced); without `--model` it picks the first `agy models` entry at that effort. The composed name flows through the existing unknown-model validation. Verified live: session recorded `Gemini 3.5 Flash (Low)`.
  - **codex**: maps to `codex exec -c model_reasoning_effort=<level>` (both fresh and resume arg paths). The session's model label records it, e.g. `gpt-5.5 (low)` — verified live.
  - **deepseek**: sets the worker's thinking budget via `MAX_THINKING_TOKENS` (low=1024, medium=8192, high=31999). Verified live: the run's transcript contains thinking blocks and the session records `deepseek-v4-pro (high)`. Documented as best-effort (the API owns whether the budget applies).
  - **opencode**: `--effort` is **rejected** with a clear message (exit 2) — the opencode CLI exposes no reasoning-effort control.
  - Runner briefs updated: ag/cx/ds get the same MANDATE as `--model` (task names an effort → passing `--effort` is required); ds's is flagged best-effort; oc-runner bounces effort requests back to the orchestrator. Invalid levels fail loudly (exit 2). Env fallbacks: `AG_EFFORT` / `CX_EFFORT` / `CLAUDE_DS_EFFORT`.

## [3.16.0] — 2026-07-02

### Added
- **Dashboard now shows the model each worker ACTUALLY used, per backend.** `meta.json`'s `model` field was just an echo of the requested `--model` flag / config default — empty for antigravity/codex/opencode whenever no model was explicitly passed, so the Workers list showed no model at all for most sessions. Now:
  - **antigravity**: the parser scrapes the *observed* model from the transcript's `USER_INPUT` settings-change block (``changed setting `Model Selection` … to Gemini 3.5 Flash (High)``) and lets it overwrite the requested value — observed is ground truth, so the record is right even when agy silently fell back to its default on an unknown requested name.
  - **deepseek**: the parser stamps the model from the stream's `system/init` event (what the API actually reports) instead of the env echo.
  - **codex**: `codex exec --json` carries no model field at all (verified), so when no model was requested `cx-stream` records codex's own config default (`~/.codex/config.toml` `model = "…"`) in the session record — without touching the codex arguments.
  - **opencode**: opportunistic capture of `part.info.modelID`/`part.modelID` if a future opencode version surfaces it (no-op today; the `OC_MODEL` config default already populates the field).
  - **dashboard**: when the model is still unknowable (old sessions predating this change), the list row / crumb / linked-worker chips show a muted `default` label instead of nothing.

## [3.15.4] — 2026-07-02

Promised-vs-shipped audit (4 parallel read-only auditors over README/commands/agent-briefs/scripts), findings verified by repro before fixing.

### Fixed
- **Antigravity backend was completely dead.** The Track B refactor dropped `openSync`/`closeSync` from `ag-transcript-parse.mjs`'s `node:fs` import while `drain()` still called them; the ReferenceError was swallowed by `catch { return }`, so the tailer never read a byte of agy's transcript — every ag run ended `state:"error"` with an empty transcript copy, empty progress.log, and no stdout answer. Re-imported and verified end-to-end (fake-transcript repro + a live `ag-agent -q` smoke test returning `OK`).
- **Fresh installs shipped broken wrappers: shared helpers were never installed.** The 3.15.x refactors extracted `stream-utils.sh` (sourced by every bash stream wrapper via `$SCRIPT_DIR`) and `parse-utils.mjs` (imported by every parser as `./parse-utils.mjs`), but `install.sh`/`install.ps1` never copied either — any fresh install/reinstall died with a missing-file source error or `ERR_MODULE_NOT_FOUND` in all four backends (existing machines kept working only on stale pre-refactor self-contained copies). Both installers now ship the helpers unconditionally.
- **`claude-ds-stream` missing-key error crashed instead of explaining.** The friendly "DEEPSEEK_API_KEY not set. Add it to <config>" message referenced `$CONFIG`, which stopped existing when config loading moved into `source_config` (local var) — under `set -u` the path died with `CONFIG: unbound variable`. `source_config` now exposes the resolved path as `CONFIG`.
- **`CODEX_API_KEY` in the config never reached codex (macOS/Linux).** The config promises key-based headless auth, but bash `cx-stream` sourced the config without exporting, so the variable never entered the subprocess environment (the PowerShell twin already exported it — platform drift). Now exports `CODEX_API_KEY`/`OPENAI_API_KEY` when set, mirroring `oc-stream`'s `OPENROUTER_API_KEY` handling.
- **Watchdog timeouts were invisible in cx/oc session records.** On a `--max-runtime`/`--idle-timeout` kill the parser just saw stdin EOF and finalized `state:"done"`/`exitCode:0` — the timeout only existed in the wrapper's exit code, so dashboard/sessions/clean saw a successful run. New shared `reconcile_session_error` helper rewrites `status.json`/`meta.json` (`state:"error"`, real reason, real rc) from the timeout path of both wrappers, matching the DeepSeek backend's existing post-run reconcile.
- **DeepSeek runs whose answer only arrived as streamed text left `progress.log` without the final message.** `finalize()` called `closeAll()` before `flushPending()`, and `appendProgress` no-ops on a closed fd. Order swapped; verified by repro.
- **Dashboard linked-worker chips never showed model/staleness.** `workerPanelHtml` renders `w.model` and `w.stale`, but `linkedWorkers()` didn't include those fields in its result — chips silently showed raw `running` for dead workers and no model ever. Fields added.
- **Uninstall instructions removed a nonexistent marketplace.** README told users `/plugin marketplace remove claude-ds`; the marketplace is named `cli-dispatch`. Fixed in both READMEs.
- **DeepSeek scripts pointed users at a nonexistent slash command.** Five user-facing error messages said "run /cli-dispatch:ds-setup"; the command is `/cli-dispatch:setup`.

### Changed
- **TERMINAL.md de-staled from the `claude-ds` → `cli-dispatch` rename:** installer/worktree paths (`plugins/claude-ds/…` → `plugins/cli-dispatch/…`), config path (`~/.config/cli-dispatch/config` — a key placed at the documented legacy path was silently ignored), sessions dir, parser install path, `CLI_DISPATCH_*` env var names (legacy `CLAUDE_DS_*` noted as still honored), and the "four executables" miscount.
- **OpenCode visibility:** the `ds-delegate` skill now documents the OpenCode backend (section, commands, triggers, role line) — it was entirely absent, making the 4th backend undiscoverable from the delegation skill; `dashboard.md` and `watch.md` descriptions now list OpenCode; the README "under the hood" CLI table gains `oc-stream`/`oc-agent` rows (both languages); `oc-run.md`'s stale "resume unverified" warning replaced with the 3.15.1-verified statement.
- **Runner-brief model-verification wording made honest:** `meta.json` records the *requested* model (echoed from the flag), not what the worker actually ran — the ag-runner brief now says the real guarantee is the exact `agy models` name plus ag-stream's unknown-model warning, and cx/oc briefs note that loud invalid-slug failures make requested = actual on success.
- **`ag-runner` brief: `--read-only` rejection attributed to the right layer** (`ag-agent` forwards it; `ag-stream` refuses with exit 2).

### Removed
- `ag-version.sh` — orphan: installed by nothing, referenced by nothing.

## [3.15.3] — 2026-07-02

### Changed
- **Worker model mandate extended to all runner agents (follow-up to 3.15.2's `ag-runner` hardening).** `cx-runner` gains a "Worker model selection" section (it had none): if the task names a model, `--model <slug>` is MANDATORY, with the codex-specific caveat that an invalid slug fails loudly with an API error (no silent fallback like agy) and the default otherwise comes from `~/.codex/config.toml` / `CX_MODEL`. `oc-runner`'s existing section is hardened the same way (mandatory when requested, bare OpenRouter slug, loud failure on invalid slug). `ds-runner` gets the inverse note: `ds-agent` has NO `--model` flag — the model is fixed by `DS_MODEL` / `DS_FLASH_MODEL`, so a per-task model request must be bounced back to the orchestrator as a backend choice, never improvised. All three add the post-run `meta.json` verification step and a `model:` line in both return formats, matching `ag-runner`.
- **`oc-runner`: stale resume-semantics TODO removed.** The `--session <id> --continue` behavior was verified live in 3.15.1 (resumes the *named* session); the agent brief still carried the "unverified" TODO block — replaced with the verified statement.

## [3.15.2] — 2026-07-02

### Changed
- **`ag-runner`: worker model selection is now a hard requirement, not a suggestion.** Session forensics showed the orchestrator asking for "Gemini 3.5 Flash" while most antigravity sessions ran with `model: ""` (agy's default) — the babysitter simply never passed `--model`. The agent brief now makes it explicit: if the task names a worker model, passing `--model` with the EXACT `agy models` display line (reasoning suffix included) is MANDATORY; agy silently falls back to its default on a missing/unknown name, so skipping the flag counts as failing the task. Adds a 3-step procedure (copy exact name → pass verbatim → verify `"model"` in the session's `meta.json` after the run) and a `model:` line in both return formats so the orchestrator always sees which model actually ran.

### Fixed
- **Dashboard: live refresh no longer flickers.** Every SSE change event used to blank the detail view to `loading…` and rebuild it from scratch (and `loadList()` cleared the rail before its fetch resolved) — on a busy session that meant constant flashing and the scroll position jumping to the top. Now: views render to a string and only touch the DOM when the HTML actually changed (most fs.watch wakeups become no-ops), swaps preserve the scroll position of both the rail and the main pane, change bursts are coalesced client-side to at most one refresh per 600ms, `loading…` only shows when navigating to a *different* item, and the worker "Görev / talimat" panel keeps its open/closed state across refreshes.
- **Dashboard: Workers filter chips were dead on arrival.** The `setWFilter` onclick used single-backslash escapes (`\'`) inside the server-side template literal, which collapsed to a bare quote in the served page and broke the entire client script with a syntax error. Escaped properly (`\\'`), matching the Claude Code filter line one line above. Caught by a parse test that evaluates the embedded `<script>` exactly as the browser would.

## [3.15.1] — 2026-07-02

### Fixed
- **`oc-stream-parse.mjs`: OpenCode's top-level `error` event was losing its diagnostic message.** OpenCode emits `{"type":"error","error":{"data":{"message":...}}}` on a turn failure (bad model slug, no tool-use-capable endpoint, upstream 5xx) — the payload lives at the event's top level (`ev.error`), not nested under `ev.part` like every other event type. The parser was only reading `part.message`, so real failures always degraded to a generic `"unknown error"` string (the `state:"error"` flag itself was still set correctly — this was a lost-diagnostic bug, not a false-success bug). Confirmed live against a real `OPENROUTER_API_KEY` with two distinct failure modes and fixed. Also empirically confirmed `--session <id> --continue` correctly resumes the *named* OpenCode session, not just "the last one" — the resume-semantics TODO from 3.15.0 is resolved, no fix was needed there.

### Changed
- Extracted `json_field` / `relocate_session_dir` / `surface_status_error` into `stream-utils.sh`, now shared by `ag-stream` / `cx-stream` / `oc-stream` (behavior-preserved, ~30 duplicated lines removed).
- `ds-stream-parse.mjs` now uses the shared `clip()` helper instead of an inline reimplementation.

### Removed
- 5 orphaned dashboard screenshots (972KB, unreferenced anywhere in the repo — README only embeds the GIFs/MP4).

## [3.15.0] — 2026-07-02

### Added
- **New backend: OpenCode (`oc-*`), via OpenRouter.** Adds OpenCode (npm `opencode-ai`, binary `opencode`) as cli-dispatch's 4th worker backend, driven through OpenRouter so users can target any OpenRouter model (e.g. `google/gemma-4-31b-it:free`). Full parity with the Codex (`cx-*`) backend's footprint: `oc-agent` / `oc-stream` / `oc-worktree-run.sh` / `oc-stream-parse.mjs`, the `oc-runner` babysitter subagent, and commands `/cli-dispatch:oc-run`, `oc-status`, `oc-sessions`, `oc-balance` — plus updates to every cross-backend aggregator (`setup`, `doctor`, `status`, `help`, `sessions`, `balance`, `resume`), the dashboard worker-panel label, `plugin.json`, and the README.
- **No real sandbox for OpenCode.** Unlike Codex's kernel-enforced `--read-only`, OpenCode has no OS-level or tool-level write-deny; `--auto` (always passed) auto-approves every permission prompt as a functional requirement for headless use, not a safety opt-in — git-worktree isolation is the only safety boundary (same posture as the Antigravity backend).
- **Setup-flow model picker for OpenCode.** `/cli-dispatch:setup` now asks the user to pick a default OpenCode model via `AskUserQuestion` (2-3 curated free-tier OpenRouter slugs + a custom-entry option) and writes it to `OC_MODEL` in the config; the `OPENROUTER_API_KEY` itself is never written by Claude — same paste-it-yourself mechanism as DeepSeek's key (installer auto-opens the config in an editor if the key is still empty after install).
- **Windows deferred for OpenCode.** OpenCode is Unix-only for v1 (macOS/Linux/WSL); `install.ps1` and any `.ps1` twins were not touched.

## [3.14.4] — 2026-07-01

### Added
- **Dashboard: worker model display.** The Workers tab now shows the model name next to the backend in the list (e.g. `deepseek deepseek-v4-pro`, `codex gpt-4.1`), in the crumb when a worker is open, and in the linked-workers panel inside Claude Code session detail. Source: `meta.json` → `model` field (written by the parser at session start from `CLAUDE_DS_MODEL` / `AG_MODEL` / `CX_MODEL` env vars).
- **Dashboard: Workers tab state filter.** The Workers tab now shows `all / running / done / error` filter chips (identical UX to the Claude Code sessions filter). Filter resets to `all` on each tab switch.

## [3.14.3] — 2026-07-01

### Changed
- **Extract `stream-utils.sh`.** `mtime_of`, `kill_tree`, `proc_tree`, `kill_worker`, `source_config`, and `resolve_sessions_root` were duplicated across `ag-stream`, `cx-stream`, and `claude-ds-stream`. Moved to a single `scripts/stream-utils.sh`; each stream script now sources it. Net: ~160 lines deleted.
- **Extract `parse-utils.mjs`.** `createStatusWriter`, `openSessionFiles`, `writeMetaFile`, `humanSize`, and `clip` were duplicated across `ag-transcript-parse.mjs`, `cx-stream-parse.mjs`, and `ds-stream-parse.mjs`. Moved to `scripts/parse-utils.mjs`; each parser now imports from it. Net: ~80 lines deleted.

### Fixed
- **`ag-worktree-run.sh` / `cx-worktree-run.sh` / `ds-worktree-run.sh`: TOCTOU race on worktree path claim.** The `mktemp -d … && rmdir` + `git worktree add` sequence has a window where another process can claim the same path. Added a retry: if `git worktree add` fails, generate a fresh `mktemp` path and retry once.

## [3.14.2] — 2026-07-01

### Fixed
- **`ag-stream`: dead `RAWLOG` tempfile.** `RAWLOG` was created via `mktemp` and passed to `run_agy_bg()` as a redirect target, but never read. Removed; redirected the pty output to `/dev/null 2>&1` instead. Three `rm -f "$RAWLOG"` sites in the cleanup/exit paths updated accordingly.
- **`ag-transcript-parse.mjs`: `finalize()` reports success on non-zero exit.** The previous condition `finalText ? (isErr && !/^\d+$/.test(done) ? 'error' : 'done') : 'error'` treated a numeric done-string (e.g. `"1"`) as success when `finalText` was present. Replaced with `finalText && (done === '0' || done === '') ? 'done' : 'error'` — any non-zero exit now forces `'error'` regardless of done-string format.
- **`claude-ds-stream`: orphan DS processes on timeout.** The watchdog used `kill_tree "$pid" -TERM; sleep 5; kill_tree "$pid" -KILL`, which misses processes that reparented to init between the two calls. Replaced with `kill_worker` (snapshot-first pattern from `ag-stream`/`cx-stream`): capture the full subtree before the first kill, then TERM and KILL the captured set. Added an `EXIT` trap (`cleanup`) so the worker is also killed on unexpected script exit.
- **`cx-stream`: dead `RC_FILE` tempfile.** `RC_FILE` was created via `mktemp` but never written; exit code is captured via `wait` instead. Removed creation and all `rm -f "$RC_FILE"` references. Removed the redundant `[ "${CX_PROGRESS_STDERR:-0}" = "1" ] && export CX_PROGRESS_STDERR` re-export (variable is already exported by `cx-agent` before spawning `cx-stream`).
- **`dashboard-server.mjs`: XSS in onclick attribute insertions.** Four places inserted dynamic values (agent IDs, session IDs, worker IDs) bare into `onclick="openSub('...')"` / `openWorkerById('...')` / `reopen('...')` attributes. Added `escAttr()` helper (escapes `& < > " '` → HTML entities); all four insertion sites now wrapped. Also escaped the URL in `mdInline` href construction (`safe.replace(/"/g,'&quot;')`).
- **`cx-agent`: stale audit-prefix comment.** Removed `# M1:` prefix from the `${FWD[@]+"${FWD[@]}"}` comment.
- **`ds-stream-parse.mjs`: missing `return` in `handleEvent()`.** The `'result'` branch set `finalText` but fell through instead of returning, making all subsequent branches reachable when a result event was processed. Added `return` to match all other branches.

## [3.14.1] — 2026-06-29

### Fixed
- **kill.md / resume.md: shell injection via `$DIR` in `node -e` string.** Session dir path was interpolated bare into single-quoted JS string literals (`'$DIR/status.json'`); a session ID containing a single quote could break out of the string. Fixed by passing via `CLI_DISPATCH_SESSION_DIR` env var and reading `process.env.CLI_DISPATCH_SESSION_DIR` inside the script.
- **kill.md: `pgrep` self-exclusion regex typo.** `grep -v "^$$\$"` had a trailing `\$` causing the pattern to include a literal `$`. Fixed to `grep -v "^$$"`.
- **resume.md: missing warning on metadata fallback.** When neither `status.json` nor `meta.json` has a `backend` field the command silently routed to DeepSeek. Now emits a warning before assuming `deepseek`.
- **cx-worktree-run.sh: missing `trap _cleanup ERR INT TERM`.** Unlike the ds and ag variants, the cx worktree script had no cleanup trap — a Codex crash left a stale worktree on disk. Added `_cleanup` + `trap`, mirroring the fix applied to ds/ag in 3.14.0. Also removed `|| true` from the `cx-stream` call so worker crashes propagate to the babysitter.
- **ag-agent / cx-agent: wrong error message on missing CLI.** The "not found" message referenced `/cli-dispatch:ds-setup` (DeepSeek-specific); corrected to `/cli-dispatch:setup`.
- **sessions.md / ds-sessions.md / ag-sessions.md / cx-sessions.md: stale or wrong follow-up hints.** The resume-hint at the bottom of all four session commands referenced backend-specific CLI flags directly (`claude-ds-stream --resume`, `ag-stream --resume`, `cx-stream --resume`). `ag-stream` and `cx-stream` have no `--resume` flag — those hints were actively wrong. All four now point to `/cli-dispatch:resume <id> <follow-up>`.
- **doctor.md: incomplete CLI checks.** DeepSeek section checked `ds-agent` + `claude-ds-stream` but not `claude-ds` (all three are installed by setup). Antigravity section checked `ag-agent` but not `ag-stream`. Codex section checked `cx-agent` but not `cx-stream`. All three gaps filled.
- **watch.md: no guard for empty `$ARGUMENTS`.** Calling `/cli-dispatch:watch` with no argument would produce confusing output (checks the session root as if it were a session dir). Added a usage hint + early exit when `$ARGUMENTS` is empty.

## [3.14.0] — 2026-06-29

### Added
- `/cli-dispatch:doctor` — full health check command: verifies all 6 CLIs on PATH, API keys, auth state; green ✓ / red ✗ per item; includes explicit `~/.local/bin` PATH check and smoke-test hint.
- `/cli-dispatch:kill <session-id>` — stop a running worker session: sends SIGTERM via `pgrep -f <session-id>` and marks `status.json` state as `killed`.
- `/cli-dispatch:help` — one-screen grouped command cheat sheet (Setup, Delegate, Monitor, Housekeeping).
- `/cli-dispatch:resume <session-id> <prompt>` — continue any worker session with a follow-up; auto-detects backend (DeepSeek / Antigravity / Codex) from `status.json`.

### Fixed
- `ds-worktree-run.sh` / `ag-worktree-run.sh`: removed `|| true` from worker call (crash now propagates to babysitter); added `trap _cleanup ERR INT TERM` to remove leaked worktrees on crash or signal.
- `watch.md`: removed stale "claude-ds" branding — the command works for all backends (DeepSeek, Antigravity, Codex); updated follow-up hint to `/cli-dispatch:resume`.

## [3.13.4] — 2026-06-28

### Fixed
- **cx-runner / ag-runner / ds-runner: enforce delegation — babysitter must not edit files directly.** Added a CRITICAL block to all three runner agents explicitly forbidding the babysitter from using Edit, Write, `cat >`, `sed -i`, or any other direct file mutation. The worker CLI (cx-agent / ag-agent / ds-agent) must do the actual coding; the runner only invokes, monitors, verifies, and reports.
- **cx-runner: remove bogus `--version` check.** `cx-agent` has no `--version` flag; running it would exit non-zero and mislead the agent. Prerequisite check is now `command -v cx-agent` only.

## [3.13.3] — 2026-06-28

### Changed
- **Dashboard: the worker "Task / instruction" panel now starts collapsed** (click to expand), matching the Subagents/Worker-sessions panels.

## [3.13.2] — 2026-06-28

### Changed
- **Dashboard: the pinned task/instruction panel scrolls instead of burying the flow.** Full prompts can be large (5k–25k+ chars); the "Task / instruction" panel now caps at ~38vh and scrolls, so the flow stays reachable.

### Docs
- **Updating note:** `/plugin update` refreshes commands/skills only — it does **not** reinstall the worker wrappers in `~/.local/bin`. After an update that changes a wrapper (e.g. the new `prompt.txt` field from 3.13.0), re-run `/cli-dispatch:setup` once. (README EN+TR.)

## [3.13.1] — 2026-06-28

### Docs
- **README overhaul (EN + TR).** The **Features** section was stale (DeepSeek-only) — rewritten to cover all three backends, the dashboard, native balance (aggregate + per-backend), `clean`/`clean-schedule`, the Codex real-OS sandbox, the `ds/ag/cx-runner` subagents, Markdown rendering, and stale-worker detection. Also refreshed the intro, Usage intro, Session-tracking (added the `prompt.txt` row), Security/egress (per-provider), and Architectural-role sections to be backend-neutral.

## [3.13.0] — 2026-06-28

### Added
- **Dashboard: the worker's task/instruction is pinned at the top of its page.** A worker detail page rendered only the flow (newest-first), so the original instruction was buried or off-screen. It now shows a pinned **"Task / instruction"** panel (Markdown-rendered) above the flow, always first regardless of flow order. `/api/worker/:id/flow` now returns `prompt` (+ `model`/`cwd`/`startedAt`).
- **The pinned instruction is the FULL prompt — no truncation.** Previously only `meta.json`'s 120-char `promptPreview` existed. The stream wrappers (`cx-stream`, `claude-ds-stream`, `ag-stream` + the `.ps1` variants) now write the complete prompt to `prompt.txt` in the session dir; the dashboard serves that in full, falling back to the 120-char preview for older sessions that predate this.

## [3.12.0] — 2026-06-28

### Added
- **Dashboard: Markdown rendering for message/prompt text in the flow.** Assistant messages and prompts (which workers emit as Markdown) now render headings, **bold**/*italic*, `inline code`, fenced code blocks, lists, and links — instead of raw text. Tool lines stay plain. The renderer is a tiny **XSS-safe** one (no deps, stdlib-only ethos): it escapes ALL input first, then applies a fixed whitelist of transforms and never passes raw HTML through; link `href`s are sanitised (only `http(s)`/relative — `javascript:` etc. become `#`). Verified: `<script>` is escaped, `javascript:` links are neutralised.

## [3.11.2] — 2026-06-28

### Changed
- **Dashboard: the "Worker sessions (ds/ag/cx)" panel now starts collapsed too.** It defaulted to open; like the Subagents panel it now defaults to closed.

## [3.11.1] — 2026-06-28

### Changed
- **Dashboard: the inactive "Subagents" panel now starts collapsed.** The session view's non-active subagents panel defaulted to open; it now defaults to closed (the "Active subagents" panel stays open). A manual toggle is still preserved across live refreshes.

## [3.11.0] — 2026-06-28

### Added
- **`/cli-dispatch:clean-schedule` — automatic daily cleanup of stale worker dirs.** Registers an **OS-level** scheduled job (launchd on macOS, cron on Linux/WSL, Scheduled Tasks on Windows) that runs `cli-dispatch-clean --remove` in the background — so stale `running`-but-dead dirs are pruned automatically even when Claude Code isn't open. No cloud agent, no tokens. Actions: `install` (default), `status`, `uninstall`; options `--time HH:MM` (default `03:00`) and `--older-than DAYS`. Logs to `~/.cache/cli-dispatch/clean.log`.
- **Shared cleanup engine + CLI.** The `/cli-dispatch:clean` logic is now a reusable `cli-dispatch-clean.mjs` engine behind a `cli-dispatch-clean` wrapper (bash + `.ps1`), installed to `~/.local/bin` (backend-agnostic, like the dashboard). Both the manual command and the scheduled job use it. Default DRY-RUN; `--remove` deletes; a genuinely-running worker (recent write) is never touched.

## [3.10.0] — 2026-06-28

### Added
- **`/cli-dispatch:clean` — remove stale worker session dirs.** A worker killed before it finalized (Ctrl-C, parent CLI closed mid-run, crash, watchdog kill, or a codex provisional `cx-<ts>-<pid>` dir that never relocated) leaves `status.json` stuck at `state:"running"` forever; these accumulate under `~/.cache/cli-dispatch/sessions` and clutter `sessions`/the dashboard. The command finds them by `status.json` mtime (`running` + idle > `--stale-secs`, default 600 s — larger than the dashboard's 90 s so a live-but-quiet turn is never deleted) and, with `--remove`, deletes them. **Dry-run by default.** `--older-than DAYS` additionally prunes finished (`done`/`error`) sessions older than DAYS. A genuinely-running worker (recent write) is never touched. Bash + PowerShell.

## [3.9.1] — 2026-06-28

### Fixed
- **Dashboard: a worker interrupted before finalize no longer shows a green "running" dot forever.** When a worker (codex/ds/ag) is killed mid-run (Ctrl-C, CLI closed, crash) its `status.json` stays stuck at `state:"running"` — the dashboard trusted that blindly and painted it green/active. `listWorkers()` now derives a `stale` flag from the `status.json` mtime (no write for >90s while `running` ⇒ dead); the UI renders stale workers with an idle dot + a `stale` badge and stops SSE-subscribing to them. (Same liveness heuristic already used for subagents; threshold is generous so a genuinely-running-but-quiet turn isn't misflagged.)

## [3.9.0] — 2026-06-28

### Added
- **Codex on native Windows.** New `cx-stream.ps1` + `cx-agent.ps1` PowerShell wrappers (faithful ports of the bash `cx-stream`/`cx-agent`: provisional→thread-id session-dir relocation, watchdog runtime/idle caps, real `-s read-only` sandbox, `-o` clean-answer capture, turn-level error propagation). `install.ps1` now takes `-Backends deepseek,codex|all` and installs the Codex backend (+ `.cmd` shims). Antigravity stays WSL-only (needs a pseudo-TTY). Closes the Windows gap where `codex` runs natively but had no wrappers.
- **Aggregate `/cli-dispatch:balance`.** One command shows DeepSeek account balance + Antigravity per-model quota + Codex 5h/7d rate limits side by side — the balance twin of the aggregate `sessions`/`status`/`watch`. Read-only, no third-party tools; unconfigured/offline backends print a note instead of failing.
- **Worktree helpers for Antigravity & Codex.** `ag-worktree-run.sh`, `cx-worktree-run.sh` (+ `cx-worktree-run.ps1`) mirror `ds-worktree-run.sh`: create a worktree off `origin/main`, symlink `node_modules`, run the session-tracked stream worker in it, print the cleanup command. `ag-run`/`cx-run` skills now reference them. (No `ag-worktree-run.ps1` — Antigravity isn't supported on native Windows.)

### Notes
- Backend symmetry audit: all per-backend commands (`*-run`, `*-sessions`, `*-status`, `*-balance`) and runner agents already existed for ds/ag/cx; this release closes the remaining script-level gaps (Windows Codex, worktree helpers) and adds the aggregate balance view.

## [3.8.0] — 2026-06-28

### Added
- **Dashboard: jump from a Claude Code session/subagent to the cli-dispatch worker it spawned.** A runner subagent (ds/ag/cx-runner) that delegated to a worker prints the worker's session id into its transcript; the dashboard now scans for known worker ids and shows a blue **"Worker sessions (ds/ag/cx)"** panel — click a worker to open its real DeepSeek/Antigravity/Codex session flow. `/api/session/:id/flow` and `/api/subagent/:sid/:aid/flow` now include a `linkedWorkers` array. (Heuristic correlation by id occurrence; no false-positive parent tracking required.)

## [3.7.1] — 2026-06-28

### Fixed
- **Dashboard times now render in the viewer's local timezone.** Timestamps are stored as UTC on disk; the UI was slicing the raw ISO string (so a GMT+3 user saw `22:50` instead of `01:50`). Session/worker/subagent times are now formatted with `Date.toLocaleString`/`toLocaleTimeString`.

## [3.7.0] — 2026-06-28

### Added
- **Dashboard: status filter in the left rail.** A filter bar (all / busy / idle / closed, each with a live count) above the Claude Code session list; click to show only that status. Hidden on the workers tab.
- **Dashboard: subagent chips now show a start time** (HH:MM:SS) next to each subagent in the active/Subagents panels.

## [3.6.0] — 2026-06-28

### Changed
- **Dashboard now updates via Server-Sent Events instead of polling.** A new `GET /api/stream?watch=<spec>` SSE endpoint `fs.watch`es just the relevant file(s)/dir(s) and pushes a debounced `change` event; the client re-fetches only what changed. Specs: `sessions` (list — shallow watch of `~/.claude/sessions` + the workers root), `session:<id>` (its transcript + subagents dir, recursive), `subagent:<sid>:<aid>` (that transcript — near-instant streaming of an active subagent), `worker:<id>` (its dir). Replaces the fixed ~3–4s `setInterval` polling, so live views update the moment the underlying file changes; heartbeat keeps the connection alive; specs are sanitised and path-traversal-checked. Recursive watch falls back to shallow on platforms that don't support it.

## [3.5.0] — 2026-06-28

### Added
- **Dashboard: active subagents in their own live panel.** A subagent whose transcript was written in the last ~45s is treated as **active** and shown in a separate, green-accented "Active subagents" panel above the (collapsible) full "Subagents" list. Clicking an active subagent opens its flow with a **● live** badge and auto-refreshes (~3s) so you can watch what it's doing in real time. Active flag is computed server-side from the subagent transcript mtime (`active`/`lastActivityMs` on `/api/session/:id/subagents`).

## [3.4.3] — 2026-06-28

### Changed
- **Dashboard: the Subagents list is now a collapsible panel** (`▾ Subagents (N)`, macOS-Storage-style disclosure via native `<details>`). Default open; the collapsed/expanded state survives the busy-session auto-refresh.

## [3.4.2] — 2026-06-28

### Fixed
- **Dashboard: silence the `favicon.ico` 404.** Add a `/favicon.ico` → `204` route so the browser console stays clean (the only finding from a Playwright QC pass; all panels/flows/drill-down verified working).

## [3.4.1] — 2026-06-28

### Changed
- **Dashboard flow shows newest first.** Session / subagent / worker flows now render in reverse-chronological order (latest step at the top) so you don't have to scroll to the bottom to see the most recent activity.

## [3.4.0] — 2026-06-28

### Added
- **`/cli-dispatch:dashboard` — a local, read-only web dashboard.** Lists active Claude Code CLI sessions across all projects (busy ones pinned); click a session → its **flow** (messages / tool calls / results) → the **subagents** it spawned → click a subagent to drill into *its* flow (nested by spawn depth). A second panel shows the cli-dispatch **worker** delegations (DeepSeek / Antigravity / Codex) with state + flow. Busy targets auto-refresh.
  - New `dashboard-server.mjs` (Node stdlib `http`/`fs` only — no npm deps), launcher `cli-dispatch-dashboard` (+ `.ps1`), and the `dashboard` command. `install.sh`/`install.ps1` install them unconditionally (backend-agnostic).
  - Reads only on-disk data: `~/.claude/projects/**` (transcripts: `uuid`/`parentUuid`, `tool_use`↔`tool_result`, `tool_use name:"Agent"`→`toolUseResult.agentId` for subagent links), `~/.claude/sessions/*.json` (live busy/idle), and `~/.cache/cli-dispatch/sessions/**` (workers).
  - **Safety:** binds `127.0.0.1` only; strictly read-only; no config/secret access; `:id` params are sanitised and path-traversal is rejected. This is the only long-running process the plugin starts (stop via the printed `kill <pid>`). The Claude Code transcript format is internal/version-specific — unknown shapes render defensively.

## [3.3.0] — 2026-06-27

### Added
- **`cx-balance` — native Codex usage / rate limits.** `/cli-dispatch:cx-balance` reports the 5h (primary) and weekly 7d (secondary) windows as **% left** + reset time — the same numbers as `/status` in the codex TUI. Codex has no scriptable usage command, but it persists the backend's rate-limit payload into its own session records (`~/.codex/sessions/**/*.jsonl`); this reads the newest one. No network, no token handling, no third-party tool.
- **`ag-balance` — native Antigravity quota.** `/cli-dispatch:ag-balance` reports the plan + **remaining quota fraction per model** + reset time. It calls the local Antigravity **language server**'s Connect-RPC `GetUserStatus` endpoint directly — discovering the running `language_server` process, its `--csrf_token`, and listening port — instead of shelling out to a third-party tool. Requires the Antigravity language server to be running (IDE open or an `agy` session); prints a hint otherwise.
- Neither relies on any external dependency — both reverse-engineer the official local data the CLIs already expose.

## [3.2.0] — 2026-06-27

### Added
- **`ds-sessions` + `ds-status`** — the DeepSeek backend now has the same per-backend views Antigravity and Codex already had. `/cli-dispatch:ds-sessions` lists sessions filtered to `backend: deepseek`; `/cli-dispatch:ds-status` is a DeepSeek-only install/key/model health check. Fixes an asymmetry introduced in 3.0.0: when `ds-sessions`/`ds-status` were renamed to the unprefixed all-backend `sessions`/`status`, DeepSeek lost the filtered view that `ag-*`/`cx-*` kept. (Also adds the per-backend rows that were missing from the Turkish README command table.)

## [3.1.0] — 2026-06-27

### Changed
- **Shared infra moved from the `claude-ds` name to `cli-dispatch`.** The config, session cache, and parser dir — all shared across the three backends — now live under the hub's own name, instead of the DeepSeek wrapper's:
  - `~/.config/claude-ds/config` → `~/.config/cli-dispatch/config`
  - `~/.cache/claude-ds/sessions` → `~/.cache/cli-dispatch/sessions`
  - `~/.local/share/claude-ds/` → `~/.local/share/cli-dispatch/`
  - env: `CLI_DISPATCH_CONFIG` / `CLI_DISPATCH_SESSIONS_DIR` / `CLI_DISPATCH_EDITOR` (the legacy `CLAUDE_DS_*` names are still honored).
  - The **worker binary names are unchanged** (`claude-ds`, `claude-ds-stream`, `ds-agent` stay — they name the DeepSeek backend's CLI).
- **Zero-breakage migration.** `install.sh` / `install.ps1` auto-migrate an existing legacy config + sessions dir to the new paths on the next run. Independently, every wrapper/command **falls back** to the legacy `claude-ds` path at runtime when the new one is absent, so existing installs keep working even without re-running setup.

## [3.0.2] — 2026-06-27

### Changed
- **New demo GIF** (`assets/demo.gif`) reflecting the three-backend hub: a real read-only delegation to each worker (DeepSeek → Antigravity → Codex) followed by the unified `sessions` view with its `backend` column. README alt text updated. Asset-only.

## [3.0.1] — 2026-06-27

### Changed
- **`ds-delegate` skill documents the Codex backend.** The skill description + body now cover the third worker (Codex / `cx-agent` / `cx-stream`) alongside DeepSeek and Antigravity: a new "Codex (OpenAI) backend" section (real OS-level read-only sandbox, model selection, auth, `cx-runner`), updated Role/Commands lists, and new trigger phrases (`delegate to codex`, `codex/openai ile yap`). Docs-only; no behavior change.

### Notes
- Investigated a native usage/quota command for the agy and Codex backends (an `ag-balance`/`cx-balance` analog to `ds-balance`). Neither CLI exposes a scriptable balance/usage command — only in-TUI slash commands (`/usage` in agy, `/status` in codex) and web dashboards. No such command was added (a third-party tool would be required, which is out of scope).

## [3.0.0] — 2026-06-27

### Changed
- **BREAKING — cross-backend commands dropped the `ds-` prefix.** The commands that were never DeepSeek-specific are renamed: `/cli-dispatch:ds-setup` → `/cli-dispatch:setup`, `ds-sessions` → `sessions`, `ds-status` → `status`, `ds-watch` → `watch`. No aliases are kept — update any scripts/docs/muscle memory. The genuinely DeepSeek-specific commands keep their prefix: `/cli-dispatch:ds-run`, `/cli-dispatch:ds-balance` (and the per-backend `ag-run`/`cx-run`).

### Added
- **Per-backend `status` + `sessions` views.** `/cli-dispatch:ag-status` / `cx-status` (backend-scoped install/auth/model health) and `/cli-dispatch:ag-sessions` / `cx-sessions` (the session list filtered to `backend: antigravity` / `codex`). The unprefixed `/cli-dispatch:status` and `/cli-dispatch:sessions` still cover all backends at once.
- **Codex offered in the setup wizard.** `/cli-dispatch:setup` now detects `codex`, offers Codex as a backend choice, and documents its auth (`codex login` / `CODEX_API_KEY`) + smoke test. (`install.sh` already supported `--backends codex`; the wizard had not caught up.)
- Codex model docs refreshed to the current `gpt-5.x` line (`gpt-5.5` default, `gpt-5.4`, `gpt-5.4-mini` for subagents, `gpt-5.3-codex-spark`); dropped the stale `o4-mini` example. Scripts still pass `--model` through untouched (no hardcoded model).

## [2.2.0] — 2026-06-27

### Added
- **Codex (OpenAI Codex CLI) worker backend.** cli-dispatch is now a three-backend hub: alongside DeepSeek and Antigravity you can delegate to **OpenAI's Codex CLI** (`codex`, ≥ 0.142.3). New wrappers `cx-agent` (one-shot, subagent-style) and `cx-stream` (session-tracked), plus the `cx-stream-parse.mjs` parser, a `/cli-dispatch:cx-run <task>` command, and a `cx-runner` subagent.
  - `cx-stream` pipes `codex exec --json` stdout through `cx-stream-parse.mjs` (no pseudo-TTY or file-tail needed — codex has a native JSONL stream). Writes the **same session-dir layout** as the other backends (`status.json`/`meta.json`/`progress.log`/`transcript.jsonl`), keyed by codex's thread-id, so `/cli-dispatch:ds-sessions` and `/cli-dispatch:ds-watch` cover all three backends.
  - **Real OS-level read-only sandbox:** `cx-agent --read-only` passes `-s read-only` to codex, activating macOS Seatbelt / Linux bwrap+seccomp — a kernel-enforced hard-block on all file writes (not a tool-layer restriction like DeepSeek, and not absent like Antigravity). Pure analysis tasks can pass `--read-only` without worktree isolation and get a genuine no-writes guarantee.
  - Sandbox defaults to `workspace-write` for normal agentic work; override per-call with `cx-agent --read-only` or `cx-agent --sandbox <mode>`.
  - Resume via the thread-id printed on stderr: `cx-agent --resume <thread-id> --cwd <dir> "<follow-up>"`. Always re-pass `--cwd` on resume (codex reloads workspace from the thread but needs the directory explicitly).
  - **Auth:** `codex login` (ChatGPT/OAuth — no key needed for personal use) or `CODEX_API_KEY` (takes precedence over `OPENAI_API_KEY`). Config variable for the default model: `CX_MODEL` (with `CODEX_MODEL` as fallback); blank = codex's own default (varies by version, not hardcoded here).
  - **`cx-runner` subagent** (`agents/cx-runner.md`): babysitter-model agent (haiku/sonnet by difficulty) that manages a full cx-agent delegation in a sub-context — picks mode, isolates in a git worktree for code tasks, verifies (build/test), and returns a concise verdict.
- **Backend selection extended.** `install.sh --backends` now accepts `codex` as a keyword; `all` expands to `deepseek,antigravity,codex`. The config skeleton gains a Codex section documenting `CODEX_API_KEY`, `CX_MODEL`, and sandbox options.

## [2.1.0] — 2026-06-26

### Added
- **Antigravity (Gemini) worker backend.** cli-dispatch is now genuinely multi-backend: alongside DeepSeek you can delegate to Google's **Antigravity CLI** (`agy`). New wrappers `ag-agent` (one-shot, subagent-style) and `ag-stream` (session-tracked), plus the `ag-transcript-parse.mjs` parser and a `/cli-dispatch:ag-run <task>` command.
  - agy has no `--output-format json` and a non-TTY silent-drop bug, so `ag-stream` runs it under a **pseudo-TTY** (`script`) and **tails agy's on-disk JSONL transcript** (`transcript_full.jsonl`) for live progress + the final answer — instead of parsing stdout.
  - Writes the **same session-dir layout** as the DeepSeek backend (`status.json`/`meta.json`/`progress.log`), keyed by agy's conversation-id, so `/cli-dispatch:ds-sessions` and `/cli-dispatch:ds-watch` work for both backends (sessions now show a `backend` column). Resume via `ag-agent --resume <conv-id>`. Reuses the runtime/idle-timeout watchdog and worktree isolation.
  - Registers `--cwd` as agy's active workspace (`--add-dir`) so files land in the target dir, not agy's scratch dir. No read-only mode: agy has no tool-level write-deny (`--sandbox` restricts the terminal, not file writes — tested), so `--read-only` is rejected; isolate in a throwaway/worktree `--cwd` and review the diff for a no-writes guarantee.
  - **Auth:** Google sign-in (run `agy` once) or `GEMINI_API_KEY` / `ANTIGRAVITY_API_KEY`.
  - **Model selection:** `--model "<name>"` (or the `AG_MODEL` config default) passes through to agy, which proxies multiple families — verified routing to `Gemini 3.5 Flash`, `Gemini 3.1 Pro`, `Claude Sonnet 4.6`, `Claude Opus 4.6`, and `GPT-OSS 120B` (each with reasoning tiers; exact display names from `agy models`; default `Gemini 3.5 Flash (High)`). ag-stream warns when a `--model` value isn't in `agy models` (agy otherwise silently falls back to its default).
- **Backend selection at setup.** `/cli-dispatch:ds-setup` now asks which backend(s) to install (DeepSeek, Antigravity, or both); `install.sh` gained `--backends deepseek,antigravity|all`. The config skeleton holds an optional Gemini section; existing configs are never clobbered.

### Notes
- Native Windows installs the DeepSeek backend only — the Antigravity backend needs a pseudo-TTY (`script`), so use WSL for it.
- **Timeout semantics differ from the DeepSeek backend.** agy spawns detached worker processes and runs under a pty, so an external process-tree kill is not a reliable stop (verified: SIGKILL on the whole tracked tree left agy working). `--max-runtime` is therefore enforced via agy's own `--print-timeout` (a per-model-wait cap, so total wall-time may exceed it), with the watchdog as a best-effort backstop only; `--idle-timeout` is best-effort. A capped run may report `done` (partial) or `error`. For a strict wall-clock bound, wrap the call in `timeout(1)` and isolate in a worktree.
- **No `--read-only`** on the Antigravity backend (agy has no tool-level write-deny; `--sandbox` does not block file writes). The watchdog kill path is hardened with a snapshot-based killer (captures the subtree before signalling) since agy ignores SIGTERM and reparents to init, and the discovery-failure path now kills a startup-hung agy instead of waiting forever.

## [2.0.0] — 2026-06-23

### Changed (BREAKING)
- **Renamed the plugin and marketplace `claude-ds` → `cli-dispatch`**, repositioning it as a multi-backend delegation hub (a task is dispatched to the right worker CLI). DeepSeek-backed Claude Code is now "the DeepSeek backend"; future worker CLIs (e.g. Antigravity `agy`) can be added as additional backends.
- **Commands are now `ds-` prefixed** under the new namespace (the `ds-` marks the DeepSeek backend): `/claude-ds:setup` → `/cli-dispatch:ds-setup`, and likewise `ds-run`, `ds-sessions`, `ds-watch`, `ds-status`, `ds-balance`. The umbrella delegation skill `claude-ds` is now `ds-delegate`. The `ds-runner` subagent keeps its name (now under `cli-dispatch:`).
- Repo references updated to `rbinar/cli-dispatch`; install is now `/plugin marketplace add rbinar/cli-dispatch` then `/plugin install cli-dispatch@cli-dispatch`.

### Unchanged
- The backend wrapper binaries keep their names (`claude-ds`, `claude-ds-stream`, `ds-agent`) and install paths: config `~/.config/claude-ds/config`, parser `~/.local/share/claude-ds/`, sessions `~/.cache/claude-ds/`, and the `CLAUDE_DS_*` env vars. These are backend-specific (the DeepSeek backend is named `claude-ds`), so they do not change when new backends are added.

## [1.7.2] — 2026-06-22

### Fixed
- **Windows / Turkish locale:** the PowerShell wrappers parsed the config with a case-insensitive `-match`, which under the `tr-TR` locale folds `I` to the dotless `ı` — so the `I` in `DEEPSEEK_API_KEY` made that line never match and the key was silently dropped (`DEEPSEEK_API_KEY not set` despite a valid key). Switched the config parser in `claude-ds.ps1` and `claude-ds-stream.ps1` to case-sensitive `-cmatch`, and hardened the empty-key check in `install.ps1`.

## [1.7.1] — 2026-06-21

### Changed
- Removed the external-service / "only when the user explicitly asks" warnings from `TERMINAL.md`, the skill, and the `run`/`setup` commands so claude-ds delegation is no longer discouraged.

## [1.7.0] — 2026-06-19

### Added
- **`ds-runner` subagent** (`agents/ds-runner.md`). Offloads a DeepSeek delegation into a
  sub-context: it picks the mode, isolates the work, **verifies it**, and returns a concise
  result — keeping the orchestrator's context clean. It runs the worker via the `ds-*` CLIs
  (`ds-agent` / `ds-worktree-run.sh`) over **Bash**, so the worker is always DeepSeek while
  the agent's own (babysitter) model is chosen **per call by the orchestrator**:
  `model="haiku"` for pure generation/analysis (the frontmatter default), `model="sonnet"`
  for repo/code tasks needing real build/test verification or diff review.
  - Pure generation/analysis → `ds-agent --read-only`, return the answer (no verification).
  - Repo/code task → isolate in a git worktree, run independent checks (typecheck/build/test),
    return a verdict + diff location; commit/merge stays with the orchestrator/human.

## [1.6.0] — 2026-06-19

### Added
- **`ds-agent` — single-command, subagent-style wrapper.** Give it a task and it runs to
  completion synchronously, streams tool activity to **stderr**, and prints **only the final
  answer to stdout** (safe to capture/pipe). Default agentic (may write/run in `--cwd`);
  `--read-only` for analysis-only. Forwards `--cwd` / `--resume` / `--max-runtime` /
  `--idle-timeout`; reads the task from a positional arg, `-p`, or stdin; `-q` silences the
  banner. Installed to `~/.local/bin/ds-agent` (+ `.ps1`/`.cmd` on Windows).
- Parser: opt-in `CLAUDE_DS_PROGRESS_STDERR=1` mirrors each progress line to stderr (used by
  `ds-agent` for live activity), without touching stdout or changing default behavior.

## [1.5.3] — 2026-06-19

### Performance
- Tool-heavy sessions: `progress.log` now uses a single held file descriptor (like the
  transcript), and `status.json` writes are throttled to ~200ms (it's a polled snapshot;
  `finalize` forces a final write). A 5000-tool stream went from real 0.63s / sys 0.50s to
  real 0.07s / sys 0.02s (~9× wall, ~25× syscalls). Final state and `toolCounts` are
  unchanged, and idle detection is unaffected (it keys off `transcript.jsonl`).

## [1.5.2] — 2026-06-19

### Performance
- The parser now writes the transcript through a single held file descriptor instead of
  re-opening the file on every line (`appendFileSync`). On a 50k-line stream this cut wall
  time ~7× (1.08s → 0.16s) and syscall time ~15×. Correctness is unchanged — chunk-boundary
  reassembly, split multibyte (UTF-8) characters, and resume-append were all verified
  identical, and the idle-timeout watchdog still works (mtime updates on each write).

## [1.5.1] — 2026-06-19

### Added
- **PowerShell timeout enforcement.** The Windows wrapper now actually enforces
  `--max-runtime` / `--idle-timeout` (previously recognized-but-ignored). A background-job
  watchdog locates the worker by its unique `--session-id` + `stream-json` invocation in the
  process command line, monitors elapsed time and `transcript.jsonl` activity, and on breach
  kills the worker **and its child tree** with `taskkill /PID <pid> /T /F` (the Windows
  equivalent of bash's `kill_tree`), then reconciles the session to `error`.

> Note: the PowerShell path is verified by inspection only — there was no `pwsh`/Windows on
> the development machine. Bash remains the runtime-tested path.

## [1.5.0] — 2026-06-19

### Added
- **Runtime / idle timeouts** for `claude-ds-stream`: `--max-runtime <s>` and
  `--idle-timeout <s>` (env fallbacks `CLAUDE_DS_MAX_RUNTIME` / `CLAUDE_DS_IDLE_TIMEOUT`;
  both default `0` = off). A background watchdog kills a hung/runaway worker when it exceeds
  the overall runtime cap or stalls with no new output (idle measured from `transcript.jsonl`
  activity). Timed-out sessions are marked `state: error` with `error: "timeout: …"`.
- The watchdog kills the worker **and its descendants** (`kill_tree` via `pgrep`), mirroring
  octo-ai's `kill(-pid)`. Killing only the parent could leave a child (a Bash tool subprocess,
  an MCP server) holding the stdout pipe open, hanging the wrapper.

### Changed
- The worker now runs backgrounded with its PID captured (prompt fed via process
  substitution) so the watchdog can target it; the subshell still `cd`s into the working
  directory and exits with the worker's real exit code.

### Fixed
- Non-integer timeout values are coerced to `0` (off) so the guard can't crash under `set -e`.

## [1.4.0] — 2026-06-19

### Added
- **`--read-only` mode.** Restricts the worker to a read-only tool set via `--tools
  Read,Grep,Glob` (RESTRICTIVE — replaces the built-in tool set, so Write/Edit/Bash are
  unavailable even under `bypassPermissions`).

### Security
- **Default `--strict-mcp-config`.** The delegated worker no longer inherits the user's global
  `~/.claude` MCP servers. Previously a run could drive `playwright`
  (`browser_run_code_unsafe` = arbitrary code execution), `whatsapp`, `gmail`, `jira`, etc.
  To add MCP servers deliberately, pass `--mcp-config <file>` (strict honors that).

### Fixed
- **cwd isolation:** `--cwd` now actually sets the worker's working directory (subshell `cd`),
  matching octo-ai's `spawn({ cwd })`. Previously files landed in the wrapper's cwd (repo
  root), which also defeated worktree isolation.
- **Argument parsing:** value-consuming flags (`--cwd` / `--resume` / `-p`) at the end of argv
  no longer crash with a cryptic `set -u` "unbound variable"; a friendly error is shown.
- **Failure state:** a worker crash / nonzero exit / bad cwd is now reported as
  `state: error` (with exit code) instead of a misleading `done`.
- **Exit code:** capture the worker's exit (`PIPESTATUS[1]`) instead of `printf`'s.
- **Resume:** a stale `error` field is cleared from `meta.json` on a subsequent successful resume.

### Changed
- Docs (SKILL.md / README / run.md) clarify the default mode is **not a sandbox**
  (`bypassPermissions` is always on → the worker can write files / run bash); use worktree
  isolation for repo tasks and `--read-only` for guaranteed no-writes.

## [1.3.0] — 2026-06-19

### Added
- **`claude-ds-stream` — stream-json session tracking.** A session-tracked variant of the
  wrapper that runs the Claude Code CLI with `--output-format stream-json` and parses the
  JSONL output into a per-session directory
  (`~/.cache/claude-ds/sessions/<id>/`):
  - `status.json` — compact rolling summary (the only file polled, for cost-conscious monitoring)
  - `progress.log` — terse human-readable stream (tool calls + truncated text)
  - `transcript.jsonl` — raw stream-json (resume/audit)
  - `meta.json` — prompt preview, cwd, branch, model, start/end
- **Resume:** continue the same DeepSeek session with `claude-ds-stream --resume <id> -p "…"`.
- **Commands:** `/claude-ds:sessions` (list sessions) and `/claude-ds:watch <id>` (compact live status).
- Cross-platform Node parser (`ds-stream-parse.mjs`) shared by the bash and PowerShell wrappers.

### Changed
- Localized all plugin docs, commands, and script comments to **English** (the `README.md`
  stays in Turkish by request).

## [1.2.0] — 2026-06-18

### Added
- **`/claude-ds:balance`** — query and display the DeepSeek account balance.
- Setup now auto-opens the config in the platform's default editor while the API key is empty.

### Changed
- Installation docs clarified: run the slash commands inside the Claude Code CLI, one at a
  time, with an explicit `/reload-plugins` step. Added an uninstall guide to the README.

## [1.1.0] — 2026-06-18

### Added
- **Windows support.** PowerShell variants of the wrapper, installer, and worktree helper
  (`claude-ds.ps1`, `install.ps1`, `ds-worktree-run.ps1`), plus a `.cmd` shim so `claude-ds`
  is callable from cmd/PowerShell. The worktree helper uses a junction instead of a symlink
  for `node_modules` (no admin/developer-mode required).

## [1.0.0] — 2026-06-18

### Added
- Initial release. A portable `claude-ds` wrapper that runs the Claude Code CLI against
  DeepSeek's Anthropic-compatible API, so tasks can be delegated to DeepSeek as a worker
  (the built-in Agent/subagent tool can't target DeepSeek).
- Skill + commands: `/claude-ds:setup`, `/claude-ds:run`, `/claude-ds:status`.
- `ds-worktree-run.sh` helper to run agentic tasks in an isolated git worktree, leaving the
  diff uncommitted for review.
