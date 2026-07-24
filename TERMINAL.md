# Terminal Commands — DeepSeek backend

> Scope: the **DeepSeek** wrappers only. The other four backends (`ag-`/`cx-`/`oc-`/`cp-`)
> are driven from inside Claude Code — see [README.md](README.md).

## Introduction

`claude-ds` (the DeepSeek backend of the **cli-dispatch** plugin) makes DeepSeek runnable as a delegate worker straight from the terminal. It wraps the Claude Code CLI so all model slots route through DeepSeek's Anthropic-compatible API. The architectural split: **DeepSeek is the worker** (executes tasks, writes code, runs commands); **you are the orchestrator** (review output, own git history, approve merges).

This document covers only the terminal-runnable commands. Three DeepSeek executables land in `~/.local/bin` (`claude-ds`, `claude-ds-stream`, `ds-agent`), plus the worktree script (`ds-worktree-run.sh`) — those are the DeepSeek-specific ones this document explains.

`install.sh` also installs backend-agnostic tools regardless of which backend you picked, and they work from a shell too:

| Tool | What it does |
|---|---|
| `cli-dispatch-run` | **The deterministic runner** — launches a worker, isolates it in a git worktree, runs your `--verify` command itself, writes `verdict.json`. This is the delegation path; the LLM babysitter subagents were retired in 4.0.0. |
| `cli-dispatch-wait` | Blocks until a session reaches a terminal state, then prints a compact summary (silent while polling). |
| `cli-dispatch-clean` | Prunes stale (`running`-but-dead) session dirs and leftover worktree artifacts. |
| `cli-dispatch-gain` | Reports worker token totals per backend. |
| `cli-dispatch-dashboard` | Serves the local read-only web dashboard. |

See [README.md](README.md) for `cli-dispatch-run`'s full flag set and the escalation path.

## How it works

The `claude-ds` binary is a thin bash wrapper. Before exec'ing `claude`, it injects environment variables that repoint Claude Code's CLI at DeepSeek's Anthropic-compatible API endpoint:

```
ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
ANTHROPIC_MODEL="${DS_MODEL:-deepseek-v4-pro}"
ANTHROPIC_DEFAULT_OPUS_MODEL="${DS_MODEL:-deepseek-v4-pro}"
ANTHROPIC_DEFAULT_SONNET_MODEL="${DS_MODEL:-deepseek-v4-pro}"
ANTHROPIC_DEFAULT_HAIKU_MODEL="${DS_FLASH_MODEL:-deepseek-v4-flash}"
CLAUDE_CODE_SUBAGENT_MODEL="${DS_FLASH_MODEL:-deepseek-v4-flash}"
```

The API key lives in `~/.config/cli-dispatch/config` (mode 0600, never committed). All primary model slots map to `deepseek-v4-pro`; the haiku/subagent slot maps to `deepseek-v4-flash`.

The `claude-ds-stream` variant adds session tracking: it runs `claude` with stream-json output and pipes through a Node.js parser (`ds-stream-parse.mjs`) that writes structured session files (status.json, progress.log, transcript.jsonl, meta.json) to `~/.cache/cli-dispatch/sessions/<id>/`.

## Setup

Three terminal steps. (`claude` CLI and `node` must already be installed.)

### 1. Run the installer

From the cloned repo, run `install.sh` directly:

```
bash plugins/cli-dispatch/scripts/install.sh
```

It installs:

| File | Destination |
|---|---|
| `claude-ds` | `~/.local/bin/claude-ds` |
| `claude-ds-stream` | `~/.local/bin/claude-ds-stream` |
| `ds-agent` | `~/.local/bin/ds-agent` |
| `ds-stream-parse.mjs` | `~/.local/share/cli-dispatch/ds-stream-parse.mjs` |

If the config file does not exist, the installer creates a skeleton at `~/.config/cli-dispatch/config` (mode 0600) and auto-opens it in the platform editor (macOS: `open`, Linux: `xdg-open`, WSL: `explorer.exe`; override with `CLI_DISPATCH_EDITOR`). It warns if `~/.local/bin` is not in `PATH`. Windows: run `install.ps1` instead.

