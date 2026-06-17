#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/claude-ds"
CONFIG="$CONFIG_DIR/config"

mkdir -p "$BIN_DIR"
install -m 0755 "$SCRIPT_DIR/claude-ds" "$BIN_DIR/claude-ds"
echo "Installed wrapper -> $BIN_DIR/claude-ds"

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
