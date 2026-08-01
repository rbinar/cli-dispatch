---
description: List cli-dispatch worker sessions (all backends: DeepSeek + Antigravity + Codex + OpenCode + Copilot)
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-sessions.sh"`

The session listing above already ran — do NOT run it again. Present it as-is,
newest first; the `backend` column shows which worker ran each session.
Cost-conscious: it reads only `meta.json` + `status.json`; `transcript.jsonl`
is NEVER read.

To see a session's detail/live status: `/cli-dispatch:watch <id>`.
To send a follow-up (continue the same session): `/cli-dispatch:resume <id> <follow-up>`.