### 2. Add API key

Get a key from https://platform.deepseek.com/api_keys, then add it to `~/.config/cli-dispatch/config`:

```
DEEPSEEK_API_KEY="sk-..."
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

### 3. Verify PATH

Ensure `~/.local/bin` is in `PATH`:

```
echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin" && echo ok || echo 'add ~/.local/bin to PATH'
claude-ds -p "Reply with exactly: OK"
```

## Terminal commands

### `claude-ds`

Thin environment wrapper. Passes all arguments through to `claude`. No custom flags of its own.

```
claude-ds [any claude CLI flags]
```

Example:

```
claude-ds -p "Reply with exactly: OK"
```

### `claude-ds-stream`

Session-tracked variant. Runs `claude` with stream-json output, pipes through `ds-stream-parse.mjs` which writes session files to `~/.cache/cli-dispatch/sessions/<id>/`.

```
claude-ds-stream [--cwd <dir>] [--resume <id>] [--read-only] \
                 [--max-runtime <s>] [--idle-timeout <s>] -p "<prompt>" [extra claude flags]

echo "<prompt>" | claude-ds-stream [--cwd <dir>]
```

| Flag | Description |
|---|---|
| `--cwd <dir>` | Work in `<dir>` (also accepts `--cwd=<dir>`) |
| `--resume <id>` | Resume an existing session (also `--resume=<id>`) |
| `-p`, `--prompt <text>` | Prompt text (also `-p=<text>`, `--prompt=<text>`) |
| `--read-only` | Restrict worker to Read/Grep/Glob tools only (no writes) |
| `--max-runtime <s>` | Kill worker after `<s>` seconds total (0 = off; env: `CLAUDE_DS_MAX_RUNTIME`) |
| `--idle-timeout <s>` | Kill worker after `<s>` seconds with no output (0 = off; env: `CLAUDE_DS_IDLE_TIMEOUT`) |

Any other flags are forwarded to `claude`.

Behavior notes:

- Worker runs with `--permission-mode bypassPermissions` by default (can write files, run bash).
- `--read-only` uses `--tools "Read,Grep,Glob"` (replaces the built-in toolset; `--disallowed-tools` does not work under `bypassPermissions`).
- Uses `--strict-mcp-config` so the worker does not inherit global MCP servers.
- Requires `node` for the parser.

Environment overrides:

| Variable | Purpose |
|---|---|
| `CLI_DISPATCH_CONFIG` | Override config file path |
| `CLI_DISPATCH_SESSIONS_DIR` | Override session directory |
| `CLI_DISPATCH_PARSER` | Override path to `ds-stream-parse.mjs` |
| `CLAUDE_DS_MAX_RUNTIME` | Default `--max-runtime` value |
| `CLAUDE_DS_IDLE_TIMEOUT` | Default `--idle-timeout` value |
| `CLAUDE_DS_PROGRESS_STDERR` | Progress output goes to stderr |

### `ds-agent`

Thin synchronous wrapper over `claude-ds-stream`. Blocks until complete, shows tool activity on stderr, prints only the final answer on stdout.

```
ds-agent [--read-only] [--cwd <dir>] [--resume <id>] [--max-runtime <s>] [--idle-timeout <s>] [-q] "<task>"

