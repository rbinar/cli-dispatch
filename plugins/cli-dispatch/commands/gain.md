---
description: Report worker token totals by backend
allowed-tools: Bash
---

# cli-dispatch gain

Read-only token accounting summary over worker session `status.json` files,
plus Anthropic babysitting token usage from legacy runner-subagent transcripts on this
machine (a subagent counted as a runner when it actually invoked a wrapper CLI —
`ds-agent`, `cx-stream`, etc. — in a Bash tool call; other subagents are
summarized in one line and excluded from the ratio). The five per-backend runner
subagents (`ds-/ag-/cx-/oc-/cp-runner`) have since been retired — measured babysitting
overhead ran ~906% of worker output — in favor of the deterministic runner
(`/cli-dispatch:run`, zero LLM babysitter tokens); this report's babysitter/worker ratio
reflects historical sessions from before that change.

```bash
if command -v cli-dispatch-gain >/dev/null 2>&1; then
  cli-dispatch-gain "$@"
else
  node "${CLAUDE_PLUGIN_ROOT}/scripts/gain-report.mjs" "$@"
fi
```
