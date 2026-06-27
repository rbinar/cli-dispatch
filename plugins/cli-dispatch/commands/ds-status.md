---
description: Check the claude-ds (DeepSeek) backend install status
allowed-tools: Bash
---

# DeepSeek backend status

DeepSeek-only health check (read-only; do NOT print the key VALUE). For all backends at once
use `/cli-dispatch:status`.

```bash
echo "== DeepSeek backend (claude-ds) =="
command -v claude-ds        >/dev/null 2>&1 && echo "claude-ds:        installed ($(command -v claude-ds))"        || echo "claude-ds:        MISSING (run /cli-dispatch:setup)"
command -v claude-ds-stream >/dev/null 2>&1 && echo "claude-ds-stream: installed ($(command -v claude-ds-stream))" || echo "claude-ds-stream: MISSING (run /cli-dispatch:setup)"
command -v ds-agent         >/dev/null 2>&1 && echo "ds-agent:         installed ($(command -v ds-agent))"         || echo "ds-agent:         MISSING (run /cli-dispatch:setup)"
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
if [ -f "$CFG" ]; then
  ( . "$CFG"
    [ -n "${DEEPSEEK_API_KEY:-}" ] && echo "key: DEEPSEEK_API_KEY set" || echo "key: MISSING (add it to $CFG)"
    [ -n "${DS_MODEL:-}" ] && echo "model: DS_MODEL=${DS_MODEL}" || echo "model: DS_MODEL not set (default deepseek-v4-pro)"
  )
else
  echo "config: MISSING ($CFG) — run /cli-dispatch:setup"
fi
command -v claude >/dev/null 2>&1 && echo "claude CLI: found (the DeepSeek worker wraps it)" || echo "claude CLI: MISSING (the DeepSeek worker wraps it)"
command -v node   >/dev/null 2>&1 && echo "node: found" || echo "node: MISSING (claude-ds-stream parser needs it)"
```

If everything is in place, suggest an optional smoke test (background task):
`claude-ds -p "Reply with exactly: OK"`.
