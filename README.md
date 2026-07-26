# cli-dispatch

> 🌐 **Languages:** **English** · [Türkçe](README.tr.md)

**Use DeepSeek, Gemini, OpenAI Codex, OpenCode (via OpenRouter), or GitHub Copilot as delegated workers inside Claude Code.** Claude Code's built-in subagent tool only supports Anthropic models — cli-dispatch adds portable wrappers so you can hand tasks to any of the five from inside your existing `claude` session.

> ℹ️ **Multi-backend delegation hub.** Five worker backends — **DeepSeek** (`/cli-dispatch:ds-*`), **Antigravity/Gemini** (`/cli-dispatch:ag-run`, wrappers `ag-agent`/`ag-stream`), **Codex** (`/cli-dispatch:cx-run`, `cx-agent`/`cx-stream`), **OpenCode** (`/cli-dispatch:oc-run`, `oc-agent`/`oc-stream`), and **GitHub Copilot** (`/cli-dispatch:cp-run`, `cp-agent`/`cp-stream`). Pick which to install at setup. All five write to the same session layout, so `sessions`/`watch` work across all. The DeepSeek wrapper/config paths keep the `claude-ds` name (that backend's name).

> 📝 **Write-up (Turkish):** [cli-dispatch: a plugin that makes Claude the boss and DeepSeek the worker](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc) — Medium

![cli-dispatch demo — start Claude Code in your project, then: install, /cli-dispatch:setup, delegate via /cli-dispatch:ds-run and the deterministic /cli-dispatch:run runner, check usage](assets/demo.gif)

> **Demo** — install the plugin, run `/cli-dispatch:setup` to pick and configure your backend(s), then delegate tasks with `/cli-dispatch:ds-run` / `ag-run` / `cx-run` / `oc-run` / `cp-run`, or `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` for the deterministic, zero-babysitter path. The worker generates; Claude Code watches live and verifies.

![cli-dispatch dashboard — live session list, subagent drill-down, worker session trace per backend](assets/dashboard.gif)

> **Dashboard** (`/cli-dispatch:dashboard`) — live view of all Claude Code sessions, any subagents they spawn, and the worker CLI sessions delegated via cli-dispatch. Shows status, task, and per-backend trace in real time.

## Install

> ⚠️ These commands are **slash commands** and must be run **from inside the Claude Code CLI** (not in a normal terminal/shell). First type `claude` to start a Claude Code session, then enter the commands at that session's prompt.

**Before you start — you need:**
- `claude` CLI installed and on your `PATH`
- `~/.local/bin` on your `PATH` — check: `echo $PATH | grep -q local && echo ok || echo 'add: export PATH="$HOME/.local/bin:$PATH" to ~/.zshrc'`
- API key/auth for your backend — see the table below

Run the commands **one at a time, in order** — don't paste them all at once. Send each command, wait for the result, then move to the next:

**Step 1 — Add the marketplace:**

```text
/plugin marketplace add rbinar/cli-dispatch
```

> If an "Enter marketplace source" box opens, type **only the source** into it (not the command): `rbinar/cli-dispatch`

**Step 2 — Install the plugin** (after the marketplace is added):

```text
/plugin install cli-dispatch@cli-dispatch
```

> The format is `plugin-name@marketplace-name`; since both are `cli-dispatch` the name repeats, which is normal.

**Step 3 — Enable the plugin:**

The install output says `Run /reload-plugins to apply`. This step is required for the commands (`/cli-dispatch:ds-*`) to be recognized:

```text
/reload-plugins
```

> If you still get "Unknown command: /cli-dispatch:setup" after reload, fully quit Claude Code and reopen it. You can verify `cli-dispatch` is installed and **enabled** with the `/plugin` command.

**Step 4 — Run setup** (after the plugin is enabled):

```text
/cli-dispatch:setup
```

`/cli-dispatch:setup` first **asks which worker backend(s) to install** — DeepSeek, Antigravity (Gemini), Codex, OpenCode, Copilot, or all (`--backends all` or `--backends deepseek,antigravity,codex,opencode,copilot`). If a selected backend's underlying CLI turns out to be missing, `install.sh` can attempt to auto-install it — pass `--install-missing` (opt-in, default off; npm preferred where available, `curl | bash` vendor installers as fallback). Setup only adds this flag after your explicit approval and shows exactly which CLIs are missing and which commands will run; it never automates auth (sign-in, API keys). See [CHANGELOG.md](CHANGELOG.md) for details.

| Backend | CLI (install) | Auth | Model select |
|---|---|---|---|
| **DeepSeek** | `claude` (you already have it) | `DEEPSEEK_API_KEY` in config ([get one](https://platform.deepseek.com/api_keys)) | `DS_MODEL` / `DS_FLASH_MODEL` |
| **Antigravity (Gemini)** | `agy` — `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (+ `script`, `node`) | Google sign-in (run `agy` once) or `GEMINI_API_KEY` | `--model "<name>"` / `AG_MODEL` — list: `agy models` |
| **Codex (OpenAI)** | `codex` ≥ 0.142.3 — `npm i -g @openai/codex`, `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (+ `node`) | `codex login` (ChatGPT/OAuth) or `CODEX_API_KEY`/`OPENAI_API_KEY` | `--model <name>` / `CX_MODEL` — list: `/model` inside codex |
| **OpenCode (OpenRouter)** | `opencode` — `npm i -g opencode-ai` (+ `node`) | `OPENROUTER_API_KEY` ([get one](https://openrouter.ai/keys)), pasted by you | `--model <bare-slug>` / `OC_MODEL` — list: `opencode models openrouter` |
| **GitHub Copilot** | `copilot` — `npm i -g @github/copilot`, `brew install --cask copilot-cli`, or `curl -fsSL https://gh.io/copilot-install \| bash` (+ `node` 22+) | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (reuses `gh auth token`); active Copilot subscription required | `--model <slug>` / `CP_MODEL`; `--effort low\|medium\|high` |

Native Windows: DeepSeek and Codex only — install the other three under WSL (see [Windows](#windows)). Sandbox: only Codex's `--read-only` is a kernel-enforced OS sandbox — the rest need worktree isolation (see [Security and data](#security-and-data)).

For DeepSeek and OpenCode, since you paste the key yourself, setup **auto-opens the config file** in your platform's default editor (macOS `open`, Linux `xdg-open`, WSL `explorer.exe`, Windows `notepad`) when the key is still empty:

```bash
# ~/.config/cli-dispatch/config
DEEPSEEK_API_KEY="sk-..."     # your own DeepSeek key
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

> Want a different editor? Set `CLI_DISPATCH_EDITOR` (e.g. `CLI_DISPATCH_EDITOR="code"`; the legacy `CLAUDE_DS_EDITOR` is still honored). If auto-open fails, open the file manually: `${EDITOR:-nano} ~/.config/cli-dispatch/config`.

OpenCode's setup step additionally asks (multiple-choice) for a default model from 2-3 curated free-tier OpenRouter slugs (e.g. `google/gemma-4-31b-it:free`) or a custom slug, writing it to `OC_MODEL`. Copilot's model list is only visible interactively (`/model` in the copilot TUI, or GitHub Copilot docs) — slugs change over time.

`/cli-dispatch:setup` has a final step that offers, via a yes/no question, to write a standing delegation-preference reminder — pointing at the deterministic runner (`/cli-dispatch:run`, no LLM babysitter) — into your global or project `CLAUDE.md`, so you don't have to re-explain your delegation preference every session (idempotent/marker-guarded, so re-running setup won't duplicate it).

## Session-start policy injection (optional)

That final `/cli-dispatch:setup` step asks **three preferences** — enable per-session policy injection, whether to include the GitHub-issue reminder, and whether to also write a static CLAUDE.md block — and saves the answers to `~/.config/cli-dispatch/policy.json`. A `SessionStart` hook (fires on `startup`/`resume`/`clear`/`compact`/`fork` — including `compact`, so the policy **survives auto-compaction**: compaction drops the previous copy, the hook injects a fresh one, net one live copy per context) then auto-injects a compact delegation policy into every session's context: route mechanical work through the deterministic runner (`/cli-dispatch:run`, no LLM babysitter), escalate yourself when there's no verify command, and a reminder to file cli-dispatch friction points as GitHub issues — all without hand-editing CLAUDE.md.

- **Opt-in, default off** — if `policy.json` is missing or has `enabled:false`, the hook is a silent no-op with zero token cost.
- Complements, doesn't replace, the static CLAUDE.md block (formerly `orchestration-priority`, now `policy:v1`) — enabling both injects the same policy twice per session, so hook-only is recommended. `/cli-dispatch:doctor` reports its status in a **Policy injection** section.
- **Remove it** by deleting `~/.config/cli-dispatch/policy.json` or setting `enabled:false`.

## Updating

Update the plugin from inside Claude Code, then reload (run one at a time):

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` fetches the newest version from the marketplace; `/reload-plugins` applies it
to the running session (without a full restart). Verify with `/cli-dispatch:status`.

> ℹ️ `/plugin update` refreshes the **commands/skills** only — it does **not** reinstall the
> worker wrappers in `~/.local/bin`. After an update that changes a wrapper, re-run
> **`/cli-dispatch:setup`** once to reinstall them.

<video src="https://github.com/rbinar/cli-dispatch/raw/main/assets/update.mp4" controls width="820"></video>

> ▶️ [Watch the update demo (mp4)](assets/update.mp4) — `/plugin update` then `/reload-plugins` inside Claude Code.

## Dashboard

```text
/cli-dispatch:dashboard
```

A **local web dashboard** over data that already lives on disk. It lists active
Claude Code CLI sessions (all projects, **busy** ones pinned on top); click a session to see
its **flow** (messages / tool calls / results), the **subagents** it spawned, and click a
subagent to drill into *its* flow (nested by spawn depth). A second panel shows the
cli-dispatch **worker** delegations (DeepSeek / Antigravity / Codex / OpenCode / Copilot) with their state + flow.
Busy sessions auto-refresh.

It reads `~/.claude/projects/**` (Claude Code transcripts), `~/.claude/sessions/*.json` (live
busy/idle), and `~/.cache/cli-dispatch/sessions/**` (workers). Notes:
- **The only long-running process the plugin starts.** It binds `127.0.0.1` only, is
  read-**mostly**: it reads data already on disk, plus three narrowly-scoped write paths that
  each require an Origin + Host + custom-header check — the **Config** editor (below), stale-session
  cleanup, and an opt-in **human-takeover** action on a worker's detail view that attaches to
  already-owned worker sessions only (kill the headless process, attach a PTY terminal). No
  general shell, no arbitrary command. Stop the dashboard with the printed `kill <pid>` (or
  Ctrl-C if you run `cli-dispatch-dashboard` yourself in a terminal).
- The Claude Code on-disk transcript format is internal and may change across versions; the
  dashboard renders unknown shapes defensively.
- Each backend group leads with an **auth** line that answers the question the key badge cannot: three of the five backends normally have no key in the config at all and sign in through their own CLI, so the view combines both sources — `✓ key in config`, `✓ logged in (ChatGPT)`, `✓ logged in (gh)`, or `✗ not logged in` with the command that fixes it. Probes are non-interactive, time-limited, and their output never leaves the server (Copilot's probe prints a token, which is discarded in place). A probe that cannot run reads `could not check`, never a red cross. Antigravity has no auth subcommand at all, so it reports that plainly and falls back to run history.
- A **Config** tab edits the cli-dispatch config file right in the browser. Secret fields (API keys) are write-only — never echoed back once saved — and shown with a masked preview (e.g. `sk-e78f...ea1b`, first 6 + last 4 chars) so you can confirm which key is set without exposing it. Non-secret fields like `*_MODEL` and `*_MODELS` can be viewed and edited directly.
- Sessions/subagents show per-session token usage and which model ran them. Token counts captured
  mid-run (a killed or interrupted worker) are labelled as partial rather than shown as totals.
- **Deterministic-runner results are first class.** A worker launched via
  [`/cli-dispatch:run`](#deterministic-runner-cli-dispatchrun--no-llm-babysitter) writes a
  `verdict.json`, and the dashboard reads it: the worker row gets a `⚙RUN` marker plus a
  verify ✓/✗ badge with its exit code and the change size, and the detail view adds the verify
  commands and output tail, the changed files with their git status (separating paths that were
  already dirty before the worker started), the branch/base/worktree, and a link to the diff.
  A verify failure is shown on its own axis from the worker's state, because "the worker finished
  but the check failed" and "the worker died" are different outcomes.

## Statusline badge

`scripts/cli-dispatch-statusline.sh` is a statusline **fragment**: a combining
`~/.claude/hooks/statusline.sh` wrapper pipes the statusline's stdin JSON to it and appends
its output. It prints a cyan `[CD]` badge when cli-dispatch is **active** (policy injection
enabled, or ≥1 worker running), plus a yellow `▶N` counter while N worker sessions are
running — and nothing when inactive.

Wire it up with one line in your combining wrapper, globbing the fragment out of the plugin
cache (hash/version-named, so glob — don't hardcode a path):

```bash
CD_SCRIPT=$(ls "$CONFIG_DIR"/plugins/cache/cli-dispatch/cli-dispatch/*/scripts/cli-dispatch-statusline.sh 2>/dev/null | head -1)
```

It only reads tiny `status.json` files (never `transcript.jsonl`), so it stays cheap even
though statuslines re-run on every prompt. Unix (bash) statusline setups only.

## Usage

You use cli-dispatch **from inside Claude Code** — two ways:

1. **Slash commands** (table below) — typed at the `claude` session's prompt.
2. **Natural language** — say "do this with deepseek", "run this with codex", "delegate this to gemini"; the skill kicks in and Claude Code runs the work on the matching backend.

| Command | What it does |
|---------|--------------|
| `/cli-dispatch:setup` | Pick backend(s) + install + config skeleton + smoke test |
| `/cli-dispatch:dashboard` | Open the local web dashboard — Claude Code sessions → flow → subagents → flow, + worker panel |
| `/cli-dispatch:ds-run <task>` | Delegate a task to **DeepSeek** (session-tracked; worktree isolation for repo tasks) |
| `/cli-dispatch:ag-run <task>` | Delegate a task to **Antigravity (Gemini)** (same workflow) |
| `/cli-dispatch:cx-run <task>` | Delegate a task to **Codex (OpenAI)** (real read-only sandbox; same session layout) |
| `/cli-dispatch:oc-run <task>` | Delegate a task to **OpenCode (OpenRouter)** (no sandbox — worktree isolation only; same session layout) |
| `/cli-dispatch:cp-run <task>` | Delegate a task to **GitHub Copilot** (no sandbox — worktree isolation only; same session layout) |
| `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` | Deterministic delegation, zero LLM babysitter tokens — the primary way to delegate mechanical work |
| `/cli-dispatch:sessions` | List past/active sessions (all backends; shows a `backend` column) |
| `/cli-dispatch:ds-sessions` / `ag-sessions` / `cx-sessions` / `oc-sessions` / `cp-sessions` | Same list, filtered to just DeepSeek / Antigravity / Codex / OpenCode / Copilot |
| `/cli-dispatch:watch <id>` | Show a session's live status (cost-aware; any backend) |
| `/cli-dispatch:wait <id>` | Block until a session finishes (or times out), then print a compact summary — one blocking call instead of polling `watch` |
| `/cli-dispatch:resume <id> <prompt>` | Continue a worker session with a follow-up prompt (auto-detects backend) |
| `/cli-dispatch:kill <id>` | Stop a running worker session (SIGTERM + state → killed) |
| `/cli-dispatch:clean` | Remove stale worker dirs (`running`-but-dead); dry-run by default, `--remove` to delete. Deleting a session also removes `verdict.json` and `verdict-diff.patch`; dry-run marks candidates that still have a patch, and `--preserve-verdicts` archives them under `<sessions-root>/verdict-archive/`. |
| `/cli-dispatch:clean-schedule` | Schedule a daily auto-clean via the OS scheduler (launchd / cron / Scheduled Tasks); `status` / `uninstall` too |
| `/cli-dispatch:status` | Check install/key/CLI status for all backends |
| `/cli-dispatch:ds-status` / `ag-status` / `cx-status` / `oc-status` / `cp-status` | Same check, scoped to just DeepSeek / Antigravity / Codex / OpenCode / Copilot |
| `/cli-dispatch:balance` | Aggregate — DeepSeek balance + Antigravity quota + Codex rate limits + OpenCode credits + Copilot usage note, all at once |
| `/cli-dispatch:ds-balance` | Show DeepSeek account balance |
| `/cli-dispatch:cx-balance` | Show Codex usage / rate limits (5h + weekly % left) — native, from codex's own on-disk session records |
| `/cli-dispatch:ag-balance` | Show Antigravity quota (% left per model + plan) — native, via the local language-server `GetUserStatus` RPC |
| `/cli-dispatch:oc-balance` | Show OpenCode's OpenRouter paid-credit balance (`total_credits - total_usage`) — `:free` models have no quota API |
| `/cli-dispatch:cp-balance` | Explain Copilot usage visibility — not queryable from the CLI; use GitHub Billing |
| `/cli-dispatch:gain` | Report worker token totals by backend, plus Anthropic babysitting cost from legacy runner-subagent sessions |
| `/cli-dispatch:doctor` | Health check for all backends — PATH, API keys, CLI auth ✓/✗ |
| `/cli-dispatch:help` | One-screen command reference cheat sheet |

## Features

All used from inside Claude Code (`/cli-dispatch:ds-run <task>`, `/cli-dispatch:cx-run`, `/cli-dispatch:ag-run`, `/cli-dispatch:oc-run`, `/cli-dispatch:cp-run`, or "do <task> with deepseek/codex/gemini/opencode/copilot"):

- **Five worker backends, one hub** — **DeepSeek** (`ds-*`), **Antigravity / Gemini** (`ag-*`), **Codex / OpenAI** (`cx-*`), **OpenCode / OpenRouter** (`oc-*`), **GitHub Copilot** (`cp-*`). Pick any (or all) at setup; all five write the **same session layout**, so `sessions`, `watch`, `clean`, the balance commands, and the dashboard work across every backend.
- **Delegate & verify** — the worker generates/implements; Claude Code watches live and verifies the output. Conversation context is not shared → the task must be **self-contained**. The worker = doer, you = reviewer/merge owner.
- **Session tracking (live watch + resume)** — work is not an opaque background process; each run writes a session dir (status / progress / transcript / meta + the full prompt) and is observable and resumable. → [Session tracking](#session-tracking-live-watch--resume)
- **Isolation & read-only** — real repo tasks run in a throwaway git worktree, diff left uncommitted; Codex's `--read-only` additionally activates a kernel-enforced no-writes sandbox. → [Security and data](#security-and-data)
- **Deterministic runner, no LLM babysitter (`/cli-dispatch:run`)** — the only delegation path: launches a worker, isolates real repo changes in a worktree, blocks until done, and gates on a machine-checkable `--verify` command — zero Anthropic tokens spent on orchestration. For judgment-heavy work with no verify command, the escalation path is the same runner (or a plain `*-agent` CLI) — you read the compact verdict + diff yourself and follow up with `/cli-dispatch:resume` if needed. → [Deterministic runner](#deterministic-runner-cli-dispatchrun--no-llm-babysitter)
- **Session-start policy injection (optional)** — a `SessionStart` hook auto-injects a compact delegation policy (deterministic-runner routing, escalation path, issue-filing reminder) into every session's context, configured once at `/cli-dispatch:setup`. Opt-in, default off, zero token cost when disabled. → [Session-start policy injection](#session-start-policy-injection-optional)
- **Statusline badge (optional)** — a cyan `[CD]` badge, plus a yellow `▶N` running-worker counter, in your terminal statusline while cli-dispatch is active. → [Statusline badge](#statusline-badge)
- **Web dashboard** — a local view: Claude Code sessions → flow → subagents → flow, plus a worker panel with each run's verify result and diff, cost/model visibility, and a Config editor. → [Dashboard](#dashboard)
- **Native usage / quota** — `/cli-dispatch:balance` (all five at once) or a per-backend `*-balance`; reverse-engineered from each CLI's own local data where available, **no third-party tools**. Copilot is explicitly not CLI-queryable. → [Usage & quota](#usage--quota--native-no-third-party-tool)
- **Housekeeping** — `/cli-dispatch:clean` prunes stale (`running`-but-dead) worker dirs; `/cli-dispatch:clean-schedule` automates it daily via launchd / cron / Scheduled Tasks.
- **Safety net & isolation** — a hung/runaway worker is auto-killed (with its child processes) at a runtime or idle limit, going `state: error`; workers do not inherit your `~/.claude` MCP servers (playwright, etc.).

> ⚠️ **The default mode is not a sandbox.** Workers run agentic → they **can write files / run bash**. Isolate real repo work in a worktree. Full sandbox posture per backend: [Security and data](#security-and-data).

## Session tracking (live watch + resume)

Delegated work is **not an opaque background process**: every backend's output is parsed and each task is written to a **session directory** (same layout for DeepSeek, Antigravity, Codex, OpenCode, and Copilot). You track what the worker is doing in a **live, structured, resumable** way via `/cli-dispatch:sessions` and `/cli-dispatch:watch <id>` (or `/cli-dispatch:wait <id>` to block for the result in one call).

Session directory: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (legacy `claude-ds` path still read as a fallback)

| File | Contents |
|------|----------|
| `status.json` | Compact summary (state, last tool, tool counts, result preview) — **the only file read to watch** |
| `progress.log` | Terse human-readable stream (`▸ Edit foo.ts`, `✓ / ✗`, truncated text) |
| `transcript.jsonl` | Raw stream-json (resume/audit; not read while watching) |
| `meta.json` | Prompt preview, cwd, branch, model, start/end |
| `prompt.txt` | The **full** task prompt (untruncated; shown pinned atop the worker's dashboard page) |

**Cost-aware watching:** progress is tracked only from the small `status.json` (`/cli-dispatch:watch <id>` or `/cli-dispatch:wait <id>`); the raw transcript is not read, not tailed in a tight loop — because every read by the orchestrator spends tokens.

> Requirement: `node` is needed for session tracking/parsing (claude-code already runs in a node environment).

## Deterministic runner (`/cli-dispatch:run`) — no LLM babysitter

The five per-backend "babysitter" subagents (`ds-/ag-/cx-/oc-/cp-runner`) that used to run each delegation in its own LLM sub-context were retired in 4.0.0 — measured across production usage, they cost roughly **9x** their own worker's output in Anthropic tokens (see [CHANGELOG.md](CHANGELOG.md)). The deterministic runner is now the **only** delegation path:

```text
/cli-dispatch:run <backend> "<task>" --verify '<cmd>'
```

`cli-dispatch-run` launches the worker (`ds` DeepSeek / `ag` Antigravity / `cx` Codex / `oc` OpenCode / `cp` GitHub Copilot), isolates real repo changes in a git worktree, blocks until it finishes (or times out), runs your `--verify` command, and prints a compact verdict — **zero LLM babysitter tokens spent on orchestration.** On Codex, `--read-only` still activates the **real OS-level sandbox** (macOS Seatbelt / Linux bwrap+seccomp) — a kernel-enforced hard-block on all file writes, no worktree needed for a genuine no-writes guarantee.

**Escalation path** (judgment-heavy work, no machine-checkable verify command): there is still no LLM babysitter subagent. You (Claude Code) run the deterministic runner — or a plain `*-agent` CLI directly — but instead of gating on `--verify`, you read the compact verdict and the diff yourself, then follow up with `/cli-dispatch:resume <session-id> "<prompt>"` if the result needs another pass.

For a trivial single-file fix (well under ~50 lines, zero discovery/ambiguity), skip delegation entirely and do it inline — the fixed cost of any delegation isn't worth it. For a simple one-shot job with no repo changes, the plain `/cli-dispatch:ds-run` / `ag-run` / `cx-run` / `oc-run` / `cp-run` commands are enough.

## Usage & quota — native, no third-party tool

"How much of my limit is left?" — answered for **every** backend without installing anything
extra. Each `*-balance` command reverse-engineers data the CLI already keeps locally; nothing
new is sent over the network on your behalf.

Use `/cli-dispatch:balance` to see all five at once, or a single `*-balance` command per backend.

| Backend | Command | Where the number comes from |
|---|---|---|
| **All** | `/cli-dispatch:balance` | Runs the five below in one go and summarizes each headline number side by side. |
| **DeepSeek** | `/cli-dispatch:ds-balance` | DeepSeek's official REST balance API (`/user/balance`), using your `DEEPSEEK_API_KEY`. |
| **Codex** | `/cli-dispatch:cx-balance` | Codex **persists** the backend's rate-limit payload into its own session records (`~/.codex/sessions/**/*.jsonl`). The command reads the newest `token_count` record's `rate_limits` → `primary` (5h) + `secondary` (7d) windows as **% left** + reset. No network. |
| **Antigravity** | `/cli-dispatch:ag-balance` | The local Antigravity **language server** (the one the IDE/`agy` already run) exposes a Connect-RPC `GetUserStatus` endpoint. The command finds the running `language_server` process, reads its `--csrf_token` arg + listening port, then `POST`s `GetUserStatus` → plan + **per-model `remainingFraction`** + reset. |
| **OpenCode** | `/cli-dispatch:oc-balance` | OpenRouter's official REST endpoint (`GET /api/v1/credits`), using your `OPENROUTER_API_KEY` → `total_credits - total_usage` remaining. **Paid-credit balance only** — `:free`-suffixed models have separate, unauthenticated per-model rate limits with no scriptable quota API. |
| **GitHub Copilot** | `/cli-dispatch:cp-balance` | Not queryable from the `copilot` CLI. `/usage` is session-scoped and interactive-only inside a Copilot REPL; use GitHub Billing (https://github.com/settings/billing) for actual usage/limits. |

How the two reverse-engineered ones work, concretely:

```bash
# Codex — newest rate_limits snapshot on disk (same numbers as /status in the TUI):
#   ~/.codex/sessions/**/*.jsonl  →  payload.rate_limits.{primary(5h),secondary(7d)}
#   used_percent → 100-used = % left ; resets_at (epoch) → reset time

# Antigravity — query the local language server directly (needs it running):
PID=$(ps aux | grep -i language_server | grep -i antigravity | grep -v grep | awk '{print $2}' | head -1)
CSRF=$(ps -ww -o command= -p "$PID" | sed -E 's/.*--csrf_token[ =]([^ ]+).*/\1/')
PORT=$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$PID" | awk 'NR>1{print $9}' | sed -E 's/.*:([0-9]+)$/\1/' | head -1)
curl -sk -X POST "https://127.0.0.1:$PORT/exa.language_server_pb.LanguageServerService/GetUserStatus" \
  -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' \
  -H "X-Codeium-Csrf-Token: $CSRF" --data '{}'    # → userStatus.cascadeModelConfigData...quotaInfo
```

Caveats: Codex's figure is as fresh as the **last interactive turn** (`-q`/exec runs report
`rate_limits:null`); Antigravity's command needs the **language server running** (IDE open or
an `agy` session) — otherwise it prints a hint. Neither adds a dependency.

## Under the hood (advanced)

The plugin installs portable CLIs that Claude Code **invokes via Bash** into `~/.local/bin` — normally **you don't call these**, Claude Code manages them:

| CLI | What |
|-----|------|
| `claude-ds` | Plain env wrapper (points `claude` at DeepSeek; no parse/session) |
| `claude-ds-stream` | Session-tracked variant (stream-json parse + status/progress/transcript) |
| `ds-agent` | One-shot synchronous wrapper: task → run → answer (stdout); progress on stderr |
| `ag-stream` | Session-tracked Antigravity wrapper (tails agy's on-disk JSONL transcript) |
| `ag-agent` | One-shot synchronous wrapper for agy: task → run → answer (stdout) |
| `cx-stream` | Session-tracked Codex wrapper (pipes codex's JSONL stdout through the parser) |
| `cx-agent` | One-shot synchronous wrapper for codex: task → run → answer (stdout) |
| `oc-stream` | Session-tracked OpenCode wrapper (pipes opencode's JSON stream through the parser) |
| `oc-agent` | One-shot synchronous wrapper for opencode: task → run → answer (stdout) |
| `cp-stream` | Session-tracked GitHub Copilot wrapper (pipes copilot's JSON stream through the parser) |
| `cp-agent` | One-shot synchronous wrapper for copilot: task → run → answer (stdout) |

If you want, you can also use them directly from the terminal (e.g. in scripts outside the plugin):

```bash
ds-agent --read-only "question"           # one shot; answer to stdout
ds-agent --cwd /tmp/x "generate a file"   # agentic, isolated dir
claude-ds-stream --resume <id> -p "…"     # continue an existing session

cx-agent --read-only -q "question"        # read-only: kernel-enforced sandbox (macOS Seatbelt / Linux bwrap)
cx-agent --cwd /tmp/x "generate a file"   # agentic, isolated dir
cx-agent --resume <thread-id> "follow-up"                # resume reuses stored context; --cwd not supported on resume

cp-agent -q "question"                    # one shot; answer to stdout
cp-agent --cwd /tmp/x "generate a file"   # agentic, isolated dir
cp-agent --effort high --model gpt-5.4 "task"
cp-agent --resume <session-id> "follow-up"
```

Flags (cx-agent / cx-stream): `--read-only`, `--sandbox <mode>`, `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--max-runtime`/`--idle-timeout`, `-q`.
Flags (cp-agent / cp-stream): `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--effort low|medium|high`, `--max-runtime`/`--idle-timeout`, `-q`.

> 📄 Full reference for terminal install, all commands, flags, and env overrides: [TERMINAL.md](TERMINAL.md).

## Windows

On native Windows (if you're not using WSL) the PowerShell variants kick in. **DeepSeek and Codex** run natively; Antigravity needs a pseudo-TTY, and OpenCode/Copilot are Unix-only v1, so install those under WSL.

- `/cli-dispatch:setup` → runs `install.ps1 -Backends <deepseek,codex|all>` (default `deepseek`):
  - **DeepSeek**: `claude-ds.ps1` + `claude-ds-stream.ps1` + `ds-agent.ps1` and `.cmd` shims into `~/.local/bin`, parser (`ds-stream-parse.mjs`) into `~/.local/share/cli-dispatch`.
  - **Codex**: `cx-stream.ps1` + `cx-agent.ps1` + `.cmd` shims and parser (`cx-stream-parse.mjs`). Auth: `codex login` (or `CODEX_API_KEY` in the config). Real `-s read-only` sandbox included.
  - The dashboard is always installed; the config is written to `~/.config/cli-dispatch/config`.
  - Add `-InstallMissing` to have `install.ps1` attempt auto-installing a missing worker CLI (npm, or a vendor fallback) and re-check with `Get-Command`, falling back to the existing warning on failure — opt-in, default off; auth is never automated.
- Repo tasks: `ds-worktree-run.ps1` / `cx-worktree-run.ps1` — use a **junction** instead of a symlink for `node_modules` (`New-Item -ItemType Junction`; doesn't require admin/developer-mode).
- If WSL or Git Bash is present, the Unix `.sh` scripts also work.

Requirements: PowerShell 5.1+ or pwsh 7+; `claude` for DeepSeek, `codex` for Codex, on PATH.

## Uninstall

For a full cleanup, in order: (1) remove the plugin, (2) delete the wrapper + config files, (3) clean up any temporary worktrees.

**Step 1 — Remove the plugin and marketplace** (from inside Claude Code CLI):

```text
/plugin uninstall cli-dispatch@cli-dispatch
/plugin marketplace remove cli-dispatch
/reload-plugins
```

**Step 2 — Delete the wrapper and config files:**

```bash
# macOS / Linux / WSL / Git Bash
rm -f  ~/.local/bin/claude-ds ~/.local/bin/claude-ds-stream ~/.local/bin/ds-agent
rm -f  ~/.local/bin/{ag,cx,oc,cp}-agent ~/.local/bin/{ag,cx,oc,cp}-stream
rm -f  ~/.local/bin/cli-dispatch-{run,wait,clean,gain,dashboard}
rm -f  ~/.local/bin/{ds,cx}-worktree-run.* ~/.local/bin/stream-utils.sh ~/.local/bin/version-check.sh
rm -rf ~/.local/share/cli-dispatch ~/.local/share/claude-ds   # engines/parsers (also legacy path)
rm -rf ~/.cache/cli-dispatch ~/.cache/claude-ds               # session records (also legacy path)
rm -rf ~/.config/cli-dispatch ~/.config/claude-ds             # config (incl. API key) — deleting removes the key too (also legacy path)
```

```powershell
# Native Windows (PowerShell)
Remove-Item -Force "$HOME\.local\bin\claude-ds.ps1","$HOME\.local\bin\claude-ds.cmd","$HOME\.local\bin\claude-ds-stream.ps1","$HOME\.local\bin\claude-ds-stream.cmd" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\.local\share\claude-ds" -ErrorAction SilentlyContinue   # stream parser
Remove-Item -Recurse -Force "$HOME\.cache\claude-ds" -ErrorAction SilentlyContinue          # session records
Remove-Item -Recurse -Force "$HOME\.config\claude-ds" -ErrorAction SilentlyContinue
```

**Step 3 — (Optional) clean up temporary worktrees:**

If you used `/cli-dispatch:ds-run` or `ds-worktree-run.sh`, separate git worktrees may remain. Check in the relevant repo:

```bash
git worktree list          # see worktrees claude-ds opened
git worktree remove <path> # remove the ones you don't need
git worktree prune         # clean up dead records
```

> Note: if you manually added `~/.local/bin` to PATH for this plugin and use nothing else from it, you can also remove that line from your shell profile (`~/.zshrc`, `~/.bashrc`, etc.). To revoke the API key on your DeepSeek account, delete it at https://platform.deepseek.com/api_keys.

## Security and data

- **Sandbox posture per backend:** only Codex's `--read-only` is a kernel-enforced OS sandbox (macOS Seatbelt / Linux bwrap+seccomp) — a genuine no-writes guarantee, no worktree required for pure analysis. DeepSeek's `--read-only` is a tool-layer restriction only. Antigravity, OpenCode, and Copilot have **no sandbox at all**. For everything else, isolate real repo work in a git worktree — agentic mode doesn't touch the main checkout/other branches; reviewing the diff (build/test) and merging is **up to you**.
- **Keys never leave your machine:** any key lives in `~/.config/cli-dispatch/config` (0600, outside the repo) and is **never committed**. The plugin/skill never writes a key anywhere; you add it. (Codex and Antigravity normally use their own OAuth sign-in — no key in the config at all.)
- **Data egress:** the **prompt and code you give a worker are sent to that backend's provider** — DeepSeek, Google (Gemini/Antigravity), OpenAI (Codex), OpenRouter/OpenCode, or GitHub Copilot. Use each only if you accept that. The dashboard and `*-balance` commands are local/read-only and send nothing extra on your behalf.
- **GitHub CLI (`gh`) auth forwarding:** on macOS, `gh` keeps its token in the system Keychain, which sandboxed workers (Codex's `workspace-write`, DeepSeek, agy, OpenCode, Copilot) can't reach — so delegated `gh issue`/`gh pr`/`gh api` calls silently fail. When you're logged in (`gh auth token` succeeds) and haven't set `GH_TOKEN`/`GITHUB_TOKEN` yourself, the runners **export your `gh` token into the worker as `GH_TOKEN`** so its `gh` calls authenticate. Copilot also uses that token path unless `COPILOT_GITHUB_TOKEN` is set explicitly. The token can carry broad scopes (`repo`, `workflow`, even `delete_repo`) and travels into the worker sandbox / provider context — **opt out** by setting `CLI_DISPATCH_NO_GH_TOKEN=1`. `/cli-dispatch:doctor` reports the current state.

## Architectural role

The worker (DeepSeek / Gemini / Codex / OpenCode / Copilot) = the doer (generation/implementation). You (Claude Code, Anthropic) = orchestrator + reviewer + git/merge owner. Don't trust a worker's output until you've verified it.

## License

MIT — see [LICENSE](LICENSE).
