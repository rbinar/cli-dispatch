#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/cli-dispatch"
CONFIG="$CONFIG_DIR/config"
LIBEXEC_DIR="$HOME/.local/share/cli-dispatch"

# ---- one-time migration from the legacy claude-ds paths --------------------
# Earlier versions kept shared infra under ~/.config/claude-ds and ~/.cache/claude-ds.
# Move them to the cli-dispatch names so a single hub owns them. Wrappers still FALL BACK
# to the legacy paths at runtime, so this migration is convenience, not correctness.
OLD_CONFIG="$HOME/.config/claude-ds/config"
if [ -f "$OLD_CONFIG" ] && [ ! -f "$CONFIG" ]; then
  mkdir -p "$CONFIG_DIR"; mv "$OLD_CONFIG" "$CONFIG"
  echo "Migrated config: $OLD_CONFIG -> $CONFIG"
fi
_OLD_SESS="${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions"
_NEW_SESS="${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions"
if [ -d "$_OLD_SESS" ] && [ ! -d "$_NEW_SESS" ]; then
  mkdir -p "$(dirname "$_NEW_SESS")"; mv "$_OLD_SESS" "$_NEW_SESS"
  echo "Migrated sessions: $_OLD_SESS -> $_NEW_SESS"
fi
_OLD_LIBEXEC="$HOME/.local/share/claude-ds"
if [ -d "$_OLD_LIBEXEC" ] && [ "$_OLD_LIBEXEC" != "$LIBEXEC_DIR" ]; then
  rm -f "$_OLD_LIBEXEC"/ds-stream-parse.mjs "$_OLD_LIBEXEC"/ag-transcript-parse.mjs "$_OLD_LIBEXEC"/cx-stream-parse.mjs 2>/dev/null || true
  rmdir "$_OLD_LIBEXEC" 2>/dev/null || true
fi

# ---- which worker backends to install --------------------------------------
# Usage: install.sh [--backends deepseek,antigravity | all]
# Default: deepseek (preserves prior behavior). Antigravity (agy / Gemini) is opt-in.
BACKENDS="deepseek"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backends) BACKENDS="${2:-}"; shift 2;;
    --backends=*) BACKENDS="${1#*=}"; shift;;
    *) echo "install.sh: unknown arg '$1'" >&2; exit 1;;
  esac
done
[ "$BACKENDS" = "all" ] && BACKENDS="deepseek,antigravity,codex"
case ",$BACKENDS," in *,deepseek,*) WANT_DS=1;; *) WANT_DS=0;; esac
case ",$BACKENDS," in *,antigravity,*) WANT_AG=1;; *) WANT_AG=0;; esac
case ",$BACKENDS," in *,codex,*) WANT_CX=1;; *) WANT_CX=0;; esac
[ "$WANT_DS" -eq 1 ] || [ "$WANT_AG" -eq 1 ] || [ "$WANT_CX" -eq 1 ] || { echo "install.sh: no known backend in '--backends $BACKENDS' (deepseek,antigravity,codex)" >&2; exit 1; }

mkdir -p "$BIN_DIR" "$LIBEXEC_DIR"
echo "Backends: $BACKENDS"

# ---- Dashboard (backend-agnostic; always installed) ------------------------
install -m 0755 "$SCRIPT_DIR/cli-dispatch-dashboard" "$BIN_DIR/cli-dispatch-dashboard"
install -m 0644 "$SCRIPT_DIR/dashboard-server.mjs"   "$LIBEXEC_DIR/dashboard-server.mjs"
echo "Installed dashboard -> cli-dispatch-dashboard (server -> $LIBEXEC_DIR/dashboard-server.mjs); open it with /cli-dispatch:dashboard"

# ---- Cleanup tool (backend-agnostic; always installed) ---------------------
install -m 0755 "$SCRIPT_DIR/cli-dispatch-clean"     "$BIN_DIR/cli-dispatch-clean"
install -m 0644 "$SCRIPT_DIR/cli-dispatch-clean.mjs" "$LIBEXEC_DIR/cli-dispatch-clean.mjs"
echo "Installed cleaner -> cli-dispatch-clean (engine -> $LIBEXEC_DIR/cli-dispatch-clean.mjs); use /cli-dispatch:clean or schedule it with /cli-dispatch:clean-schedule"

