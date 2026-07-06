# Changelog

All notable changes to **cli-dispatch** (formerly **claude-ds**) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: the `README.md` is in Turkish by design; this changelog and all other docs are in English.

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
