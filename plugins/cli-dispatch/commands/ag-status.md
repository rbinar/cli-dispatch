---
description: Check the Antigravity (agy / Gemini) backend install status
allowed-tools: Bash
---

# Antigravity backend status

Antigravity-only health check (read-only; do NOT print the key VALUE). For all backends at
once use `/cli-dispatch:ds-status`.

```bash
echo "== Antigravity backend (agy / Gemini) =="
command -v ag-agent  >/dev/null 2>&1 && echo "ag-agent:  installed ($(command -v ag-agent))"  || echo "ag-agent:  MISSING (enable with /cli-dispatch:ds-setup)"
command -v ag-stream >/dev/null 2>&1 && echo "ag-stream: installed ($(command -v ag-stream))" || echo "ag-stream: MISSING (enable with /cli-dispatch:ds-setup)"
CFG="${CLAUDE_DS_CONFIG:-$HOME/.config/claude-ds/config}"
if command -v agy >/dev/null 2>&1; then
  echo "agy CLI: found ($(agy --version 2>/dev/null))"
  if [ -f "$CFG" ]; then
    ( . "$CFG"
      if [ -n "${GEMINI_API_KEY:-}" ]; then echo "auth: GEMINI_API_KEY set"
      elif [ -n "${ANTIGRAVITY_API_KEY:-}" ]; then echo "auth: ANTIGRAVITY_API_KEY set"
      else echo "auth: via Google sign-in (run 'agy' once if not signed in)"; fi
      [ -n "${AG_MODEL:-}" ] && echo "model: AG_MODEL=${AG_MODEL}" || echo "model: AG_MODEL not set (agy default used)"
    )
  else
    echo "config: not found ($CFG) — auth via Google sign-in or GEMINI_API_KEY"
  fi
else
  echo "agy CLI: MISSING (curl -fsSL https://antigravity.google/cli/install.sh | bash)"
fi
command -v script >/dev/null 2>&1 && echo "script (pseudo-tty): found" || echo "script (pseudo-tty): MISSING (ag backend needs it)"
command -v node   >/dev/null 2>&1 && echo "node: found" || echo "node: MISSING (ag-stream parser needs it)"
```

If everything is in place, suggest an optional smoke test (background task):
`ag-agent -q "Reply with exactly: OK"`.