# ---- DeepSeek backend (claude-ds family) -----------------------------------
if [ "$WANT_DS" -eq 1 ]; then
  install -m 0755 "$SCRIPT_DIR/claude-ds"        "$BIN_DIR/claude-ds"
  install -m 0755 "$SCRIPT_DIR/claude-ds-stream" "$BIN_DIR/claude-ds-stream"
  install -m 0755 "$SCRIPT_DIR/ds-agent"         "$BIN_DIR/ds-agent"
  install -m 0644 "$SCRIPT_DIR/ds-stream-parse.mjs" "$LIBEXEC_DIR/ds-stream-parse.mjs"
  echo "Installed DeepSeek backend -> claude-ds, claude-ds-stream, ds-agent (parser -> $LIBEXEC_DIR/ds-stream-parse.mjs)"
  if command -v claude >/dev/null 2>&1; then echo "  claude CLI: found"; else echo "  WARNING: 'claude' CLI not found in PATH (the DeepSeek worker wraps it)."; fi
fi

# ---- Antigravity backend (ag-* family, Gemini via agy) ---------------------
if [ "$WANT_AG" -eq 1 ]; then
  install -m 0755 "$SCRIPT_DIR/ag-stream" "$BIN_DIR/ag-stream"
  install -m 0755 "$SCRIPT_DIR/ag-agent"  "$BIN_DIR/ag-agent"
  install -m 0644 "$SCRIPT_DIR/ag-transcript-parse.mjs" "$LIBEXEC_DIR/ag-transcript-parse.mjs"
  echo "Installed Antigravity backend -> ag-stream, ag-agent (parser -> $LIBEXEC_DIR/ag-transcript-parse.mjs)"
  if command -v agy >/dev/null 2>&1; then
    echo "  agy CLI: found ($(agy --version 2>/dev/null || echo '?'))"
  else
    echo "  WARNING: 'agy' (Antigravity CLI) not found in PATH. Install it, then sign in:"
    echo "    curl -fsSL https://antigravity.google/cli/install.sh | bash"
    echo "    agy        # run once to sign in (Google), or set GEMINI_API_KEY in the config"
  fi
fi

# ---- Codex backend (cx-* family, OpenAI Codex CLI) --------------------------
if [ "$WANT_CX" -eq 1 ]; then
  install -m 0755 "$SCRIPT_DIR/cx-stream" "$BIN_DIR/cx-stream"
  install -m 0755 "$SCRIPT_DIR/cx-agent"  "$BIN_DIR/cx-agent"
  install -m 0644 "$SCRIPT_DIR/cx-stream-parse.mjs" "$LIBEXEC_DIR/cx-stream-parse.mjs"
  echo "Installed Codex backend -> cx-stream, cx-agent (parser -> $LIBEXEC_DIR/cx-stream-parse.mjs)"
  if command -v codex >/dev/null 2>&1; then
    echo "  codex CLI: found ($(codex --version 2>/dev/null || echo '?'))"
  else
    echo "  WARNING: 'codex' (OpenAI Codex CLI) not found in PATH. Install it, then sign in:"
    echo "    npm i -g @openai/codex"
    echo "    brew install --cask codex"
    echo "    curl -fsSL https://chatgpt.com/codex/install.sh | sh"
    echo "    codex login   # sign in (ChatGPT/OAuth), or set CODEX_API_KEY in the config"
  fi
fi

# ---- config skeleton (shared; created only if missing — never clobbered) ---
if [ ! -f "$CONFIG" ]; then
  mkdir -p "$CONFIG_DIR"
  umask 077
  cat > "$CONFIG" <<'CFG'
# cli-dispatch config — DO NOT COMMIT.

# --- DeepSeek backend (claude-ds) --- add your DeepSeek API key below.
DEEPSEEK_API_KEY=""
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"

