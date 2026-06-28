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
  available via `ag-agent` / `ag-stream`, and a third, **Codex (OpenAI Codex CLI)**, via
  `cx-agent` / `cx-stream` (see the Antigravity and Codex sections below). Codex adds a
  real OS-level read-only sandbox (`cx-agent --read-only`).
  Triggers: "claude-ds", "delegate to claude-ds", "run with deepseek", "delegate to
  antigravity/gemini", "run with agy", "delegate to codex", "run with codex/openai" (also
  Turkish: "deepseek ile yap/çalıştır", "gemini/antigravity ile yap", "codex/openai ile
  yap", "delege et claude-ds").
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

Then **YOU are the reviewer:**
1. Review the FULL diff with `git -C <worktree> status && git -C <worktree> diff` — check for
   side effects, confirm only the target files were touched.
2. Run tsc/build/test **yourself** (independent verification).
3. If all good, YOU do the git: commit → push → PR → merge → `git pull origin main` on the main checkout.
   Note in the commit body that "implementation was delegated to claude-ds (DeepSeek)" (transparency).
4. Cleanup: `rm <worktree>/node_modules` → `git worktree remove <worktree> --force` → `git worktree prune`.

## Antigravity (Gemini) backend — `ag-agent` / `ag-stream`
cli-dispatch's second worker is **Antigravity** (`agy`, Google's Gemini-powered agentic CLI).
It's a *different binary* from `claude` with its own auth/config — the DeepSeek "swap the env
var" trick does NOT apply. Enable it via `/cli-dispatch:setup` (choose Antigravity/Both).

The `ag-*` family mirrors the `ds-*` one, so the workflow is the same — only the command name
changes:
```bash
ag-agent "<task>"                     # agentic in cwd; live progress on stderr; answer on stdout
ag-agent -q "<task>"                  # answer only on stdout (banner/progress silenced)
ag-agent --cwd <dir> "<task>"         # work in <dir>; <dir> is registered as agy's workspace
ag-agent --resume <conv-id> "<follow-up>"   # continue the same agy conversation
ag-agent --model "Claude Opus 4.6 (Thinking)" "<task>"   # pick a specific model (see below)
ag-stream --cwd <dir> -p "<task>"     # background/session-tracked variant (poll status.json)
```
- **Model selection (agy proxies multiple families):** `agy models` lists them; pass the EXACT
  display name to `--model` (config default: `AG_MODEL`). Verified working cross-vendor —
  e.g. `--model "Claude Opus 4.6 (Thinking)"` actually routes to Claude, `"Gemini 3.1 Pro (High)"`
  to Gemini. Current list: `Gemini 3.5 Flash (Low|Medium|High)`, `Gemini 3.1 Pro (Low|High)`,
  `Claude Sonnet 4.6 (Thinking)`, `Claude Opus 4.6 (Thinking)`, `GPT-OSS 120B (Medium)`. Default
  `Gemini 3.5 Flash (High)`. ⚠ An unknown name makes agy SILENTLY use its default — ag-stream
  warns when `--model` isn't in `agy models`, but double-check the exact string (incl. suffix).
- **Same session dir** as DeepSeek (`…/cli-dispatch/sessions/<id>/` with `status.json` etc.), so
  `/cli-dispatch:sessions` / `watch` work for both. The session id IS the agy conv-id.
- **How it works:** agy has no `--output-format json` and a non-TTY silent-drop bug, so
  `ag-stream` runs it under a pseudo-TTY (`script`) and **tails agy's on-disk JSONL transcript**
  for live progress + the final answer. Requires `script` (pseudo-tty) + `node`.
- **Auth:** Google sign-in (run `agy` once) or `GEMINI_API_KEY`/`ANTIGRAVITY_API_KEY` in the config.
- **no read-only mode:** agy has no tool-level write-deny (`--sandbox` restricts the terminal,
  not file writes — tested), so `--read-only` is rejected. For a no-writes guarantee, isolate
  in a throwaway/worktree `--cwd` and review the diff.
- **timeout semantics differ from DeepSeek:** agy spawns detached workers + runs under a pty,
  so an external tree-kill is unreliable (verified: SIGKILL on the tracked tree left agy
  working). `--max-runtime N` is therefore enforced via agy's OWN `--print-timeout` (a
  per-model-wait cap, so total wall-time may exceed N), and the watchdog is only a best-effort
  backstop for a fully-hung agy. A capped run may report `done` (partial output) or `error`
  (no final answer), not a guaranteed `error`. For a true wall-clock bound, run it yourself
  under `timeout(1)`/worktree and don't rely on the worker self-terminating.
