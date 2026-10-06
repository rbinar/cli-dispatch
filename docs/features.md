# Features

[← README](../README.md)

> ℹ️ **Multi-backend delegation hub.** Five worker backends — **DeepSeek** (`ds`), **Antigravity/Gemini** (`ag`, wrappers `ag-agent`/`ag-stream`), **Codex** (`cx`, `cx-agent`/`cx-stream`), **OpenCode** (`oc`, `oc-agent`/`oc-stream`), and **GitHub Copilot** (`cp`, `cp-agent`/`cp-stream`). Pick which to install at setup. All five write to the same session layout, so `sessions`/`watch` work across all. The DeepSeek wrapper/config paths keep the `claude-ds` name (that backend's name).

All used from inside Claude Code (`/cli-dispatch:run <backend> "<task>"`, `/cli-dispatch:ask <backend> "<prompt>"`, or "do <task> with deepseek/codex/gemini/opencode/copilot"):

- **Five worker backends, one hub** — **DeepSeek** (`ds-*`), **Antigravity / Gemini** (`ag-*`), **Codex / OpenAI** (`cx-*`), **OpenCode / OpenRouter** (`oc-*`), **GitHub Copilot** (`cp-*`). Pick any (or all) at setup; all five write the **same session layout**, so `sessions`, `watch`, `clean`, and the balance commands work across every backend.
- **Delegate & verify** — the worker generates/implements; Claude Code watches live and verifies the output. Conversation context is not shared → the task must be **self-contained**. The worker = doer, you = reviewer/merge owner.
- **Session tracking (live watch + resume)** — work is not an opaque background process; each run writes a session dir (status / progress / transcript / meta + the full prompt) and is observable and resumable. → [Session tracking](sessions.md#session-tracking-live-watch--resume)
- **Isolation & read-only** — real repo tasks run in a throwaway git worktree, diff left uncommitted; Codex's `--read-only` additionally activates a kernel-enforced no-writes sandbox. → [Security and data](security.md#security-and-data)
- **Deterministic runner + thin `cli-dispatch:runner` agent** — launches a worker, isolates real repo changes in a worktree, blocks until done, and gates on a machine-checkable `--verify` command, all in plain shell. The default path from an orchestrator is the `cli-dispatch:runner` agent: a haiku forwarder that starts the runner detached, blocks on it, retries a failing verify once, and returns the compact verdict (~3-4 turns, not a babysitter). `/cli-dispatch:run` is the direct path (zero LLM tokens). For judgment-heavy work with no verify command you read the compact verdict + diff yourself and follow up with `/cli-dispatch:resume`. → [Deterministic runner](runner.md#deterministic-runner-and-runner-agent)
- **Session-start policy injection (optional)** — a `SessionStart` hook auto-injects a compact delegation policy (deterministic-runner routing, escalation path, issue-filing reminder) into every session's context, configured once at `/cli-dispatch:setup`. Opt-in, default off, zero token cost when disabled. → [Session-start policy injection](policy-injection.md#session-start-policy-injection-optional)
- **Statusline badge (optional)** — a cyan `[CD]` badge with yellow per-backend counts for this Claude Code session's live workers. → [Statusline badge](statusline.md#statusline-badge)
- **Native usage / quota** — `/cli-dispatch:balance` (all five at once) or a per-backend `*-balance`; reverse-engineered from each CLI's own local data where available, **no third-party tools**. Copilot is explicitly not CLI-queryable. → [Usage & quota](quota.md#usage--quota--native-no-third-party-tool)
- **Housekeeping** — `/cli-dispatch:clean` prunes stale (`running`-but-dead) worker dirs; `/cli-dispatch:clean --schedule` automates it daily via launchd / cron / Scheduled Tasks.
- **Safety net & isolation** — a hung/runaway worker is auto-killed (with its child processes) at a runtime or idle limit, going `state: error`; workers do not inherit your `~/.claude` MCP servers (playwright, etc.).

> ⚠️ **The default mode is not a sandbox.** Workers run agentic → they **can write files / run bash**. Isolate real repo work in a worktree. Full sandbox posture per backend: [Security and data](security.md#security-and-data).

## Architectural role

The worker (DeepSeek / Gemini / Codex / OpenCode / Copilot) = the doer (generation/implementation). You (Claude Code, Anthropic) = orchestrator + reviewer + git/merge owner. Don't trust a worker's output until you've verified it.
