---
description: Open the cli-dispatch dashboard (local web — Claude Code sessions, subagents, flow + workers)
allowed-tools: Bash
---

# cli-dispatch dashboard

Launch the **local, read-only web dashboard**. It shows active Claude Code CLI sessions
(across all projects, active pinned on top); click a session to see its **flow**, the
**subagents** it spawned, and click a subagent to drill into *its* flow — plus a panel for the
cli-dispatch **worker** delegations (DeepSeek / Antigravity / Codex / OpenCode).

> Read-only. Binds `127.0.0.1` only. No config/secret access. This is the only long-running
> process the plugin starts — it serves until you stop it (the printed `kill <pid>`, or Ctrl-C
> if you run `cli-dispatch-dashboard` yourself in a terminal).

```bash
if ! command -v cli-dispatch-dashboard >/dev/null 2>&1; then
  echo "cli-dispatch-dashboard not installed. Run /cli-dispatch:setup, then retry."
  echo "(or run it from the repo: node plugins/cli-dispatch/scripts/dashboard-server.mjs)"
  exit 0
fi
LOG="${TMPDIR:-/tmp}/cli-dispatch-dashboard.log"
nohup cli-dispatch-dashboard --no-open >"$LOG" 2>&1 &
PID=$!
# wait briefly for the bound URL to appear in the log
for i in 1 2 3 4 5 6 7 8; do
  URL=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$LOG" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 0.4
done
if [ -z "$URL" ]; then echo "Dashboard failed to start. Log: $LOG"; cat "$LOG" 2>/dev/null | tail -5; exit 0; fi
# open the browser (best-effort, cross-platform)
if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$URL" >/dev/null 2>&1 || true
fi
echo "Dashboard running → $URL  (pid $PID)"
echo "Stop it with:  kill $PID"
```

Tell the user the URL and that it's now open in their browser; remind them how to stop it.
