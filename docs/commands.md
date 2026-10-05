# Usage

[← README](../README.md)

You use cli-dispatch **from inside Claude Code** — two ways:

1. **Slash commands** (table below) — typed at the `claude` session's prompt.
2. **Natural language** — say "do this with deepseek", "run this with codex", "delegate this to gemini"; the skill kicks in and Claude Code runs the work on the matching backend.

| Command | What it does |
|---------|--------------|
| `/cli-dispatch:setup` | Pick backend(s) + install + config skeleton + smoke test |
| `/cli-dispatch:ds-run <task>` | Delegate a task to **DeepSeek** (session-tracked; worktree isolation for repo tasks) |
| `/cli-dispatch:ag-run <task>` | Delegate a task to **Antigravity (Gemini)** (same workflow) |
| `/cli-dispatch:cx-run <task>` | Delegate a task to **Codex (OpenAI)** (real read-only sandbox; same session layout) |
| `/cli-dispatch:oc-run <task>` | Delegate a task to **OpenCode (OpenRouter)** (no sandbox — worktree isolation only; same session layout) |
| `/cli-dispatch:cp-run <task>` | Delegate a task to **GitHub Copilot** (no sandbox — worktree isolation only; same session layout) |
| `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` | Deterministic delegation, called directly — zero LLM tokens. From an orchestrator the default is the thin `cli-dispatch:runner` agent, which wraps this same runner |
| `/cli-dispatch:sessions` | List past/active sessions (all backends; shows a `backend` column) |
| `/cli-dispatch:ds-sessions` / `ag-sessions` / `cx-sessions` / `oc-sessions` / `cp-sessions` | Same list, filtered to just DeepSeek / Antigravity / Codex / OpenCode / Copilot |
| `/cli-dispatch:watch <id>` | Show a session's live status (cost-aware; any backend) |
| `/cli-dispatch:wait <id>` | Block until a session finishes (or times out), then print a compact summary — one blocking call instead of polling `watch` |
| `/cli-dispatch:resume <id> <prompt>` | Continue a worker session with a follow-up prompt (auto-detects backend) |
| `/cli-dispatch:kill <id>` | Stop a running worker session (SIGTERM + state → killed) |
| `/cli-dispatch:clean` | Remove stale worker dirs (`running`-but-dead); dry-run by default, `--remove` to delete. Removed sessions archive `verdict.json` and `verdict-diff.patch` under `<sessions-root>/verdict-archive/` by default; pass `--no-preserve-verdicts` to opt out. |
| `/cli-dispatch:clean-schedule` | Schedule a daily auto-clean via the OS scheduler (launchd / cron / Scheduled Tasks); `status` / `uninstall` too |
| `/cli-dispatch:status` | Check install/key/CLI status for all backends |
| `/cli-dispatch:ds-status` / `ag-status` / `cx-status` / `oc-status` / `cp-status` | Same check, scoped to just DeepSeek / Antigravity / Codex / OpenCode / Copilot |
| `/cli-dispatch:balance` | Aggregate — DeepSeek balance + Antigravity quota + Codex rate limits + OpenCode credits + Copilot usage note, all at once |
| `/cli-dispatch:ds-balance` | Show DeepSeek account balance |
| `/cli-dispatch:cx-balance` | Show Codex usage / rate limits (5h + weekly % left) — native, from codex's own on-disk session records |
| `/cli-dispatch:ag-balance` | Show Antigravity quota (% left per model + plan) — native, via the local language-server `GetUserStatus` RPC |
| `/cli-dispatch:oc-balance` | Show OpenCode's OpenRouter paid-credit balance (`total_credits - total_usage`) — `:free` models have no quota API |
| `/cli-dispatch:cp-balance` | Explain Copilot usage visibility — not queryable from the CLI; use GitHub Billing |
| `/cli-dispatch:gain` | Report worker token totals by backend, plus Anthropic cost of the `cli-dispatch:runner` agent and of legacy runner-subagent sessions |
| `/cli-dispatch:doctor` | Health check for all backends — PATH, API keys, CLI auth ✓/✗ |
| `/cli-dispatch:help` | One-screen command reference cheat sheet |
