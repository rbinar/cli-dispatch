---
description: Check the Codex (OpenAI Codex CLI) backend install status
allowed-tools: Bash
---

# Codex backend status

Codex-only health check (read-only; do NOT print the key VALUE). For all backends at once
use `/cli-dispatch:ds-status`.

```bash
echo "== Codex backend (cx / OpenAI) =="
command -v cx-agent  >/dev/null 2>&1 && echo "cx-agent:  installed ($(command -v cx-agent))"  || echo "cx-agent:  MISSING (enable with /cli-dispatch:ds-setup)"
command -v cx-stream >/dev/null 2>&1 && echo "cx-stream: installed ($(command -v cx-stream))" || echo "cx-stream: MISSING (enable with /cli-dispatch:ds-setup)"
CFG="${CLAUDE_DS_CONFIG:-$HOME/.config/claude-ds/config}"
if command -v codex >/dev/null 2>&1; then
  echo "codex CLI: found ($(codex --version 2>/dev/null || echo 'version unknown'))"
  if [ -f "$CFG" ]; then
    ( . "$CFG"
      if [ -n "${CODEX_API_KEY:-}" ]; then echo "auth: CODEX_API_KEY set"
      elif [ -n "${OPENAI_API_KEY:-}" ]; then echo "auth: OPENAI_API_KEY set (CODEX_API_KEY takes precedence if both are set)"
      else echo "auth: via codex login (ChatGPT/OAuth) — run 'codex login' once if not signed in"; fi
      [ -n "${CX_MODEL:-}" ] && echo "model: CX_MODEL=${CX_MODEL}" || echo "model: CX_MODEL not set (codex default used)"
    )
  else
    echo "config: not found ($CFG) — auth via CODEX_API_KEY or 'codex login'"
  fi
else
  echo "codex CLI: MISSING (npm i -g @openai/codex  or  brew install --cask codex)"
fi
command -v node >/dev/null 2>&1 && echo "node: found" || echo "node: MISSING (cx-stream parser needs it)"
```

If everything is in place, suggest an optional smoke test (background task):
`cx-agent --read-only -q "Reply with exactly: OK"`.
