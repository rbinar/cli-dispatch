---
description: Stop a running cli-dispatch worker session
argument-hint: <session-id>
allowed-tools: Bash
---

# Kill worker session: $ARGUMENTS

Send SIGTERM to the worker process for session `$ARGUMENTS` and mark it as `killed`.

```bash
SID="$ARGUMENTS"
if [ -z "$SID" ]; then echo "usage: /cli-dispatch:kill <session-id>  (use /cli-dispatch:sessions to list)"; exit 1; fi

ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
[ -n "$ROOT" ] || { _c="${XDG_CACHE_HOME:-$HOME/.cache}"; ROOT="$_c/cli-dispatch/sessions"; [ -d "$ROOT" ] || [ ! -d "$_c/claude-ds/sessions" ] || ROOT="$_c/claude-ds/sessions"; }
DIR="$ROOT/$SID"

if [ ! -d "$DIR" ]; then
  echo "no such session: $SID  (use /cli-dispatch:sessions to list)"
  exit 1
fi

STATE=$(CLI_DISPATCH_SESSION_DIR="$DIR" node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.CLI_DISPATCH_SESSION_DIR+'/status.json','utf8')).state||'')}catch{}" 2>/dev/null)
if [ "$STATE" != "running" ]; then
  echo "session $SID is not running (state: ${STATE:-unknown}) — nothing to kill"
  exit 0
fi

# Find the process owning this session by its id in argv
PID=$(pgrep -f "$SID" 2>/dev/null | grep -v "^$$" | head -1)

if [ -n "$PID" ]; then
  kill -TERM "$PID" 2>/dev/null && echo "sent SIGTERM to PID $PID" || echo "process $PID already exited"
else
  echo "process not found in process table — may have already exited; updating state"
fi

CLI_DISPATCH_SESSION_DIR="$DIR" node -e "
const fs = require('fs');
const p = process.env.CLI_DISPATCH_SESSION_DIR + '/status.json';
try {
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  s.state = 'killed';
  s.killedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  console.log('state → killed');
} catch(e) { console.error('could not update status.json:', e.message); }
"
```
