#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/claude-ds"
CONFIG="$CONFIG_DIR/config"
LIBEXEC_DIR="$HOME/.local/share/claude-ds"

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
[ "$BACKENDS" = "all" ] && BACKENDS="deepseek,antigravity"
case ",$BACKENDS," in *,deepseek,*) WANT_DS=1;; *) WANT_DS=0;; esac
case ",$BACKENDS," in *,antigravity,*) WANT_AG=1;; *) WANT_AG=0;; esac
[ "$WANT_DS" -eq 1 ] || [ "$WANT_AG" -eq 1 ] || { echo "install.sh: no known backend in '--backends $BACKENDS' (deepseek,antigravity)" >&2; exit 1; }

mkdir -p "$BIN_DIR" "$LIBEXEC_DIR"
echo "Backends: $BACKENDS"

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
# For headless/CI, set a key here instead. AG_MODEL blank = agy's default model.
GEMINI_API_KEY=""
AG_MODEL=""
CFG
  chmod 600 "$CONFIG"
  echo "Created config template -> $CONFIG"
else
  echo "Config already exists -> $CONFIG (left untouched)"
fi

# Auto-open the config so the user can paste a key — only when the DeepSeek backend is
# selected AND its key is still empty (Antigravity normally needs no key → no prompt).
# Override the opener via CLAUDE_DS_EDITOR (e.g. CLAUDE_DS_EDITOR="code").
if [ "$WANT_DS" -eq 1 ] && grep -q '^DEEPSEEK_API_KEY=""' "$CONFIG" 2>/dev/null; then
  if [ -n "${CLAUDE_DS_EDITOR:-}" ]; then
    "$CLAUDE_DS_EDITOR" "$CONFIG" >/dev/null 2>&1 && echo "Opened config in \$CLAUDE_DS_EDITOR -> add your key, then save." || true
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
