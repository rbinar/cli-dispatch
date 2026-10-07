# Usage & quota — native, no third-party tool

[← README](../README.md)

"How much of my limit is left?" — answered for **every** backend without installing anything
extra. Each backend check reverse-engineers data the CLI already keeps locally; nothing
new is sent over the network on your behalf.

Use `/cli-dispatch:balance` to see all five at once, or one backend with `/cli-dispatch:balance <backend>`.

| Backend | Command | Where the number comes from |
|---|---|---|
| **All** | `/cli-dispatch:balance` | Runs the five below in one go and summarizes each headline number side by side. |
| **DeepSeek** | `/cli-dispatch:balance ds` | DeepSeek's official REST balance API (`/user/balance`), using your `DEEPSEEK_API_KEY`. |
| **Codex** | `/cli-dispatch:balance cx` | Codex **persists** the backend's rate-limit payload into its own session records (`~/.codex/sessions/**/*.jsonl`). The command reads the newest `token_count` record's `rate_limits` → `primary` (5h) + `secondary` (7d) windows as **% left** + reset. No network. |
| **Antigravity** | `/cli-dispatch:balance ag` | The local Antigravity **language server** (the one the IDE/`agy` already run) exposes a Connect-RPC `GetUserStatus` endpoint. The command finds the running `language_server` process, reads its `--csrf_token` arg + listening port, then `POST`s `GetUserStatus` → plan + **per-model `remainingFraction`** + reset. |
| **OpenCode** | `/cli-dispatch:balance oc` | OpenRouter's official REST endpoint (`GET /api/v1/credits`), using your `OPENROUTER_API_KEY` → `total_credits - total_usage` remaining. **Paid-credit balance only** — `:free`-suffixed models have separate, unauthenticated per-model rate limits with no scriptable quota API. |
| **GitHub Copilot** | `/cli-dispatch:balance cp` | Not queryable from the `copilot` CLI. `/usage` is session-scoped and interactive-only inside a Copilot REPL; use GitHub Billing (https://github.com/settings/billing) for actual usage/limits. |

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
