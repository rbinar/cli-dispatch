---
description: Full health check — CLIs on PATH, API keys, auth (✓ / ✗ per item)
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-doctor.sh" "${CLAUDE_PLUGIN_ROOT}"`

The health check above already ran — do NOT run it again.

Present it to the user as-is, grouped by the `──` section headings. `✓` = OK,
`✗` = action needed. Keep it compact; add no prose beyond what the report says.
The report never prints a key VALUE, only whether one is set — keep it that way.

If any `✗` appears, name the specific fix the line already suggests rather than
inventing a new one. If everything is green, mention the smoke test at the bottom
of the report and stop there.
