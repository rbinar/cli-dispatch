---
description: Explain GitHub Copilot usage/balance visibility
allowed-tools: Bash
---

# GitHub Copilot balance

GitHub Copilot usage and remaining credits are **not queryable from the `copilot` CLI**.
Do not call any GitHub billing REST API here.

```bash
echo "== GitHub Copilot =="
echo "balance: not queryable from the copilot CLI"
echo "note: /usage is session-scoped and interactive-only inside a copilot REPL session; it is not scriptable."
echo "usage/limits: https://github.com/settings/billing"
echo "auth: requires an active GitHub Copilot subscription"
```

Tell the user plainly that cli-dispatch cannot show a numeric Copilot balance. For actual
usage and limits, point them to GitHub Billing: https://github.com/settings/billing.