# --- Antigravity backend (agy / Gemini) --- OPTIONAL.
# Auth is normally via Google sign-in (run `agy` once interactively); no key needed.
# For headless/CI, set a key here instead.
GEMINI_API_KEY=""
# Default model for the agy worker. Blank = agy's own default (Gemini 3.5 Flash (High)).
# The value is the EXACT display name from `agy models` (incl. the reasoning suffix). agy
# proxies multiple families — examples:
#   "Gemini 3.1 Pro (High)"  "Gemini 3.5 Flash (High)"
#   "Claude Opus 4.6 (Thinking)"  "Claude Sonnet 4.6 (Thinking)"  "GPT-OSS 120B (Medium)"
# Override per-call with `ag-agent --model "<name>"`. Run `agy models` for the live list.
AG_MODEL=""

# --- Codex backend (cx-agent / cx-stream, OpenAI Codex CLI) --- OPTIONAL.
# Auth: run `codex login` once (ChatGPT/OAuth — no key needed for personal use).
# For headless/CI, CODEX_API_KEY takes precedence over OPENAI_API_KEY.
CODEX_API_KEY=""
# Default model for the codex worker. Blank = codex's own default (varies by version).
# Override per-call with `cx-agent --model <name>`. Env var read by cx-stream: CX_MODEL
# (with CODEX_MODEL as fallback). Current models: gpt-5.5 (default), gpt-5.4,
# gpt-5.4-mini (fast/cheap, subagents), gpt-5.3-codex-spark. Example: CX_MODEL="gpt-5.4-mini"
CX_MODEL=""
# Sandbox: default workspace-write (files can be written in --cwd).
# Pass cx-agent --read-only for a REAL OS-level no-writes guarantee (macOS Seatbelt /
# Linux bwrap+seccomp) — kernel-enforced, unlike other backends.
# Or pass --sandbox <mode> for other codex sandbox modes.
CFG
  chmod 600 "$CONFIG"
  echo "Created config template -> $CONFIG"
else
  echo "Config already exists -> $CONFIG (left untouched)"
fi

# Auto-open the config so the user can paste a key — only when the DeepSeek backend is
# selected AND its key is still empty (Antigravity normally needs no key → no prompt).
# Override the opener via CLI_DISPATCH_EDITOR (legacy CLAUDE_DS_EDITOR still honored), e.g. ="code".
_EDITOR="${CLI_DISPATCH_EDITOR:-${CLAUDE_DS_EDITOR:-}}"
if [ "$WANT_DS" -eq 1 ] && grep -q '^DEEPSEEK_API_KEY=""' "$CONFIG" 2>/dev/null; then
  if [ -n "$_EDITOR" ]; then
    "$_EDITOR" "$CONFIG" >/dev/null 2>&1 && echo "Opened config in \$CLI_DISPATCH_EDITOR -> add your key, then save." || true
  elif command -v open >/dev/null 2>&1; then            # macOS
    open -e "$CONFIG" >/dev/null 2>&1 && echo "Opened config in editor -> add your key, then save." || true
  elif command -v xdg-open >/dev/null 2>&1; then         # Linux
    xdg-open "$CONFIG" >/dev/null 2>&1 && echo "Opened config in editor -> add your key, then save." || true
  elif grep -qi microsoft /proc/version 2>/dev/null && command -v explorer.exe >/dev/null 2>&1; then  # WSL
    explorer.exe "$(wslpath -w "$CONFIG" 2>/dev/null)" >/dev/null 2>&1 && echo "Opened config in editor -> add your key, then save." || true
  fi
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *) echo "WARNING: $BIN_DIR is not in PATH. Add it to your shell profile." ;;
esac

echo "Done."
[ "$WANT_DS" -eq 1 ] && echo "  DeepSeek:    add your key to $CONFIG, then test: claude-ds -p 'Reply with exactly: OK'"
[ "$WANT_AG" -eq 1 ] && echo "  Antigravity: sign in with 'agy' (or set GEMINI_API_KEY), then test: ag-agent -q 'Reply with exactly: OK'"
[ "$WANT_CX" -eq 1 ] && echo "  Codex:       run 'codex login' (or set CODEX_API_KEY), then test: cx-agent --read-only -q 'Reply with exactly: OK'"
