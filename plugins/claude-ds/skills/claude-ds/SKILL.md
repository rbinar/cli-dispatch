---
name: claude-ds
description: |
  Delegate a coding or agentic task to claude-ds — a DeepSeek-backed Claude Code
  CLI — as a worker. Use to run/delegate work via
  claude-ds or DeepSeek. Covers invocation
  (generation vs full-agentic), running as a background task, isolating real-repo work
  in a git worktree, and review/verify/merge of the output. The built-in Agent/subagent
  tool canNOT use DeepSeek (model enum is Anthropic-only) — claude-ds is the only path.
  Triggers: "claude-ds", "delegate to claude-ds", "run with deepseek" (also Turkish:
  "deepseek ile yap/çalıştır", "delege et claude-ds").
user-invocable: true
---

# claude-ds — DeepSeek delegation worker

`claude-ds` is a portable wrapper installed to `~/.local/bin` by `/claude-ds:setup`;
it runs the Claude Code CLI against DeepSeek's Anthropic-compatible API. Since it's on
PATH, call it **directly as `claude-ds`** (no old `zsh -ic` function trick needed).

## When / when not
- The built-in `Agent`/subagent tool does **NOT support** DeepSeek (`model` enum: sonnet/opus/haiku/fable).
  This is the only way to hand work to DeepSeek.
- Conversation context is **not shared** → the prompt must be **self-contained**.

## Wrappers
- **`ds-agent`** (SIMPLEST — subagent-style) — one synchronous command: give it a task, it
  runs to completion, streams tool activity to stderr, and prints **only the final answer to
  stdout**. Default agentic (may write/run in `--cwd`); `--read-only` for analysis-only.
  Best when you just want "delegate this and give me the result" in a single call.
- **`claude-ds-stream`** — runs `claude` with stream-json, parses output into a **session
  directory** (live + observable + resumable). Use when you want to run in the background and
  poll, or need the session id / `--resume` / `/claude-ds:watch` workflow.
- **`claude-ds`** — plain env wrapper (`claude "$@"`). No parsing/session; fast one-shot only.

### ds-agent — single command (subagent-style)
```bash
ds-agent "<task>"                     # agentic in cwd; live progress on stderr; answer on stdout
ds-agent --read-only "<question>"     # no writes / no bash
ds-agent --cwd <dir> "<task>"         # work in <dir> (use an isolated dir for safety)
ds-agent --resume <id> "<follow-up>"  # continue a session
echo "<task>" | ds-agent              # task via stdin
```
stdout = final answer only (safe to capture/pipe); stderr = banner + live tool activity.
Exit code is the worker's. `-q` silences the banner/progress. It forwards
`--max-runtime`/`--idle-timeout` to the underlying `claude-ds-stream`.

Session directory: `${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions/<id>/`
- `status.json` — compact rolling summary (**the only file to poll**: state, lastTool, toolCounts, finalResultPreview)
- `progress.log` — terse human-readable stream (`▸ Edit foo.ts`, `✓/✗`, truncated text)
- `transcript.jsonl` — raw stream-json (resume/audit; **NOT read while polling**)
- `meta.json` — prompt preview, cwd, branch, model, start/end

