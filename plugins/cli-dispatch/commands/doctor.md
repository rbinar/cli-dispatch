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

echo "── OpenCode / OpenRouter ──── optional ─────────────────"
if command -v oc-agent >/dev/null 2>&1; then
  ok "oc-agent on PATH"
  chk oc-stream
  if command -v opencode >/dev/null 2>&1; then
    ok "opencode CLI found"
  else
    bad "opencode CLI missing — npm i -g opencode-ai"
  fi
  [ -f "$CFG" ] && ( . "$CFG"; [ -n "${OPENROUTER_API_KEY:-}" ] && ok "OPENROUTER_API_KEY set" || bad "OPENROUTER_API_KEY missing — add to $CFG (no OAuth fallback for OpenCode)" )
else
  echo "  – oc-agent not installed (optional — /cli-dispatch:setup to add)"
fi

echo "── GitHub Copilot ─────────── optional ─────────────────"
if command -v cp-agent >/dev/null 2>&1; then
  ok "cp-agent on PATH"
  chk cp-stream
  if command -v copilot >/dev/null 2>&1; then
    ok "copilot CLI found"
  else
    bad "copilot CLI missing — npm i -g @github/copilot  or  brew install --cask copilot-cli"
  fi
  [ -f "$CFG" ] && ( . "$CFG"
    if [ -n "${COPILOT_GITHUB_TOKEN:-}" ]; then ok "COPILOT_GITHUB_TOKEN set"
    elif [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then ok "GH_TOKEN/GITHUB_TOKEN set"
    else ok "no token in config — will try gh auth token forwarding; active Copilot subscription required"
    fi
  )
else
  echo "  – cp-agent not installed (optional — /cli-dispatch:setup to add)"
fi

echo "── GitHub CLI (gh) ────────── optional ─────────────────"
if command -v gh >/dev/null 2>&1; then
  if [ -n "${CLI_DISPATCH_NO_GH_TOKEN:-}" ]; then
    ok "CLI_DISPATCH_NO_GH_TOKEN set — gh token forwarding to workers disabled (opt-out)"
  elif [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
    ok "GH_TOKEN/GITHUB_TOKEN set — inherited by workers"
  elif gh auth token >/dev/null 2>&1 && [ -n "$(gh auth token 2>/dev/null)" ]; then
    ok "gh authenticated — token auto-forwarded to workers as GH_TOKEN (issue #56)"
  else
    bad "gh not authenticated — delegated gh tasks (issue triage / PR automation) will fail; run 'gh auth login'"
  fi
else
  echo "  – gh not installed (optional — only needed for delegated GitHub tasks)"
fi

echo "── Policy injection ─────── optional ──────────────────"
POLICY="${XDG_CONFIG_HOME:-$HOME/.config}/cli-dispatch/policy.json"
if [ -f "$POLICY" ]; then
  _PENABLED=$(node -e 'try{const p=require(process.argv[1]);process.stdout.write(String(p.enabled===true))}catch{process.stdout.write("err")}' "$POLICY" 2>/dev/null)
  case "$_PENABLED" in
    true)  ok "policy.json present, injection ENABLED" ;;
    false) ok "policy.json present, injection disabled (enabled:false)" ;;
    *)     bad "policy.json present but unreadable/invalid JSON — re-run /cli-dispatch:setup" ;;
  esac
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/hooks/hooks.json" ]; then
    ok "hooks/hooks.json present in plugin package"
  elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    bad "hooks/hooks.json MISSING from plugin package — plugin cache may be stale; update the plugin"
  else
    echo "  – CLAUDE_PLUGIN_ROOT unset — cannot verify hooks.json"
  fi
  if [ "$_PENABLED" = "true" ]; then
    for f in "$HOME/.claude/CLAUDE.md" "./CLAUDE.md"; do
      [ -f "$f" ] && grep -qE 'cli-dispatch:(policy|orchestration-priority)' "$f" 2>/dev/null && bad "double-injection: hook is enabled AND $f has a cli-dispatch policy/orchestration marker — remove the CLAUDE.md block to avoid injecting the policy twice"
    done
  fi
else
  echo "  – policy injection not configured (optional — /cli-dispatch:setup to enable)"
fi

echo "── PATH ────────────────────────────────────────────────"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ok "$HOME/.local/bin on PATH" ;;
  *) bad "$HOME/.local/bin not on PATH — add to ~/.zshrc / ~/.bashrc: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

echo "── Smoke test (run manually if all green) ──────────────"
echo "  ds-agent --read-only -q \"Reply with exactly: OK\""
```
