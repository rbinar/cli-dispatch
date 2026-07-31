---
description: Check the cli-dispatch installation status (DeepSeek + Antigravity + Codex + OpenCode + Copilot)
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-status.sh"`

The status report above already ran — do NOT run it again.

Present it to the user as-is, grouped by the `==` backend headings. Keep it compact;
add no prose beyond what the report says. The report never prints a key VALUE, only
whether one is set — keep it that way.

If everything is in place, suggest an optional smoke test (as a background task):
`claude-ds -p "Reply with exactly: OK"`.

**Native Windows only** — if the block above failed because `bash` is unavailable,
run the PowerShell twin instead (it covers DeepSeek and Codex; the Antigravity,
OpenCode and Copilot backends are Unix-only):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:CLAUDE_PLUGIN_ROOT/scripts/cli-dispatch-status.ps1"
```
