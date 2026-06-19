# Changelog

All notable changes to **claude-ds** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: the `README.md` is in Turkish by design; this changelog and all other docs are in English.

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
