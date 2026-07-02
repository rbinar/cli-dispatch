---
description: Show the OpenCode (OpenRouter) account balance
allowed-tools: Bash
---

# OpenCode (OpenRouter) balance

Call the OpenRouter credits API with the `OPENROUTER_API_KEY` from the config and show the
result. **Do not print the key VALUE** — only present the balance info.

```bash
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:setup"; exit 1; fi
# shellcheck disable=SC1090
. "$CFG"
if [ -z "${OPENROUTER_API_KEY:-}" ]; then echo "key: MISSING — add OPENROUTER_API_KEY to the config (/cli-dispatch:setup)"; exit 1; fi
curl -sS --max-time 20 https://openrouter.ai/api/v1/credits \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Accept: application/json"
echo
```

The returned JSON has the shape:

```json
{"data":{"total_credits":<num>,"total_usage":<num>}}
```

- `total_credits` — total credits ever purchased/granted on the account
- `total_usage` — total credits spent so far
- available balance = `total_credits - total_usage`

> **This is PAID-CREDIT balance ONLY.** `:free`-suffixed models (e.g.
> `google/gemma-4-31b-it:free`) run on a **separate, unauthenticated rate limit** that this
> endpoint does **not** reflect, and OpenRouter exposes **no scriptable quota API** for it. A
> `$0` or low number here does **not** mean a free-tier user is "out of quota" — if a free-tier
> call gets throttled, the signal is a **429 error from opencode itself** at call time, not
> anything visible via this endpoint. Do not conflate the two.

No PowerShell/Windows section — OpenCode is Unix-only for now; Windows support is deferred.

Summarize `total_credits - total_usage` for the user as the available (paid-credit) balance, and
call out explicitly if it looks like they're relying on `:free` models (in which case this number
is not the relevant signal).
