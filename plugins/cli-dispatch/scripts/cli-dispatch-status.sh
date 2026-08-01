#!/usr/bin/env bash
# Installation status for every cli-dispatch backend.
#
# Runs straight from the plugin cache via commands/status.md's `!` pre-execution
# block — it is NOT installed into ~/.local/bin, so it never goes stale relative
# to the plugin (same arrangement as cli-dispatch-statusline.sh).
#
# Read-only. Never prints a key VALUE, only whether one is set.
#
# Usage: cli-dispatch-status.sh [--backend deepseek|antigravity|codex|opencode|copilot] [pluginRoot]
#
# $1 = plugin root in the original signature. Claude Code interpolates
# ${CLAUDE_PLUGIN_ROOT} into the `!` command string but does NOT export it into
# the subprocess, so reading the env var alone left the staleness check
# permanently dead (4.9.0 regression). New per-backend commands pass
# --backend as a flag so the positional plugin-root argument remains compatible.

usage() {
  echo "Usage: cli-dispatch-status.sh [--backend deepseek|antigravity|codex|opencode|copilot] [pluginRoot]" >&2
}

_PLUGIN_ROOT="${1:-${CLAUDE_PLUGIN_ROOT:-}}"
_PLUGIN_ROOT_SET=""
_BACKEND=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backend)
      if [ "$#" -lt 2 ] || [ -z "${2:-}" ]; then
        usage
        exit 2
      fi
      _BACKEND="$2"
      shift 2
      ;;
    --*)
      usage
      exit 2
      ;;
    *)
      if [ -n "$_PLUGIN_ROOT_SET" ]; then
        usage
        exit 2
      fi
      _PLUGIN_ROOT="$1"
      _PLUGIN_ROOT_SET=1
      shift
      ;;
  esac
done

if [ -n "$_BACKEND" ] && [ -z "$_PLUGIN_ROOT_SET" ]; then
  _PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
fi

case "$_BACKEND" in
  ""|deepseek|antigravity|codex|opencode|copilot) ;;
  *)
    usage
    exit 2
    ;;
esac

deepseek_status() {
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
}

antigravity_status() {
echo "== Antigravity backend (agy / Gemini) =="
command -v ag-agent  >/dev/null 2>&1 && echo "ag-agent:  installed ($(command -v ag-agent))"  || echo "ag-agent:  MISSING (enable with /cli-dispatch:setup)"
command -v ag-stream >/dev/null 2>&1 && echo "ag-stream: installed ($(command -v ag-stream))" || echo "ag-stream: MISSING (enable with /cli-dispatch:setup)"
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
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
}

codex_status() {
echo "== Codex backend (cx / OpenAI) =="
command -v cx-agent  >/dev/null 2>&1 && echo "cx-agent:  installed ($(command -v cx-agent))"  || echo "cx-agent:  MISSING (enable with /cli-dispatch:setup)"
command -v cx-stream >/dev/null 2>&1 && echo "cx-stream: installed ($(command -v cx-stream))" || echo "cx-stream: MISSING (enable with /cli-dispatch:setup)"
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
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
}

opencode_status() {
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
}

copilot_status() {
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
}

case "$_BACKEND" in
  deepseek) deepseek_status; exit 0 ;;
  antigravity) antigravity_status; exit 0 ;;
  codex) codex_status; exit 0 ;;
  opencode) opencode_status; exit 0 ;;
  copilot) copilot_status; exit 0 ;;
esac

echo "== DeepSeek backend (claude-ds) =="
# Version staleness check: warn if installed copies don't match the current plugin.
_PLUGIN_JSON=""
[ -n "$_PLUGIN_ROOT" ] && _PLUGIN_JSON="$_PLUGIN_ROOT/.claude-plugin/plugin.json"
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
