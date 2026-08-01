---
description: Show the OpenCode (OpenRouter) account balance
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh" --backend opencode`

The OpenRouter credits report above already ran — do NOT run it again.
Summarize `total_credits - total_usage` as the available paid-credit balance.
Never print a key VALUE.

This is PAID-CREDIT balance ONLY. `:free`-suffixed models use a separate
unauthenticated rate limit that this endpoint does not reflect, and OpenRouter
exposes no scriptable quota API for it. A `$0` or low number here does not mean
a free-tier user is out of quota; the signal is a 429 from opencode at call
time. Do not conflate the two.

No PowerShell/Windows section — OpenCode is Unix-only for now; Windows support
is deferred.
