---
description: List GitHub Copilot worker sessions
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-sessions.sh" copilot`

The GitHub Copilot session listing above already ran — do NOT run it again.
Present it as-is, newest first; this filtered view has no backend column.
Cost-conscious: it reads only `meta.json` + `status.json`; `transcript.jsonl`
is NEVER read. For every backend at once use `/cli-dispatch:sessions`.

To see a session's detail/live status: `/cli-dispatch:watch <id>`.
To send a follow-up (continue the same session): `/cli-dispatch:resume <id> <follow-up>`.
