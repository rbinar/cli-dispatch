---
description: Show the live status of a claude-ds session
argument-hint: <session-id>
allowed-tools: Bash
---

# Watch claude-ds session: $ARGUMENTS

Show the **compact** status of the given session. **Cost-conscious rule:** only the small
`status.json` (+ the last ~15 lines of `progress.log`) is read — the raw `transcript.jsonl`
is NEVER read, and it is not tailed repeatedly in a tight loop. When monitoring a background
run, call this ONCE per orchestration step.

```bash
SID="$ARGUMENTS"
ROOT="${CLAUDE_DS_SESSIONS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions}"
DIR="$ROOT/$SID"
if [ ! -d "$DIR" ]; then
  echo "no such session: $SID  (use /cli-dispatch:ds-sessions to list them)"
else
  echo "=== status.json ==="
  cat "$DIR/status.json"
  echo ""
  echo "=== progress.log (last 15 lines) ==="
  tail -n 15 "$DIR/progress.log" 2>/dev/null || echo "(no progress)"
fi
```

- `state: running` means the task is ongoing → check again later (not continuously).
- `state: done` → look at `finalResultPreview`; the full output is in `transcript.jsonl` (if needed).
- Follow-up task: `claude-ds-stream --resume $ARGUMENTS -p "<follow-up>"`.
