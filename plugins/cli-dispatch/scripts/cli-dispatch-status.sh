#!/usr/bin/env bash
# Installation status for every cli-dispatch backend.
#
# Runs straight from the plugin cache via commands/status.md's `!` pre-execution
# block — it is NOT installed into ~/.local/bin, so it never goes stale relative
# to the plugin (same arrangement as cli-dispatch-statusline.sh).
#
# Read-only. Never prints a key VALUE, only whether one is set.

echo "== DeepSeek backend (claude-ds) =="
# Version staleness check: warn if installed copies don't match the current plugin.
_PLUGIN_JSON=""
[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && _PLUGIN_JSON="$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json"
_INSTALLED_VER_FILE="$HOME/.config/cli-dispatch/.installed-version"
if [ -f "$_INSTALLED_VER_FILE" ] && [ -f "$_PLUGIN_JSON" ]; then
  _INSTALLED_VER="$(cat "$_INSTALLED_VER_FILE" 2>/dev/null)"
  _CURRENT_VER="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$_PLUGIN_JSON" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"[^"]*$/\1/')"
  if [ -n "$_INSTALLED_VER" ] && [ -n "$_CURRENT_VER" ] && [ "$_INSTALLED_VER" != "$_CURRENT_VER" ]; then
    echo "WARNING: installed copies are stale (installed: $_INSTALLED_VER, current: $_CURRENT_VER) — re-run /cli-dispatch:setup"
  fi
fi
command -v claude-ds >/dev/null 2>&1 && echo "wrapper: installed ($(command -v claude-ds))" || echo "wrapper: MISSING (run /cli-dispatch:setup)"
command -v claude-ds-stream >/dev/null 2>&1 && echo "stream wrapper: installed ($(command -v claude-ds-stream))" || echo "stream wrapper: MISSING (run /cli-dispatch:setup)"
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
if [ -f "$CFG" ]; then
  ( . "$CFG"; [ -n "${DEEPSEEK_API_KEY:-}" ] && echo "key: set" || echo "key: MISSING (add it to the config)" )
else
  echo "config: MISSING ($CFG)"
fi
command -v claude >/dev/null 2>&1 && echo "claude CLI: found" || echo "claude CLI: MISSING"

echo "== Antigravity backend (agy / Gemini) — optional =="
command -v ag-agent >/dev/null 2>&1 && echo "wrapper: installed ($(command -v ag-agent))" || echo "wrapper: not installed (enable with /cli-dispatch:setup)"
if command -v agy >/dev/null 2>&1; then
  echo "agy CLI: found ($(agy --version 2>/dev/null))"
  if [ -f "$CFG" ]; then ( . "$CFG"; [ -n "${GEMINI_API_KEY:-}" ] && echo "auth: GEMINI_API_KEY set" || echo "auth: via Google sign-in (run 'agy' once if not signed in)" ); fi
else
  echo "agy CLI: MISSING (curl -fsSL https://antigravity.google/cli/install.sh | bash)"
fi
command -v script >/dev/null 2>&1 && echo "script (pseudo-tty): found" || echo "script (pseudo-tty): MISSING (ag backend needs it)"

echo "== Codex backend (cx / OpenAI) — optional =="
command -v cx-agent >/dev/null 2>&1 && echo "wrapper: installed ($(command -v cx-agent))" || echo "wrapper: not installed (enable with /cli-dispatch:setup)"
if command -v codex >/dev/null 2>&1; then
  echo "codex CLI: found ($(codex --version 2>/dev/null || echo 'version unknown'))"
  if [ -f "$CFG" ]; then
    ( . "$CFG"
      if [ -n "${CODEX_API_KEY:-}" ]; then
        echo "auth: CODEX_API_KEY set"
      elif [ -n "${OPENAI_API_KEY:-}" ]; then
        echo "auth: OPENAI_API_KEY set (CODEX_API_KEY takes precedence if both are set)"
      else
        echo "auth: via codex login (ChatGPT/OAuth) — run 'codex login' once if not signed in"
      fi
      [ -n "${CX_MODEL:-}" ] && echo "model: CX_MODEL=${CX_MODEL}" || echo "model: CX_MODEL not set (codex default used)"
    )
  else
    echo "auth: config not found — check CODEX_API_KEY or run 'codex login'"
  fi
else
  echo "codex CLI: MISSING (npm i -g @openai/codex  or  brew install --cask codex)"
fi

echo "== OpenCode backend (oc / OpenRouter) — optional =="
command -v oc-agent >/dev/null 2>&1 && echo "wrapper: installed ($(command -v oc-agent))" || echo "wrapper: not installed (enable with /cli-dispatch:setup)"
if command -v opencode >/dev/null 2>&1; then
  echo "opencode CLI: found ($(opencode --version 2>/dev/null || echo 'version unknown'))"
  if [ -f "$CFG" ]; then
    ( . "$CFG"
      if [ -n "${OPENROUTER_API_KEY:-}" ]; then
        echo "auth: OPENROUTER_API_KEY set"
      else
        echo "auth: MISSING — no OAuth fallback, add OPENROUTER_API_KEY to the config"
      fi
      [ -n "${OC_MODEL:-}" ] && echo "model: OC_MODEL=${OC_MODEL}" || echo "model: OC_MODEL not set (no default — pass --model explicitly or set one in the config)"
    )
  else
    echo "auth: config not found — add OPENROUTER_API_KEY to the config (no OAuth fallback)"
  fi
else
  echo "opencode CLI: MISSING (npm i -g opencode-ai)"
fi

echo "== GitHub Copilot backend (cp) — optional =="
command -v cp-agent >/dev/null 2>&1 && echo "wrapper: installed ($(command -v cp-agent))" || echo "wrapper: not installed (enable with /cli-dispatch:setup)"
if command -v copilot >/dev/null 2>&1; then
  echo "copilot CLI: found ($(copilot --version 2>/dev/null || echo 'version unknown'))"
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
      fi
      [ -n "${CP_MODEL:-}" ] && echo "model: CP_MODEL=${CP_MODEL}" || echo "model: CP_MODEL not set (copilot default used)"
      echo "subscription: active GitHub Copilot subscription required"
    )
  else
    echo "auth: config not found — gh auth token may still be forwarded"
  fi
else
  echo "copilot CLI: MISSING (npm i -g @github/copilot  or  brew install --cask copilot-cli)"
fi

command -v node >/dev/null 2>&1 && echo "node: found (required by all stream parsers)" || echo "node: MISSING (the stream wrappers need it)"
