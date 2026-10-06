# Usage

[← README](../README.md)

You use cli-dispatch **from inside Claude Code** — two ways:

1. **Slash commands** (table below) — typed at the `claude` session's prompt.
2. **Natural language** — say "do this with deepseek", "run this with codex", "delegate this to gemini"; the skill kicks in and Claude Code runs the work on the matching backend.

| Command | What it does |
|---------|--------------|
| `/cli-dispatch:setup` | Pick backend(s) + install + config skeleton + smoke test |
| `/cli-dispatch:ask <backend> "<prompt>"` | One-shot question/answer to a worker, no repo changes (`ds`/`cx` run `--read-only`; `ag`/`oc`/`cp` have no write-deny, so they run in a throwaway temp dir with no repo access). Agent flags such as `--model` / `--effort` go before the prompt. For repo work use `run` or the runner agent |
| `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` | Deterministic delegation, called directly — zero LLM tokens. From an orchestrator the default is the thin `cli-dispatch:runner` agent, which wraps this same runner |
| `/cli-dispatch:sessions [backend]` | List past/active sessions (all backends; shows a `backend` column); optional backend filter |
| `/cli-dispatch:watch <id> [--wait [--timeout S]]` | Show a session's live status (cost-aware; any backend). With `--wait`, block until it finishes (or times out) and print a compact summary — one blocking call instead of polling |
| `/cli-dispatch:resume <id> <prompt>` | Continue a worker session with a follow-up prompt (auto-detects backend) |
| `/cli-dispatch:kill <id>` | Stop a running worker session (SIGTERM + state → killed) |
| `/cli-dispatch:clean` | Remove stale worker dirs (`running`-but-dead); dry-run by default, `--remove` to delete. Removed sessions archive `verdict.json` and `verdict-diff.patch` under `<sessions-root>/verdict-archive/` by default; pass `--no-preserve-verdicts` to opt out. `--schedule [install|status|uninstall]` manages a daily auto-clean via the OS scheduler (launchd / cron / Scheduled Tasks); bare `--schedule` = `status` |
| `/cli-dispatch:doctor [backend]` | Health check — PATH, API keys, CLI auth ✓/✗, configured model per backend, stale-install warning; optional backend filter |
| `/cli-dispatch:balance [backend]` | DeepSeek balance + Antigravity quota + Codex rate limits + OpenCode credits + Copilot usage note; optional backend filter (see [Quota](quota.md)) |
| `/cli-dispatch:gain [--drift]` | Report worker token totals by backend, plus Anthropic cost of the `cli-dispatch:runner` agent and of legacy runner-subagent sessions; `--drift` adds the drift report |
| `/cli-dispatch:help` | One-screen command reference cheat sheet |

`backend` accepts the short or long slug: `ds`|`deepseek`, `ag`|`antigravity`, `cx`|`codex`, `oc`|`opencode`, `cp`|`copilot`.

`ask` on Codex uses a real OS read-only sandbox; DeepSeek takes `--effort`.
