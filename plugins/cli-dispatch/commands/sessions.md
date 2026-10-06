---
description: List cli-dispatch worker sessions (all backends, or one)
argument-hint: "[ds|ag|cx|oc|cp]"
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-sessions.sh"`

The session listing above already ran — do NOT run it again. If the user named a backend ($ARGUMENTS — ds|deepseek, ag|antigravity, cx|codex, oc|opencode, cp|copilot), show only that backend's rows; otherwise show everything. Present it as-is (an optional backend argument, short or long name, filters it),
newest first; the `backend` column shows which worker ran each session.
Cost-conscious: it reads only `meta.json` + `status.json`; `transcript.jsonl`
is NEVER read.

To see a session's detail/live status: `/cli-dispatch:watch <id>`.
To send a follow-up (continue the same session): `/cli-dispatch:resume <id> <follow-up>`.
