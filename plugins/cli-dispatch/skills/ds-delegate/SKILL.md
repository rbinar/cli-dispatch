---
name: ds-delegate
description: |
  Delegate a coding or agentic task to claude-ds — a DeepSeek-backed Claude Code
  CLI — as a worker. Use to run/delegate work via
  claude-ds or DeepSeek. Covers invocation
  (generation vs full-agentic), running as a background task, isolating real-repo work
  in a git worktree, and review/verify/merge of the output. The built-in Agent/subagent
  tool canNOT use DeepSeek (model enum is Anthropic-only) — claude-ds is the only path.
  cli-dispatch is multi-backend: a second worker, **Antigravity (agy / Gemini)**, is
  available via `ag-agent` / `ag-stream`, a third, **Codex (OpenAI Codex CLI)**, via
  `cx-agent` / `cx-stream`, a fourth, **OpenCode (via OpenRouter)**, via
  `oc-agent` / `oc-stream`, and a fifth, **GitHub Copilot**, via `cp-agent` /
  `cp-stream` (see the "Other backends" section below).
  Codex adds a real OS-level read-only sandbox (`cx-agent --read-only`).
  Triggers: "claude-ds", "delegate to claude-ds", "run with deepseek", "delegate to
  antigravity/gemini", "run with agy", "delegate to codex", "run with codex/openai",
  "delegate to opencode", "run with opencode/openrouter", "delegate to copilot",
  "run with github copilot" (also
  Turkish: "deepseek ile yap/çalıştır", "gemini/antigravity ile yap", "codex/openai ile
  yap", "opencode/openrouter ile yap", "copilot ile yap/çalıştır", "delegate to copilot",
  "delege et claude-ds").
user-invocable: true
---

# claude-ds — DeepSeek delegation worker

`claude-ds` is a portable wrapper installed to `~/.local/bin` by `/cli-dispatch:setup`;
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
  poll, or need the session id / `--resume` / `/cli-dispatch:watch` workflow.
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

Session directory: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (legacy `claude-ds` path still read as a fallback)
- `status.json` — compact rolling summary (**the only file to poll**: state, lastTool, toolCounts, finalResultPreview)
- `progress.log` — terse human-readable stream (`▸ Edit foo.ts`, `✓/✗`, truncated text)
- `transcript.jsonl` — raw stream-json (resume/audit; **NOT read while polling**)
- `meta.json` — prompt preview, cwd, branch, model, start/end

