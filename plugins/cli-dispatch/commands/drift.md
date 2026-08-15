---
description: Measure delegation drift between injected policy and deterministic runner use
argument-hint: [--days N] [--json]
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/drift-report.mjs" $ARGUMENTS`

The drift report above already ran — do NOT run it again.

Present the report compactly. Do not quote transcript contents. If the output is JSON,
return only a brief summary of the top-level numbers unless the user explicitly asked to
consume the raw JSON. If drift is reported, keep the suggested fix exactly in the form the
report gives: `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'`.