echo "<task>" | ds-agent
ds-agent -p "<task>"
```

| Flag | Description |
|---|---|
| `--read-only` | Analysis only; no writes/bash |
| `--cwd <dir>` | Work in `<dir>` |
| `--resume <id>` | Continue an existing session |
| `--max-runtime <s>` | Forward to `claude-ds-stream` |
| `--idle-timeout <s>` | Forward to `claude-ds-stream` |
| `-q`, `--quiet` | Suppress progress header and stderr mirroring |
| `-p`, `--prompt <text>` | Explicit prompt (alternative to positional arg) |
| `-h`, `--help` | Print usage |

Without `--read-only`, adds `--dangerously-skip-permissions` (agentic mode).

### `ds-worktree-run.sh`

Isolated worktree runner. **Not installed to PATH** — invoked by path from the `scripts/` directory.

```
plugins/cli-dispatch/scripts/ds-worktree-run.sh <repo-path> <branch> <brief-file>
```

Behavior:

1. Creates an isolated git worktree under `/tmp/ds-wt-XXXXXX`, based on `<repo-path>`'s current
   branch (falling back to `origin/HEAD`, then `origin/main`)
2. Symlinks `node_modules` from the main repo if present
3. Runs `claude-ds-stream --cwd <worktree> --dangerously-skip-permissions -p "$(cat <brief-file>)"`
4. Prints worktree path and cleanup instructions; runs `git status --short`
5. Checks the main checkout gained no new changes — a worker that wrote outside the tree it was
   given exits 1 with a patch saved under `$TMPDIR`
6. Does **not** commit or merge — the orchestrator handles that

**In-place mode.** If `<repo-path>` is already a linked worktree, steps 1–2 are skipped and the
worker runs in that directory directly — no nested worktree, and the script creates and removes
nothing there. The leak check in step 5 then watches the **main** checkout instead. Force the
nested behavior with `CLI_DISPATCH_NO_IN_PLACE=1`.

Cleanup (printed by the script, nested mode only):

```
rm -f "<worktree>/node_modules"
git -C "<repo>" worktree remove "<worktree>" --force
git -C "<repo>" worktree prune
```

Post-check only, without running a worker:

```
plugins/cli-dispatch/scripts/ds-worktree-run.sh --post-check <repo-path>
```

Windows equivalent: `ds-worktree-run.ps1` (uses junction instead of symlink for `node_modules`).

## Session tracking

All session files live under `~/.cache/cli-dispatch/sessions/<id>/`:

| File | Purpose |
|---|---|
| `status.json` | Compact summary: state, last tool, tool counts, result preview. Main monitoring file. |
| `progress.log` | Terse human-readable stream of tool activity |
| `transcript.jsonl` | Raw stream-json output (for resume/audit; not for live monitoring) |
| `meta.json` | Prompt preview, cwd, branch, model, start/end times |

For cost-conscious monitoring, read **only `status.json`**. Do not tail `transcript.jsonl` — it is a raw JSONL stream intended for replay, not live consumption.

## Configuration reference

Config file: `~/.config/cli-dispatch/config` (mode 0600, never committed).

```
DEEPSEEK_API_KEY="sk-..."
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `DS_MODEL` | Model for opus/sonnet/default slots (default: `deepseek-v4-pro`) |
| `DS_FLASH_MODEL` | Model for haiku/subagent slot (default: `deepseek-v4-flash`) |

Environment overrides:

| Variable | Overrides |
|---|---|
| `CLI_DISPATCH_CONFIG` | Config file path |
| `CLI_DISPATCH_SESSIONS_DIR` | Session directory |
| `CLI_DISPATCH_PARSER` | Path to `ds-stream-parse.mjs` |
| `CLAUDE_DS_MAX_RUNTIME` | Default max runtime (seconds) |
| `CLAUDE_DS_IDLE_TIMEOUT` | Default idle timeout (seconds) |
| `CLI_DISPATCH_EDITOR` | Editor for opening config during setup |

## Security notes

- The API key never leaves `~/.config/cli-dispatch/config`. The file is mode 0600 and not committed to version control.
- Real repo tasks should use worktree isolation via `ds-worktree-run.sh`. The worktree runs in `/tmp/ds-wt-XXXXXX` and never commits or merges automatically.
- `--read-only` guarantees no writes: it restricts the worker to `Read`, `Grep`, and `Glob` tools only. Bash and write tools are excluded.
- Workers run with `--strict-mcp-config` and do not inherit global MCP servers from the orchestrator's Claude Code session.