- **Isolation:** same worktree rule for real-repo tasks — run `ag-agent --cwd <worktree>` and
  review the diff yourself. (Worktree isolation also avoids agy's per-workspace conv-id race.)
- **Babysitter subagent:** the `ag-runner` subagent manages an Antigravity delegation in a
  sub-context (or call `ag-agent` directly in a worktree and verify the result yourself).

## Codex (OpenAI) backend — `cx-agent` / `cx-stream`
cli-dispatch's third worker is **Codex** (`codex`, OpenAI's Codex CLI ≥ 0.142.3) — again a
*different binary* with its own auth. Enable it via `/cli-dispatch:setup` (choose Codex).

The `cx-*` family mirrors the `ds-*` one:
```bash
cx-agent "<task>"                       # agentic in cwd; live progress on stderr; answer on stdout
cx-agent -q "<task>"                    # answer only on stdout
cx-agent --read-only -q "<question>"    # REAL OS-level read-only sandbox (no writes / no bash)
cx-agent --cwd <dir> "<task>"           # work in <dir>
cx-agent --model gpt-5.4-mini "<task>"  # pick a model (see below)
cx-agent --resume <thread-id> "<follow-up>"   # continue the same codex thread (do NOT pass --cwd)
cx-stream --cwd <dir> -p "<task>"       # background/session-tracked variant (poll status.json)
```
- **Real OS-level read-only sandbox (headline feature):** `cx-agent --read-only` passes
  `-s read-only` to codex → macOS Seatbelt / Linux bwrap+seccomp, a kernel-enforced hard-block
  on all file writes. Unlike DeepSeek (tool-layer restriction) and Antigravity (none), this is
  a genuine no-writes guarantee — no worktree needed for pure analysis. Sandbox defaults to
  `workspace-write` for agentic work; override with `--sandbox read-only|workspace-write|danger-full-access`.
- **Model selection:** `--model <name>` (config default `CX_MODEL`; blank = codex's own default).
  Current: `gpt-5.5` (default, frontier), `gpt-5.4` (flagship), `gpt-5.4-mini` (fast/cheap,
  subagents), `gpt-5.3-codex-spark` (ChatGPT Pro preview). `gpt-5.2`/`gpt-5.3-codex` deprecated.
  Run `/model` inside codex for the live list.
- **Same session dir** as the others (`…/cli-dispatch/sessions/<id>/`), so `/cli-dispatch:sessions`
  / `watch` work for all three. The session id is the codex **thread-id**.
- **How it works:** `codex exec --json` emits a clean JSONL stream → `cx-stream` pipes it
  through `cx-stream-parse.mjs` (no pseudo-TTY/file-tail needed). Requires `node`.
- **Auth:** `codex login` (ChatGPT/OAuth — no key for personal use) or `CODEX_API_KEY`
  (takes precedence over `OPENAI_API_KEY`).
- **Babysitter subagent:** the `cx-runner` subagent manages a Codex delegation in a sub-context.

## Role
The worker (claude-ds = DeepSeek, ag-agent = Antigravity/Gemini, or cx-agent = Codex/OpenAI)
does the work; you = orchestrator + reviewer + git/merge owner. Don't trust any output until verified.

## Commands
- `/cli-dispatch:setup` — install worker backends (DeepSeek / Antigravity / Codex); choose at setup + config + smoke test.
- `/cli-dispatch:dashboard` — open the local read-only web dashboard (Claude Code sessions → flow → subagents → flow, + a cli-dispatch worker panel).
- `/cli-dispatch:ds-run <task>` — delegate to the **DeepSeek** worker (worktree isolation for repo tasks, session-tracked).
- `/cli-dispatch:ag-run <task>` — delegate to the **Antigravity (Gemini)** worker (same workflow).
- `/cli-dispatch:cx-run <task>` — delegate to the **Codex (OpenAI)** worker (real read-only sandbox; same workflow).
- `/cli-dispatch:sessions` — list past/active sessions (all backends; shows a `backend` column). Per-backend: `ds-sessions` / `ag-sessions` / `cx-sessions`.
- `/cli-dispatch:watch <id>` — show a session's compact live status (cost-conscious).
- `/cli-dispatch:status` — check installation/key/CLI status for all backends. Per-backend: `ds-status` / `ag-status` / `cx-status`.
- `/cli-dispatch:balance` — aggregate: DeepSeek balance + Antigravity quota + Codex rate limits at once.
- `/cli-dispatch:ds-balance` — show the DeepSeek account balance.
- `/cli-dispatch:cx-balance` — Codex usage / rate limits (5h + weekly % left), read natively from codex's on-disk session records.
- `/cli-dispatch:ag-balance` — Antigravity quota (% left per model + plan), via the local language-server `GetUserStatus` RPC (needs the Antigravity server running).
