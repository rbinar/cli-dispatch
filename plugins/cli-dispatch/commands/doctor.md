---
description: Full health check — CLIs on PATH, API keys, auth, models, stale install (✓ / ✗ per item)
argument-hint: "[ds|ag|cx|oc|cp]"
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-doctor.sh" "${CLAUDE_PLUGIN_ROOT}" $ARGUMENTS`

The health check above already ran — do NOT run it again.

Present it to the user as-is, grouped by the `──` section headings. An optional backend
argument (`ds`, `ag`, `cx`, `oc`, `cp`, or the long name) limits the report to that backend. `✓` = OK,
`✗` = action needed. Keep it compact; add no prose beyond what the report says.
The report never prints a key VALUE, only whether one is set — keep it that way.

If any `✗` appears, name the specific fix the line already suggests rather than
inventing a new one. If everything is green, mention the smoke test at the bottom
of the report and stop there.

A `stale` line means the installed wrappers are older than the plugin: re-run
`/cli-dispatch:setup`.

**Native Windows only** — if the block above failed because `bash` is unavailable,
run the PowerShell twin instead (it covers DeepSeek and Codex; the Antigravity,
OpenCode and Copilot backends are Unix-only):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:CLAUDE_PLUGIN_ROOT/scripts/cli-dispatch-status.ps1" -PluginRoot "$env:CLAUDE_PLUGIN_ROOT"
```
