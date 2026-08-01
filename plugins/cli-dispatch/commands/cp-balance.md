---
description: Explain GitHub Copilot usage/balance visibility
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh" --backend copilot`

The Copilot visibility report above already ran — do NOT run it again. Tell the
user plainly that cli-dispatch cannot show a numeric Copilot balance.

GitHub Copilot usage and remaining credits are not queryable from the `copilot`
CLI. Do not call any GitHub billing REST API here. For actual usage and limits,
point to GitHub Billing: https://github.com/settings/billing. Never print a key
VALUE.
