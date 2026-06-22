#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/claude-ds"
CONFIG="$CONFIG_DIR/config"

LIBEXEC_DIR="$HOME/.local/share/claude-ds"

mkdir -p "$BIN_DIR"
install -m 0755 "$SCRIPT_DIR/claude-ds" "$BIN_DIR/claude-ds"
echo "Installed wrapper -> $BIN_DIR/claude-ds"

# Stream/session-tracking variant + its Node parser.
install -m 0755 "$SCRIPT_DIR/claude-ds-stream" "$BIN_DIR/claude-ds-stream"
mkdir -p "$LIBEXEC_DIR"
install -m 0644 "$SCRIPT_DIR/ds-stream-parse.mjs" "$LIBEXEC_DIR/ds-stream-parse.mjs"
echo "Installed stream wrapper -> $BIN_DIR/claude-ds-stream (parser -> $LIBEXEC_DIR/ds-stream-parse.mjs)"

# Single-command, subagent-style synchronous wrapper.
install -m 0755 "$SCRIPT_DIR/ds-agent" "$BIN_DIR/ds-agent"
echo "Installed agent wrapper -> $BIN_DIR/ds-agent"

if [ ! -f "$CONFIG" ]; then
  mkdir -p "$CONFIG_DIR"
  umask 077
  cat > "$CONFIG" <<'CFG'
# claude-ds config — DO NOT COMMIT. Add your DeepSeek API key below.
DEEPSEEK_API_KEY=""
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
CFG
  chmod 600 "$CONFIG"
  echo "Created config template -> $CONFIG (add your DeepSeek API key)"
else
  echo "Config already exists -> $CONFIG (left untouched)"
fi

# Open the config so the user can paste their key — only while the key is still
# empty. Best-effort and non-blocking: never fail the install if no opener exists.
# Override the opener via CLAUDE_DS_EDITOR (e.g. CLAUDE_DS_EDITOR="code").
if grep -q '^DEEPSEEK_API_KEY=""' "$CONFIG" 2>/dev/null; then
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

if command -v claude >/dev/null 2>&1; then
  echo "claude CLI: found"
else
  echo "WARNING: claude CLI not found in PATH."
fi
echo "Done. Add your key to $CONFIG, then test: claude-ds -p 'Reply with exactly: OK'"
