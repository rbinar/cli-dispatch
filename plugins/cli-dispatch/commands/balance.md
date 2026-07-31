---
description: Show usage/balance for all backends at once (DeepSeek + Antigravity + Codex + OpenCode + Copilot)
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh"`

The report above already ran — do NOT run it again. It is the aggregate of the
per-backend commands (`/cli-dispatch:ds-balance`, `ag-`, `cx-`, `oc-`, `cp-`).

Summarize one headline number per `==` section and nothing more:

- **DeepSeek** — `total_balance` per currency, from the raw JSON.
- **Antigravity** — per-model `% left`.
- **Codex** — 5h and 7d `% left`. This figure is only as fresh as the last
  *interactive* codex turn; exec/`-q` runs report `rate_limits:null`.
- **OpenCode** — `total_credits - total_usage`. This is the **paid-credit**
  balance only. `:free` models have no quota API, so a low or zero number here
  does NOT mean a free-tier user is out of quota — free-tier limits only surface
  as a 429 from opencode itself.
- **Copilot** — no numeric balance exists from the CLI; point the user at
  https://github.com/settings/billing.

**Never print any key VALUE** — only the balance/quota figures. An unconfigured or
offline backend prints a short note instead of a number; report that note as-is
rather than treating it as an error.