## The deterministic runner (`/cli-dispatch:run`) — no LLM babysitter
There is no `ds-runner` subagent anymore — running/monitoring/isolating/verifying a DeepSeek
delegation inside its own LLM sub-context measured at ~9x the worker's own output in Anthropic
tokens for zero quality gain, which defeated the point of delegating at all (issue #114). For
mechanical work with a machine-checkable verify command, route it through the deterministic
runner instead:
```
/cli-dispatch:run ds "<self-contained task>" --verify '<cmd>'
```
`cli-dispatch-run` launches DeepSeek, isolates repo work in a git worktree, blocks until it
finishes (or times out), runs `--verify`, and prints a compact verdict — zero LLM tokens spent
on orchestration.

**Escalation path** (judgment-heavy work, no verify command): call `ds-agent` directly (or
still go through `/cli-dispatch:run` without `--verify`), then read the compact result and the
diff yourself, following up with `/cli-dispatch:resume <session-id> "<prompt>"` if it needs
another pass. For a quick one-shot with no repo changes, `ds-agent` alone is enough.

## Run rules
- **Always run as a background task**: Bash tool `run_in_background: true` (don't block).
- For a **long prompt**, write the brief to a file and pass it with `-p "$(cat <brieffile>)"`.
- **Cost-conscious monitoring (MANDATORY):** track progress by reading only the small `status.json`
  (`/cli-dispatch:watch <id>`). Don't read the raw `transcript.jsonl`; don't tail it repeatedly in a
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
The transcript is appended to the same session; `status.json` is updated. See sessions: `/cli-dispatch:sessions`.

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
**UNCOMMITTED**. The session id is printed on stderr → watch it with `/cli-dispatch:watch <id>`.
The same helper exists for each other backend with the same signature: `ag-worktree-run.sh`,
`cx-worktree-run.sh`, `oc-worktree-run.sh`, `cp-worktree-run.sh`.

Then **YOU are the reviewer:**
1. Review the FULL diff with `git -C <worktree> status && git -C <worktree> diff` — check for
   side effects, confirm only the target files were touched.
2. Run tsc/build/test **yourself** (independent verification).
3. If all good, YOU do the git: commit → push → PR → merge → `git pull origin main` on the main checkout.
   Note in the commit body that "implementation was delegated to claude-ds (DeepSeek)" (transparency).
4. Cleanup: `rm <worktree>/node_modules` → `git worktree remove <worktree> --force` → `git worktree prune`.

## Other backends — Antigravity, Codex, OpenCode, GitHub Copilot

Each is a *different binary* from `claude`, with its own auth/config — the DeepSeek "swap the
env var" trick does NOT apply to any of them. Enable any at `/cli-dispatch:setup`. Every
`*-agent`/`*-stream` family mirrors `ds-agent`/`claude-ds-stream` exactly (same flags, same
Modes 1/1-safe/2, same session dir/format) — only the command name and the specifics below
differ:

```bash
ag-agent "<task>"      # Antigravity/Gemini
cx-agent "<task>"      # Codex/OpenAI
oc-agent "<task>"      # OpenCode/OpenRouter
cp-agent "<task>"      # GitHub Copilot
<prefix>-agent -q "<task>"                   # answer only on stdout
<prefix>-agent --cwd <dir> "<task>"          # agentic, isolated dir
<prefix>-agent --resume <id> "<follow-up>"   # continue the same session
<prefix>-stream --cwd <dir> -p "<task>"      # background/session-tracked variant (poll status.json)
```

| Backend | Model select | Auth | Sandbox | Notable difference |
|---|---|---|---|---|
| **Antigravity** (`ag-*`) | `--model "<slug or display name>"` / `AG_MODEL` — e.g. `--model gemini-3.6-flash-high` or `--model "Gemini 3.6 Flash (High)"` (agy accepts both); live list: `agy models` (proxies multiple families, incl. Claude — verified cross-vendor routing) | Google sign-in (run `agy` once) or `GEMINI_API_KEY`/`ANTIGRAVITY_API_KEY` | **None** — `--read-only` is rejected (tested: `--sandbox` restricts the terminal, not writes) | Runs under a pseudo-TTY (`script`) tailing agy's on-disk JSONL (needs `script` + `node`; no `--output-format json` on agy). `--max-runtime` is enforced via agy's own `--print-timeout` — a best-effort backstop only, since agy spawns detached workers under a pty and an external tree-kill is unreliable (verified); wall time may exceed the cap and a capped run may report `done` with partial output instead of a guaranteed `error`. Worktree isolation also avoids agy's per-workspace conv-id race. |
| **Codex** (`cx-*`) | `--model <name>` / `CX_MODEL` — e.g. `--model gpt-5.4-mini`; no CLI list command, check `~/.codex/models_cache.json` or `/model` inside codex | `codex login` (ChatGPT/OAuth) or `CODEX_API_KEY` (takes precedence over `OPENAI_API_KEY`) | **Real OS-level** — `--read-only` passes `-s read-only` → macOS Seatbelt / Linux bwrap+seccomp, a kernel-enforced hard-block on writes; genuine no-writes guarantee, no worktree needed for pure analysis. Default `workspace-write` for agentic work; override with `--sandbox read-only\|workspace-write\|danger-full-access`. | `codex exec --json` emits a clean JSONL stream — no pseudo-TTY/file-tail needed. Session id is the codex **thread-id**; `--resume` does not accept `--cwd`. |
| **OpenCode** (`oc-*`) | `--model <bare-slug>` / `OC_MODEL` — e.g. `--model google/gemma-4-31b-it:free`; live list: `OPENROUTER_API_KEY=<key> opencode models openrouter` | `OPENROUTER_API_KEY` in the config (pasted by the user — never written by Claude) | **None** — `--auto` (always passed) is a functional headless requirement, not a safety opt-in | Unix-only (macOS/Linux/WSL). Invalid slugs fail loudly with an OpenRouter API error. `--resume` verified to target the named session. |
| **GitHub Copilot** (`cp-*`) | `--model <slug>` / `CP_MODEL` (e.g. `gpt-5.4`, `auto`); `--effort low\|medium\|high` → `--reasoning-effort=<level>` | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (cli-dispatch reuses `gh auth token` when available); active Copilot subscription required | **None** — `--allow-all-tools --no-ask-user` always passed for headless use, not a safety opt-in | Unix-only. Model list only visible via `/model` in the copilot TUI or GitHub Copilot docs — slugs change over time. Balance not queryable from the CLI; use https://github.com/settings/billing. |

**Same session dir as DeepSeek** for all four (`…/cli-dispatch/sessions/<id>/`), so
`sessions`/`watch`/`resume`/`kill` work across every backend. **Isolation:** the same worktree
rule applies (`--cwd <worktree>`, review the diff yourself) — for Antigravity, OpenCode, and
Copilot, worktree isolation is the *only* safety boundary, since none of the three has any
OS- or tool-level write-deny.

**Delegation path (all four):** there is no `ag-/cx-/oc-/cp-runner` subagent anymore — use
`/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` for mechanical work, or the escalation
path (call the `*-agent` CLI directly and verify the result yourself) for judgment-heavy work.

## Triviality gate

Before delegating, ask three questions: (1) single file? (2) expected diff under
~50 lines? (3) zero discovery/ambiguity — you could write the exact edit right
now? If all three are yes, do NOT delegate — do it inline; the delegation's
fixed cost (worker spin-up + isolation + your own merge/verify cycle) exceeds
the work. If several such trivial fixes accumulate, batch them into one
delegation instead (see "Batch small fixes" below).

## Batch small fixes

When the orchestrator sees a delegation prompt with several small related fixes
(expected ~50 lines per fix, fixes are related), combine them into a SINGLE
delegation with an itemized checklist rather than multiple delegations. The
economics favor one worker, one diff, one verify cycle — per-delegation fixed
costs (worker spin-up + orchestrator merge/verify) dominate for
small changes, so splitting them across separate delegations multiplies that
overhead for no benefit.

## Role
The worker (claude-ds = DeepSeek, ag-agent = Antigravity/Gemini, cx-agent = Codex/OpenAI,
oc-agent = OpenCode/OpenRouter, or cp-agent = GitHub Copilot) does the work; you =
orchestrator + reviewer + git/merge owner.
Don't trust any output until verified.

## Commands
- `/cli-dispatch:setup` — install worker backends (DeepSeek / Antigravity / Codex / OpenCode / Copilot); choose at setup + config + smoke test.
- `/cli-dispatch:dashboard` — open the local read-only web dashboard (Claude Code sessions → flow → subagents → flow, + a cli-dispatch worker panel).
- `/cli-dispatch:ds-run <task>` — delegate to the **DeepSeek** worker (worktree isolation for repo tasks, session-tracked).
- `/cli-dispatch:ag-run <task>` — delegate to the **Antigravity (Gemini)** worker (same workflow).
- `/cli-dispatch:cx-run <task>` — delegate to the **Codex (OpenAI)** worker (real read-only sandbox; same workflow).
- `/cli-dispatch:oc-run <task>` — delegate to the **OpenCode (OpenRouter)** worker (no sandbox — worktree isolation only; same workflow).
- `/cli-dispatch:cp-run <task>` — delegate to the **GitHub Copilot** worker (no sandbox — worktree isolation only; same workflow).
- `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` — the deterministic runner: launch + worktree-isolate + block + verify, zero LLM babysitter tokens. The primary way to delegate mechanical work.
- `/cli-dispatch:sessions` — list past/active sessions (all backends; shows a `backend` column). Per-backend: `ds-sessions` / `ag-sessions` / `cx-sessions` / `oc-sessions` / `cp-sessions`.
- `/cli-dispatch:watch <id>` — show a session's compact live status (cost-conscious).
- `/cli-dispatch:wait <id>` — block until a session reaches a terminal state (or times out), then print a compact summary; one blocking call instead of polling `watch`.
- `/cli-dispatch:resume <id> <prompt>` — continue a worker session with a follow-up prompt (auto-detects backend).
- `/cli-dispatch:kill <id>` — stop a running worker session (SIGTERM + state → killed).
- `/cli-dispatch:clean` — remove stale worker dirs (a `running` session whose process died before finalize, so `status.json` is stuck). Dry-run by default; `--remove` deletes, `--older-than DAYS` also prunes old finished sessions.
- `/cli-dispatch:clean-schedule` — register a daily OS-level auto-clean (launchd/cron/Scheduled Tasks) that runs `cli-dispatch-clean --remove` in the background; `status` / `uninstall` actions too.
- `/cli-dispatch:status` — check installation/key/CLI status for all backends. Per-backend: `ds-status` / `ag-status` / `cx-status` / `oc-status` / `cp-status`.
- `/cli-dispatch:balance` — aggregate: DeepSeek balance + Antigravity quota + Codex rate limits + OpenCode/OpenRouter credits + Copilot usage note at once.
- `/cli-dispatch:ds-balance` — show the DeepSeek account balance.
- `/cli-dispatch:cx-balance` — Codex usage / rate limits (5h + weekly % left), read natively from codex's on-disk session records.
- `/cli-dispatch:ag-balance` — Antigravity quota (% left per model + plan), via the local language-server `GetUserStatus` RPC (needs the Antigravity server running).
- `/cli-dispatch:oc-balance` — OpenCode / OpenRouter credits.
- `/cli-dispatch:cp-balance` — Copilot usage note (not queryable from the CLI; use GitHub Billing).
- `/cli-dispatch:gain` — worker token totals by backend, plus Anthropic babysitting cost from legacy runner-subagent sessions.
- `/cli-dispatch:doctor` — health check for all backends (PATH, keys, CLI auth ✓/✗).
- `/cli-dispatch:help` — one-screen command reference.
