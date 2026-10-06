---
description: Continue a cli-dispatch worker session with a follow-up prompt (auto-detects backend)
argument-hint: <session-id> <follow-up prompt>
allowed-tools: Bash
---

# Resume cli-dispatch session

Usage: `/cli-dispatch:resume <session-id> <follow-up prompt>`

Auto-detects backend (DeepSeek / Antigravity / Codex / OpenCode / Copilot) from the session's `status.json`.

```bash
# The user's text is pasted into this script before bash parses it (never mention the
# placeholder in a comment: it would be pasted there too). A quoted heredoc keeps it unexpanded,
# so the follow-up reaches the worker byte-for-byte as ONE argument. `read`, not $(cat): bash 3.2
# mis-parses a lone quote inside $( ).
IFS= read -r -d '' ARGS <<'CLI_DISPATCH_ARGS_EOF_9f2c' || true
$ARGUMENTS
CLI_DISPATCH_ARGS_EOF_9f2c
ARGS="${ARGS%$'\n'}"
ARGS="${ARGS#"${ARGS%%[![:space:]]*}"}"
SID="${ARGS%%[[:space:]]*}"
PROMPT="${ARGS#"$SID"}"
PROMPT="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
if [ -z "$SID" ] || [ -z "$PROMPT" ]; then
  echo "usage: /cli-dispatch:resume <session-id> <follow-up prompt>"
  echo "tip:   /cli-dispatch:sessions  to list session ids"
  exit 1
fi

ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
[ -n "$ROOT" ] || { _c="${XDG_CACHE_HOME:-$HOME/.cache}"; ROOT="$_c/cli-dispatch/sessions"; [ -d "$ROOT" ] || [ ! -d "$_c/claude-ds/sessions" ] || ROOT="$_c/claude-ds/sessions"; }
DIR="$ROOT/$SID"

if [ ! -d "$DIR" ]; then
  echo "no such session: $SID  (use /cli-dispatch:sessions to list)"
  exit 1
fi

BACKEND=$(CLI_DISPATCH_SESSION_DIR="$DIR" node -e "
const fs=require('fs');
const d=process.env.CLI_DISPATCH_SESSION_DIR;
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return{}}};
const s=read(d+'/status.json'), m=read(d+'/meta.json');
const b=s.backend||m.backend;
if(!b){process.stderr.write('warning: no backend field in session metadata, assuming deepseek\n');}
process.stdout.write(b||'deepseek');
" 2>/dev/null)

echo "session: $SID  backend: $BACKEND"
printf 'prompt:  %s\n' "$PROMPT"
echo ""

case "$BACKEND" in
  deepseek|claude-ds|"")
    claude-ds-stream --resume "$SID" -p "$PROMPT"
    ;;
  antigravity|agy)
    ag-agent --resume "$SID" "$PROMPT"
    ;;
  codex|cx)
    cx-agent --resume "$SID" "$PROMPT"
    ;;
  opencode|oc)
    oc-agent --resume "$SID" "$PROMPT"
    ;;
  copilot|cp)
    cp-agent --resume "$SID" "$PROMPT"
    ;;
  *)
    echo "unknown backend '$BACKEND' — run manually:"
    echo "  deepseek:    claude-ds-stream --resume $SID -p \"$PROMPT\""
    echo "  antigravity: ag-agent --resume $SID \"$PROMPT\""
    echo "  codex:       cx-agent --resume $SID \"$PROMPT\""
    echo "  opencode:    oc-agent --resume $SID \"$PROMPT\""
    echo "  copilot:     cp-agent --resume $SID \"$PROMPT\""
    exit 1
    ;;
esac
```
