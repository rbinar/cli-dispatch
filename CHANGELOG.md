# Changelog

All notable changes to **cli-dispatch** (formerly **claude-ds**) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: the `README.md` is in Turkish by design; this changelog and all other docs are in English.

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
