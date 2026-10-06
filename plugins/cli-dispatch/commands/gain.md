---
description: Report worker token totals by backend; --drift measures delegation drift
argument-hint: "[--drift [--days N] [--json]]"
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

With `--drift` it instead runs the delegation-drift report (injected policy vs. deterministic
runner use). Present that report compactly and never quote transcript contents. If the output is
JSON, return only a brief summary of the top-level numbers unless the user explicitly asked for
the raw JSON. If drift is reported, keep the suggested fix exactly in the form the report gives:
`/cli-dispatch:run <backend> "<task>" --verify '<cmd>'`.

```bash
set -- $ARGUMENTS
if [ "${1:-}" = "--drift" ]; then
  shift
  node "${CLAUDE_PLUGIN_ROOT}/scripts/drift-report.mjs" "$@"
elif command -v cli-dispatch-gain >/dev/null 2>&1; then
  cli-dispatch-gain "$@"
else
  node "${CLAUDE_PLUGIN_ROOT}/scripts/gain-report.mjs" "$@"
fi
```
