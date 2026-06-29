---
description: Full health check — CLIs on PATH, API keys, auth (✓ / ✗ per item)
allowed-tools: Bash
---

# cli-dispatch doctor

Run a full health check. `✓` = OK, `✗` = action needed.

```bash
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; }
chk() { command -v "$1" >/dev/null 2>&1 && ok "$1 on PATH ($(command -v "$1"))" || bad "$1 not found — run /cli-dispatch:setup"; }

CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"
[ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || { [ -f "$HOME/.config/claude-ds/config" ] && CFG="$HOME/.config/claude-ds/config"; }; }

echo "── Prerequisites ───────────────────────────────────────"
chk claude
chk node

echo "── DeepSeek ────────────────────────────────────────────"
chk claude-ds
chk claude-ds-stream
chk ds-agent
if [ -f "$CFG" ]; then
  ( . "$CFG"; [ -n "${DEEPSEEK_API_KEY:-}" ] && ok "DEEPSEEK_API_KEY set" || bad "DEEPSEEK_API_KEY missing — add to $CFG" )
else
  bad "config not found ($CFG) — run /cli-dispatch:setup"
fi

echo "── Antigravity / Gemini ─── optional ──────────────────"
if command -v ag-agent >/dev/null 2>&1; then
  ok "ag-agent on PATH"
  chk ag-stream
  chk agy
  command -v script >/dev/null 2>&1 && ok "script (pseudo-tty) found" || bad "script missing (ag backend needs it)"
  [ -f "$CFG" ] && ( . "$CFG"; [ -n "${GEMINI_API_KEY:-}" ] && ok "GEMINI_API_KEY set" || ok "no GEMINI_API_KEY — using Google sign-in (run 'agy' once if not signed in)" )
else
  echo "  – ag-agent not installed (optional — /cli-dispatch:setup to add)"
fi

echo "── Codex / OpenAI ─────────── optional ─────────────────"
if command -v cx-agent >/dev/null 2>&1; then
  ok "cx-agent on PATH"
  chk cx-stream
  if command -v codex >/dev/null 2>&1; then
    ok "codex CLI found"
    [ -f "$CFG" ] && ( . "$CFG"
      if [ -n "${CODEX_API_KEY:-}" ]; then ok "CODEX_API_KEY set"
      elif [ -n "${OPENAI_API_KEY:-}" ]; then ok "OPENAI_API_KEY set"
      else ok "no API key in config — OAuth via 'codex login' (run once if not signed in)"
      fi
    )
  else
    bad "codex CLI missing — npm i -g @openai/codex  or  brew install --cask codex"
  fi
else
  echo "  – cx-agent not installed (optional — /cli-dispatch:setup to add)"
fi

echo "── PATH ────────────────────────────────────────────────"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ok "$HOME/.local/bin on PATH" ;;
  *) bad "$HOME/.local/bin not on PATH — add to ~/.zshrc / ~/.bashrc: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

echo "── Smoke test (run manually if all green) ──────────────"
echo "  ds-agent --read-only -q \"Reply with exactly: OK\""
```
