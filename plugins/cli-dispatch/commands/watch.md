---
description: Show the live status of a cli-dispatch worker session, or block until it finishes with --wait
argument-hint: <session-id> [--wait] [--timeout SECS] [--poll SECS]
allowed-tools: Bash
---

# Watch cli-dispatch session: $ARGUMENTS

Show the **compact** status of the given session. **Cost-conscious rule:** only the small
`status.json` (+ the last ~15 lines of `progress.log`) is read — the raw `transcript.jsonl`
is NEVER read, and it is not tailed repeatedly in a tight loop. When monitoring a background
run, call this ONCE per orchestration step.

With `--wait` (anywhere after the id) it instead blocks in ONE call until the session reaches a
terminal state (`done` / `error` / `killed`) or the timeout expires, then prints a compact
summary (phase, diffstat, usage tokens, bounded tail of the last assistant message). Prefer it
to repeated polling: waiting costs no tokens.

```bash
# The user's text is pasted in before bash parses it, so it is kept in a quoted heredoc and split
# by a tokenizer that expands nothing. (`read`, not $(cat): bash 3.2 mis-parses a lone quote in $( ).)
IFS= read -r -d '' ARGS_RAW <<'CLI_DISPATCH_ARGS_EOF_9f2c' || true
$ARGUMENTS
CLI_DISPATCH_ARGS_EOF_9f2c
_AF="$(mktemp)"; printf '%s' "$ARGS_RAW" | node "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-args.mjs" > "$_AF" || { rm -f "$_AF"; exit 2; }
set --; while IFS= read -r -d '' a; do set -- "$@" "$a"; done < "$_AF"; rm -f "$_AF"
SID="${1:-}"
if [ -z "$SID" ]; then
  echo "usage: /cli-dispatch:watch <session-id> [--wait] [--timeout SECS] [--poll SECS]"
  echo "tip:   /cli-dispatch:sessions  to list session ids"
  exit 1
fi
shift
WAIT=0; REST=()
for a in "$@"; do
  if [ "$a" = "--wait" ]; then WAIT=1; else REST+=("$a"); fi
done
if [ "$WAIT" = 1 ]; then
  if command -v cli-dispatch-wait >/dev/null 2>&1; then
    cli-dispatch-wait "$SID" ${REST[@]+"${REST[@]}"}
  else
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-wait" "$SID" ${REST[@]+"${REST[@]}"}
  fi
  exit $?
fi
ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"; [ -n "$ROOT" ] || { _c="${XDG_CACHE_HOME:-$HOME/.cache}"; ROOT="$_c/cli-dispatch/sessions"; [ -d "$ROOT" ] || [ ! -d "$_c/claude-ds/sessions" ] || ROOT="$_c/claude-ds/sessions"; }
DIR="$ROOT/$SID"
if [ ! -d "$DIR" ]; then
  echo "no such session: $SID  (use /cli-dispatch:sessions to list them)"
else
  echo "=== status.json ==="
  cat "$DIR/status.json"
  echo ""
  echo "=== progress.log (last 15 lines) ==="
  tail -n 15 "$DIR/progress.log" 2>/dev/null || echo "(no progress)"
fi
```

- `--wait` exit codes: `0` done, `1` error/killed (also usage/not-found), `2` timeout. Default:
  no timeout, poll every 10s; pass `--timeout SECS` to bound the wait.
- `state: running` means the task is ongoing → check again later (not continuously).
- `state: done` → look at `finalResultPreview`; the full output is in `transcript.jsonl` (if needed).
- Continue the session: `/cli-dispatch:resume <id> <follow-up>` (auto-detects backend).