## Offloading to the `ds-runner` subagent (keep your context clean)
Instead of running the `ds-*` CLIs yourself and babysitting them, you can hand the whole
delegation to the bundled **`ds-runner`** subagent. It runs/monitors/isolates/**verifies**
the DeepSeek work in its own context and returns a short result — the management churn never
enters yours. Pick its model by difficulty (the worker stays DeepSeek either way):
```
Agent(subagent_type="ds-runner", model="haiku",  prompt="<self-contained task>")  # pure gen/analysis (default)
Agent(subagent_type="ds-runner", model="sonnet", prompt="<self-contained repo/code task>")  # needs build/test verification
```
Worth it for long/agentic tasks, verification, or running several in parallel. For a quick
one-shot, just call `ds-agent` directly (the subagent's extra model layer isn't worth it).

## Run rules
- **Always run as a background task**: Bash tool `run_in_background: true` (don't block).
- For a **long prompt**, write the brief to a file and pass it with `-p "$(cat <brieffile>)"`.
- **Cost-conscious monitoring (MANDATORY):** track progress by reading only the small `status.json`
  (`/claude-ds:watch <id>`). Don't read the raw `transcript.jsonl`; don't tail it repeatedly in a
  tight loop; check once per orchestration step. When the task finishes you get re-invoked anyway.
- **Windows:** after setup, `claude-ds` / `claude-ds-stream` are called directly (`.cmd` shim);
  the parser `.mjs` is shared cross-platform. On macOS/Linux/WSL the `.sh` variants apply.

> **Not a sandbox by default.** The wrapper always runs with `--permission-mode
> bypassPermissions` (the CLI can't prompt in non-interactive `--print` mode), so the
> worker **can write files and run bash even without `--dangerously-skip-permissions`**.
> "Generation mode" is a convention (you didn't give it a file task), not an enforced
> sandbox. For real-repo tasks, isolate in a worktree. For guaranteed no-writes, use `--read-only`.

### Mode 1 — Generation (code/text/analysis)
```bash
claude-ds-stream -p "<self-contained prompt>"
```
The final text goes to stdout, progress goes to the session directory. Session id on stderr.
The worker *can* still write files if the prompt leads it to — add `--read-only` to forbid that.

### Mode 1-safe — True read-only (denies Write/Edit/Bash; nothing mutated)
```bash
claude-ds-stream --read-only -p "<analysis/generation prompt>"
```
Use when the output must be text-only and the worker must not touch disk.

### Mode 2 — Full agentic (writes files + runs bash)
```bash
claude-ds-stream --cwd <dir> --dangerously-skip-permissions -p "$(cat /tmp/ds-brief.txt)"
```
Writes files / runs bash → **you MUST isolate it** (worktree). (`--dangerously-skip-permissions`
is largely redundant with the default bypassPermissions; it signals intent and matches the worktree helper.)

### Follow-up / resume (continue the same DeepSeek session)
```bash
claude-ds-stream --resume <session-id> -p "<follow-up>"
```
The transcript is appended to the same session; `status.json` is updated. See sessions: `/claude-ds:sessions`.

### Timeouts (safety net for hung/runaway workers)
```bash
claude-ds-stream --max-runtime 600 --idle-timeout 90 -p "<prompt>"   # seconds; 0 = off (default)
```
A background watchdog kills the worker (and its child processes) if it exceeds the overall
runtime cap (`--max-runtime`) or stalls with no new output (`--idle-timeout`, measured from
`transcript.jsonl` activity). Timed-out sessions are marked `state: error` with
`error: "timeout: …"`. Env fallbacks: `CLAUDE_DS_MAX_RUNTIME`, `CLAUDE_DS_IDLE_TIMEOUT`.
Both default off. Enforced on both wrappers — bash via a `kill_tree` watchdog, PowerShell
via a background-job watchdog that locates the worker by its session id and kills the tree
with `taskkill /T /F`.

## Safe operation for a real repo task (MANDATORY)
Use the bundled helper:
```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/ds-worktree-run.sh" <repo> <branch> <brief-file>
```
This script: opens an isolated git worktree (origin/main), symlinks `node_modules` if present,
runs **claude-ds-stream** in Mode 2 inside the worktree (session-tracked), and leaves the diff
**UNCOMMITTED**. The session id is printed on stderr → watch it with `/claude-ds:watch <id>`.

Then **YOU are the reviewer:**
1. Review the FULL diff with `git -C <worktree> status && git -C <worktree> diff` — check for
   side effects, confirm only the target files were touched.
2. Run tsc/build/test **yourself** (independent verification).
3. If all good, YOU do the git: commit → push → PR → merge → `git pull origin main` on the main checkout.
   Note in the commit body that "implementation was delegated to claude-ds (DeepSeek)" (transparency).
4. Cleanup: `rm <worktree>/node_modules` → `git worktree remove <worktree> --force` → `git worktree prune`.

## Role
claude-ds = worker (generation/implementation), you = orchestrator + reviewer + git/merge owner.
Don't trust any output until verified.

## Commands
- `/claude-ds:setup` — install the wrappers (`claude-ds` + `claude-ds-stream` + parser) + config + smoke test.
- `/claude-ds:run <task>` — delegate a task (worktree isolation for repo tasks, session-tracked).
- `/claude-ds:sessions` — list past/active sessions.
- `/claude-ds:watch <id>` — show a session's compact live status (cost-conscious).
- `/claude-ds:status` — check installation/key/CLI status.
- `/claude-ds:balance` — show the DeepSeek account balance.
