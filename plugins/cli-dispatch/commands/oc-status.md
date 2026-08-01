---
description: Check the OpenCode (OpenRouter) backend install status
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-status.sh" --backend opencode "${CLAUDE_PLUGIN_ROOT}"`

The OpenCode status report above already ran — do NOT run it again. Present it
as-is and keep it compact. The report never prints a key VALUE, only whether
one is set — keep it that way. For all backends use `/cli-dispatch:status`.

If everything is in place, suggest an optional smoke test (background task):
`oc-agent -q "Reply with exactly: OK"`.
