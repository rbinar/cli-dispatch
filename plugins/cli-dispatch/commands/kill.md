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

# Kill the worker process TREE. worker.pid holds the *-stream wrapper's own PID (the tree
# root: worker CLI + parser pipeline) and is written for exactly this reason — the session id
# is NOT in the argv of oc/cp/ag workers, so the old pgrep -f "$SID" path found nothing and
# silently wrote a fake `killed` while the real worker kept burning tokens. Mirror
# stream-utils.sh's kill_worker: snapshot the whole subtree FIRST, TERM it (graceful — this
# also gives the parser its EOF window to write its OWN terminal record), sleep, then KILL the
# SAME captured pids so any process that ignored TERM / reparented is not missed.
# (bash-3.2 safe: no mapfile.)
proc_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do proc_tree "$child"; done
  printf '%s\n' "$pid"
}
kill_tree() {
  local root="$1" tree p
  tree="$(proc_tree "$root")"
  for p in $tree; do kill -TERM "$p" 2>/dev/null || true; done
  sleep 3
  for p in $tree; do kill -KILL "$p" 2>/dev/null || true; done
}

SIGNALLED=""
WPID=""
[ -f "$DIR/worker.pid" ] && WPID=$(tr -dc '0-9' < "$DIR/worker.pid" 2>/dev/null)
if [ -n "$WPID" ] && kill -0 "$WPID" 2>/dev/null; then
  kill_tree "$WPID"
  echo "killed worker process tree (root PID $WPID from worker.pid)"
  SIGNALLED=1
else
  # Fallback: no live worker.pid (old session predating the fix, or already exited) — find the
  # process owning this session by its id in argv, and tree-kill it too.
  PID=$(pgrep -f "$SID" 2>/dev/null | grep -v "^$$" | head -1)
  if [ -n "$PID" ]; then
    kill_tree "$PID"
    echo "killed process tree for PID $PID (worker.pid unavailable — matched session id in argv)"
    SIGNALLED=1
  else
    echo "process not found (no live worker.pid, nothing matched in process table) — may have already exited; updating state"
  fi
fi

# Give the parser a beat to finalize after the TERM/EOF above (kill_tree already waited 3s
# between TERM and KILL, but allow a little more slack for the status.json write to land).
[ -n "$SIGNALLED" ] && sleep 2

# Force state=killed ONLY if status is still non-terminal — never clobber a terminal record
# the parser wrote itself (error/done/killed). Reuse parse-utils' isNonTerminalState when the
# installed helper is reachable; fall back to its known non-terminal set otherwise.
CLI_DISPATCH_SESSION_DIR="$DIR" node -e '
const fs = require("fs");
const path = require("path");
const os = require("os");
const dir = process.env.CLI_DISPATCH_SESSION_DIR;
const statusPath = path.join(dir, "status.json");
const NON_TERMINAL_FALLBACK = new Set(["running", "human-controlled"]);
(async () => {
  let isNonTerminalState = (s) => NON_TERMINAL_FALLBACK.has(s);
  const share = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const candidates = [
    path.join(share, "cli-dispatch", "parse-utils.mjs"),
    path.join(os.homedir(), ".local", "share", "cli-dispatch", "parse-utils.mjs"),
    path.join(os.homedir(), ".local", "share", "claude-ds", "parse-utils.mjs"),
  ];
  for (const cand of candidates) {
    try {
      const m = await import("file://" + cand);
      if (m && typeof m.isNonTerminalState === "function") { isNonTerminalState = m.isNonTerminalState; break; }
    } catch {}
  }
  let s;
  try { s = JSON.parse(fs.readFileSync(statusPath, "utf8")); }
  catch (e) { console.error("could not read status.json:", e.message); return; }
  if (!isNonTerminalState(s.state)) {
    console.log("state already terminal (" + s.state + ") — left as-is (worker wrote its own final record)");
    return;
  }
  s.state = "killed";
  s.killedAt = new Date().toISOString();
  try { fs.writeFileSync(statusPath, JSON.stringify(s, null, 2) + "\n"); console.log("state → killed"); }
  catch (e) { console.error("could not update status.json:", e.message); }
})();
'
```
