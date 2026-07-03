---
description: Check the GitHub Copilot backend install status
allowed-tools: Bash
---

# GitHub Copilot backend status

GitHub Copilot-only health check (read-only; do NOT print the key VALUE). For all backends at once
use `/cli-dispatch:status`.

```bash
echo "== GitHub Copilot backend (cp) =="
command -v cp-agent  >/dev/null 2>&1 && echo "cp-agent:  installed ($(command -v cp-agent))"  || echo "cp-agent:  MISSING (enable with /cli-dispatch:setup)"
command -v cp-stream >/dev/null 2>&1 && echo "cp-stream: installed ($(command -v cp-stream))" || echo "cp-stream: MISSING (enable with /cli-dispatch:setup)"
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
if command -v copilot >/dev/null 2>&1; then
  echo "copilot CLI: found ($(copilot --version 2>/dev/null || echo 'version unknown'))"
else
  echo "copilot CLI: MISSING (npm i -g @github/copilot  or  brew install --cask copilot-cli)"
fi
if [ -f "$CFG" ]; then
  ( . "$CFG"
    if [ -n "${COPILOT_GITHUB_TOKEN:-}" ]; then
      echo "auth: COPILOT_GITHUB_TOKEN set"
    elif [ -n "${GH_TOKEN:-}" ]; then
      echo "auth: GH_TOKEN set"
    elif [ -n "${GITHUB_TOKEN:-}" ]; then
      echo "auth: GITHUB_TOKEN set"
    else
      echo "auth: via gh auth token if available, or set COPILOT_GITHUB_TOKEN/GH_TOKEN/GITHUB_TOKEN"
      echo "      active GitHub Copilot subscription required"
    fi
    [ -n "${CP_MODEL:-}" ] && echo "model: CP_MODEL=${CP_MODEL}" || echo "model: CP_MODEL not set (copilot default used)"
  )
else
  echo "config: MISSING ($CFG) — gh auth token may still be forwarded; run /cli-dispatch:setup"
fi
command -v node >/dev/null 2>&1 && echo "node: found" || echo "node: MISSING (cp-stream parser needs it)"
```

If everything is in place, suggest an optional smoke test (background task):
`cp-agent -q "Reply with exactly: OK"`.
