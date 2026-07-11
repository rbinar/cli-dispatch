---
description: Block until a cli-dispatch worker session completes, then print a compact summary
argument-hint: <session-id> [--timeout SECS] [--poll SECS]
allowed-tools: Bash
---

# Wait for cli-dispatch session: $ARGUMENTS

Block until the given session reaches a terminal state (`done` / `error` / `killed`) or the
timeout expires, then print a compact summary (phase, diffstat, usage tokens, bounded tail of
the last assistant message). **Cost-conscious rule:** this is ONE blocking call — use it
instead of repeated `/cli-dispatch:watch` polling; the raw `transcript.jsonl` is never read
into context beyond the bounded tail.

```bash
set -- $ARGUMENTS
if [ -z "${1:-}" ]; then
  echo "usage: /cli-dispatch:wait <session-id> [--timeout SECS] [--poll SECS]"
  echo "tip:   /cli-dispatch:sessions  to list session ids"
  exit 1
fi
if command -v cli-dispatch-wait >/dev/null 2>&1; then
  cli-dispatch-wait "$@"
else
  echo "cli-dispatch-wait not found on PATH — re-run /cli-dispatch:setup (or scripts/install.sh)."
  echo "Fallback: /cli-dispatch:watch $1 (single non-blocking status check)."
  exit 1
fi
```

Exit codes: `0` done, `1` error/killed (also usage/not-found), `2` timeout.

- Default: no timeout (waits until terminal state), poll every 10s (wall-clock only — zero
  token cost while waiting). Pass `--timeout SECS` to bound the wait.
- Continue the session afterwards: `/cli-dispatch:resume <id> <follow-up>` (auto-detects backend).
