---
description: Check the OpenCode (OpenRouter) backend install status
allowed-tools: Bash
---

# OpenCode backend status

OpenCode-only health check (read-only; do NOT print the key VALUE). For all backends at once
use `/cli-dispatch:status`.

```bash
echo "== OpenCode backend (oc / OpenRouter) =="
command -v oc-agent  >/dev/null 2>&1 && echo "oc-agent:  installed ($(command -v oc-agent))"  || echo "oc-agent:  MISSING (enable with /cli-dispatch:setup)"
command -v oc-stream >/dev/null 2>&1 && echo "oc-stream: installed ($(command -v oc-stream))" || echo "oc-stream: MISSING (enable with /cli-dispatch:setup)"
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
if command -v opencode >/dev/null 2>&1; then
  echo "opencode CLI: found ($(opencode --version 2>/dev/null || echo 'version unknown'))"
else
  echo "opencode CLI: MISSING (npm i -g opencode-ai)"
fi
if [ -f "$CFG" ]; then
  ( . "$CFG"
    if [ -n "${OPENROUTER_API_KEY:-}" ]; then
      echo "auth: OPENROUTER_API_KEY set"
    else
      echo "auth: MISSING — OPENROUTER_API_KEY not set. OpenRouter has NO OAuth/login flow;"
      echo "      this is a HARD FAILURE, not optional. Add it via /cli-dispatch:setup."
    fi
    [ -n "${OC_MODEL:-}" ] && echo "model: OC_MODEL=${OC_MODEL}" || echo "model: OC_MODEL not set (opencode default used)"
  )
else
  echo "config: MISSING ($CFG) — OPENROUTER_API_KEY has no OAuth fallback; run /cli-dispatch:setup"
fi
command -v node >/dev/null 2>&1 && echo "node: found" || echo "node: MISSING (oc-stream parser needs it)"
```

If everything is in place, suggest an optional smoke test (background task):
`oc-agent -q "Reply with exactly: OK"`.
