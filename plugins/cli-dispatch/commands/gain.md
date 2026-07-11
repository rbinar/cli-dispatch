---
description: Report worker token totals by backend
allowed-tools: Bash
---

# cli-dispatch gain

Read-only token accounting summary over worker session `status.json` files,
plus Anthropic babysitting token usage from runner subagent transcripts on this
machine (a subagent counts as a runner when it actually invoked a wrapper CLI —
`ds-agent`, `cx-stream`, etc. — in a Bash tool call; other subagents are
summarized in one line and excluded from the ratio).

Pass `--log` to also append a timestamped JSON snapshot of the report to
`~/.cache/cli-dispatch/gain-history.jsonl` (one line per run), so runs can be
compared over time even after `/cli-dispatch:clean` deletes old session dirs.

```bash
if command -v cli-dispatch-gain >/dev/null 2>&1; then
  cli-dispatch-gain "$@"
else
  node "${CLAUDE_PLUGIN_ROOT}/scripts/gain-report.mjs" "$@"
fi
```
