#!/usr/bin/env bash
# Note: re-running setup (/cli-dispatch:setup) is required after every plugin version bump to keep ~/.local in sync.
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
  rm -f "$_OLD_LIBEXEC"/ds-stream-parse.mjs "$_OLD_LIBEXEC"/ag-transcript-parse.mjs "$_OLD_LIBEXEC"/cx-stream-parse.mjs "$_OLD_LIBEXEC"/cp-stream-parse.mjs 2>/dev/null || true
  rmdir "$_OLD_LIBEXEC" 2>/dev/null || true
fi

# ---- which worker backends to install --------------------------------------
# Usage: install.sh [--backends deepseek,antigravity,codex,opencode,copilot | all] [--install-missing]
# Default: deepseek (preserves prior behavior). Other backends are opt-in.
# --install-missing: best-effort auto-install any missing backend CLI (via npm/brew/
# curl, whichever applies) before falling back to the manual-install warning. Never
# automates auth/sign-in. Default OFF (unset behavior is unchanged).
BACKENDS="deepseek"
INSTALL_MISSING=0
POLICY_INJECTION="off"
NONINTERACTIVE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backends) BACKENDS="${2:-}"; shift 2;;
    --backends=*) BACKENDS="${1#*=}"; shift;;
    --install-missing) INSTALL_MISSING=1; shift;;
    --policy-injection) POLICY_INJECTION="${2:-}"; shift 2;;
    --policy-injection=*) POLICY_INJECTION="${1#*=}"; shift;;
    --non-interactive) NONINTERACTIVE=1; shift;;
    *) echo "install.sh: unknown arg '$1'" >&2; exit 1;;
  esac
done
[ "$BACKENDS" = "all" ] && BACKENDS="deepseek,antigravity,codex,opencode,copilot"
case ",$BACKENDS," in *,deepseek,*) WANT_DS=1;; *) WANT_DS=0;; esac
case ",$BACKENDS," in *,antigravity,*) WANT_AG=1;; *) WANT_AG=0;; esac
case ",$BACKENDS," in *,codex,*) WANT_CX=1;; *) WANT_CX=0;; esac
case ",$BACKENDS," in *,opencode,*) WANT_OC=1;; *) WANT_OC=0;; esac
case ",$BACKENDS," in *,copilot,*) WANT_CP=1;; *) WANT_CP=0;; esac
[ "$WANT_DS" -eq 1 ] || [ "$WANT_AG" -eq 1 ] || [ "$WANT_CX" -eq 1 ] || [ "$WANT_OC" -eq 1 ] || [ "$WANT_CP" -eq 1 ] || { echo "install.sh: no known backend in '--backends $BACKENDS' (deepseek,antigravity,codex,opencode,copilot)" >&2; exit 1; }

# >>> ensure_config_block >>>
# Idempotently append one backend's config block to $cfg. Self-contained (no reliance on
# outer variables) so it can be extracted and unit-tested via the marker fences below.
# args: $1=config_path $2=backend_id.
# returns: 0 = block appended, 1 = unchanged (marker line already present), 2 = unknown backend.
ensure_config_block() {
  local cfg="$1" backend="$2" marker block
  case "$backend" in
    deepseek)
      marker='DEEPSEEK_API_KEY='
      block=$(cat <<'BLOCK'

# --- DeepSeek backend (claude-ds) --- add your DeepSeek API key below.
DEEPSEEK_API_KEY=""
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
BLOCK
)
      ;;
    antigravity)
      marker='GEMINI_API_KEY='
      block=$(cat <<'BLOCK'

# --- Antigravity backend (agy / Gemini) --- OPTIONAL.
# Auth is normally via Google sign-in (run `agy` once interactively); no key needed.
# For headless/CI, set a key here instead.
GEMINI_API_KEY=""
# Default model for the agy worker. Blank = agy's own default.
# agy accepts EITHER the slug `agy models` prints or the display name it shows in the UI —
# both name the same model, and both carry the reasoning effort. agy proxies multiple
# families — examples:
#   "gemini-3.6-flash-high"       or  "Gemini 3.6 Flash (High)"
#   "claude-opus-4-6-thinking"    or  "Claude Opus 4.6 (Thinking)"
#   "gpt-oss-120b-medium"         or  "GPT-OSS 120B (Medium)"
# Override per-call with `ag-agent --model "<name>"`. Run `agy models` for the live list
# (it prints slugs as of agy 1.1.8; older builds printed display names).
AG_MODEL=""
# Optional comma-separated candidate model list — when set, the delegating agent
# picks the best fit from this list (same reasoning as an orchestrator-provided inline
# list). Leave empty to use only the single AG_MODEL default above.
AG_MODELS=""
BLOCK
)
      ;;
    codex)
      marker='CODEX_API_KEY='
      block=$(cat <<'BLOCK'

# --- Codex backend (cx-agent / cx-stream, OpenAI Codex CLI) --- OPTIONAL.
# Auth: run `codex login` once (ChatGPT/OAuth — no key needed for personal use).
# For headless/CI, CODEX_API_KEY takes precedence over OPENAI_API_KEY.
CODEX_API_KEY=""
# Default model for the codex worker. Blank = codex's own default (varies by version).
# Override per-call with `cx-agent --model <name>`. Env var read by cx-stream: CX_MODEL
# (with CODEX_MODEL as fallback). gpt-5.6-sol/terra/luna now rank above gpt-5.5
# in the live catalog; gpt-5.5, gpt-5.4, gpt-5.4-mini (fast/cheap, subagents),
# and gpt-5.3-codex-spark remain available. gpt-5.2/gpt-5.3-codex have dropped.
# Example: CX_MODEL="gpt-5.6-luna"
CX_MODEL=""
# Optional comma-separated candidate model list — when set, the delegating agent
# picks the best fit from this list (same reasoning as an orchestrator-provided inline
# list). Leave empty to use only the single CX_MODEL default above.
CX_MODELS=""
# Sandbox: default workspace-write (files can be written in --cwd).
# Pass cx-agent --read-only for a REAL OS-level no-writes guarantee (macOS Seatbelt /
# Linux bwrap+seccomp) — kernel-enforced, unlike other backends.
# Or pass --sandbox <mode> for other codex sandbox modes.
BLOCK
)
      ;;
    opencode)
      marker='OPENROUTER_API_KEY='
      block=$(cat <<'BLOCK'

# --- OpenCode backend (oc-agent / oc-stream, via OpenRouter) --- OPTIONAL.
# Auth: OpenRouter API key (no OAuth flow) -- https://openrouter.ai/keys
OPENROUTER_API_KEY=""
# Default model slug (WITHOUT the "openrouter/" prefix -- oc-stream adds it).
# List live models with: OPENROUTER_API_KEY=<key> opencode models openrouter
# Free-tier example: google/gemma-4-31b-it:free
OC_MODEL=""
# Optional comma-separated candidate model list — when set, the delegating agent
# picks the best fit from this list (same reasoning as an orchestrator-provided inline
# list). Leave empty to use only the single OC_MODEL default above.
OC_MODELS=""
# No sandbox: --auto approves all permissions (required for headless use, not a
# safety opt-in). Use --cwd + a git worktree for a no-writes guarantee.
BLOCK
)
      ;;
    copilot)
      marker='COPILOT_GITHUB_TOKEN='
      block=$(cat <<'BLOCK'

# --- GitHub Copilot backend (cp-agent / cp-stream) --- OPTIONAL.
# Auth: cli-dispatch automatically reuses `gh auth token` via GH_TOKEN when available.
# COPILOT_GITHUB_TOKEN here overrides GH_TOKEN/GITHUB_TOKEN if set explicitly.
# An active GitHub Copilot subscription is required.
COPILOT_GITHUB_TOKEN=""
# Default model slug for the copilot worker. Blank = copilot's own default.
# Examples: claude-sonnet-4.6, gpt-5.4, auto. Override per-call with `cp-agent --model <slug>`.
CP_MODEL=""
# Optional comma-separated candidate model list — when set, the delegating agent
# picks the best fit from this list (same reasoning as an orchestrator-provided inline
# list). Leave empty to use only the single CP_MODEL default above.
CP_MODELS=""
# No sandbox: --allow-all-tools --no-ask-user enables headless use, not a safety opt-in.
# Use --cwd + a git worktree for a no-writes guarantee.
BLOCK
)
      ;;
    *) return 2;;
  esac
  if grep -q "^${marker}" "$cfg" 2>/dev/null; then
    return 1   # unchanged (line already present — never touch it)
  fi
  printf '%s\n' "$block" >> "$cfg"
  return 0     # appended
}
# <<< ensure_config_block <<<

# ---- best-effort auto-install for a missing backend CLI (only when
# --install-missing is passed) -----------------------------------------------
# Tries a package-manager-first install for the named CLI, then re-checks via a
# fresh `command -v` (NOT the installer's own exit code, which npm/curl can report
# unreliably re: PATH availability). Every install attempt is guarded (`|| true`)
# so a failed install never aborts the rest of the script under `set -euo pipefail`.
# Auth/sign-in is NEVER attempted here -- callers still print the existing WARNING
# block (with manual install + auth instructions) on failure.
try_install_missing_cli() {
  local name="$1"
  echo "  Attempting to auto-install '$name' (--install-missing)..."
  case "$name" in
    claude)
      if command -v npm >/dev/null 2>&1; then
        npm i -g @anthropic-ai/claude-code || true
      else
        curl -fsSL https://claude.ai/install.sh | bash || true
      fi
      ;;
    agy)
      curl -fsSL https://antigravity.google/cli/install.sh | bash || true
      ;;
    codex)
      if command -v npm >/dev/null 2>&1; then
        npm i -g @openai/codex || true
      elif [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        brew install --cask codex || true
      else
        curl -fsSL https://chatgpt.com/codex/install.sh | sh || true
      fi
      ;;
    opencode)
      if command -v npm >/dev/null 2>&1; then
        npm i -g opencode-ai || true
      else
        echo "  FAIL: 'opencode' has no non-npm install path; Node/npm is required."
      fi
      ;;
    copilot)
      if command -v npm >/dev/null 2>&1; then
        npm i -g @github/copilot || true
      elif [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        brew install --cask copilot-cli || true
      else
        curl -fsSL https://gh.io/copilot-install | bash || true
      fi
      ;;
  esac
  if command -v "$name" >/dev/null 2>&1; then
    echo "  SUCCESS: '$name' installed -> $(command -v "$name")"
    return 0
  else
    echo "  FAIL: automatic install of '$name' did not succeed."
    return 1
  fi
}

mkdir -p "$BIN_DIR" "$LIBEXEC_DIR"
echo "Backends: $BACKENDS"

# ---- Shared helpers (backend-agnostic; always installed) --------------------
# stream-utils.sh is sourced by every bash stream wrapper via "$SCRIPT_DIR/stream-utils.sh",
# parse-utils.mjs is imported by every parser via './parse-utils.mjs', and version-check.sh
# is sourced by every *-agent wrapper via "$(dirname "${BASH_SOURCE[0]}")/version-check.sh" —
# all three must live next to their consumers in the installed locations.
install -m 0644 "$SCRIPT_DIR/stream-utils.sh"    "$BIN_DIR/stream-utils.sh"
install -m 0644 "$SCRIPT_DIR/parse-utils.mjs"    "$LIBEXEC_DIR/parse-utils.mjs"
install -m 0644 "$SCRIPT_DIR/version-check.sh"   "$BIN_DIR/version-check.sh"
echo "Installed shared helpers -> $BIN_DIR/stream-utils.sh, $BIN_DIR/version-check.sh, $LIBEXEC_DIR/parse-utils.mjs"

# ---- Dashboard (backend-agnostic; always installed) ------------------------
install -m 0755 "$SCRIPT_DIR/cli-dispatch-dashboard" "$BIN_DIR/cli-dispatch-dashboard"
install -m 0644 "$SCRIPT_DIR/dashboard-server.mjs"   "$LIBEXEC_DIR/dashboard-server.mjs"
install -m 0644 "$SCRIPT_DIR/public-page.mjs"        "$LIBEXEC_DIR/public-page.mjs"
install -m 0644 "$SCRIPT_DIR/dashboard-utils.mjs"    "$LIBEXEC_DIR/dashboard-utils.mjs"
install -m 0644 "$SCRIPT_DIR/pty-host.mjs"           "$LIBEXEC_DIR/pty-host.mjs"
install -m 0644 "$SCRIPT_DIR/takeover-cmd.mjs"       "$LIBEXEC_DIR/takeover-cmd.mjs"
mkdir -p "$LIBEXEC_DIR/vendor"
install -m 0644 "$SCRIPT_DIR/vendor/LICENSE-xterm.txt"   "$LIBEXEC_DIR/vendor/LICENSE-xterm.txt"
install -m 0644 "$SCRIPT_DIR/vendor/xterm-addon-fit.js"  "$LIBEXEC_DIR/vendor/xterm-addon-fit.js"
install -m 0644 "$SCRIPT_DIR/vendor/xterm.css"           "$LIBEXEC_DIR/vendor/xterm.css"
install -m 0644 "$SCRIPT_DIR/vendor/xterm.js"            "$LIBEXEC_DIR/vendor/xterm.js"
echo "Installed dashboard -> cli-dispatch-dashboard (server + takeover pty-host/takeover-cmd/vendor xterm -> $LIBEXEC_DIR); open it with /cli-dispatch:dashboard"

# ---- Cleanup tool (backend-agnostic; always installed) ---------------------
install -m 0755 "$SCRIPT_DIR/cli-dispatch-clean"     "$BIN_DIR/cli-dispatch-clean"
install -m 0644 "$SCRIPT_DIR/cli-dispatch-clean.mjs" "$LIBEXEC_DIR/cli-dispatch-clean.mjs"
echo "Installed cleaner -> cli-dispatch-clean (engine -> $LIBEXEC_DIR/cli-dispatch-clean.mjs); use /cli-dispatch:clean or schedule it with /cli-dispatch:clean-schedule"

# ---- Blocking-wait tool (backend-agnostic; always installed) ---------------
install -m 0755 "$SCRIPT_DIR/cli-dispatch-wait" "$BIN_DIR/cli-dispatch-wait"
echo "Installed waiter -> cli-dispatch-wait (blocks until a session reaches a terminal state; zero-token polling, no LLM babysitter)"

# ---- Gain-report tool (backend-agnostic; always installed) -----------------
install -m 0755 "$SCRIPT_DIR/cli-dispatch-gain" "$BIN_DIR/cli-dispatch-gain"
install -m 0644 "$SCRIPT_DIR/gain-report.mjs" "$LIBEXEC_DIR/gain-report.mjs"
echo "Installed gain reporter -> cli-dispatch-gain (engine -> $LIBEXEC_DIR/gain-report.mjs); run /cli-dispatch:gain for worker + babysitting accounting"

echo "▶ cli-dispatch-run…"
install -m 0755 "$SCRIPT_DIR/cli-dispatch-run" "$BIN_DIR/cli-dispatch-run"
install -m 0644 "$SCRIPT_DIR/verdict-writer.mjs" "$LIBEXEC_DIR/verdict-writer.mjs"
# cli-dispatch-run resolves its per-backend worktree runners next to itself ($BIN_DIR) —
# they must ship with it or every non-installed backend fails with "backend runner not found".
for wr in ds-worktree-run.sh ag-worktree-run.sh cx-worktree-run.sh oc-worktree-run.sh cp-worktree-run.sh; do
  install -m 0755 "$SCRIPT_DIR/$wr" "$BIN_DIR/$wr"
done
echo "Installed deterministic runner -> cli-dispatch-run (+ per-backend worktree runners, verdict engine -> $LIBEXEC_DIR/verdict-writer.mjs)"

# ---- DeepSeek backend (claude-ds family) -----------------------------------
if [ "$WANT_DS" -eq 1 ]; then
  install -m 0755 "$SCRIPT_DIR/claude-ds"        "$BIN_DIR/claude-ds"
  install -m 0755 "$SCRIPT_DIR/claude-ds-stream" "$BIN_DIR/claude-ds-stream"
  install -m 0755 "$SCRIPT_DIR/ds-agent"         "$BIN_DIR/ds-agent"
  install -m 0644 "$SCRIPT_DIR/ds-stream-parse.mjs" "$LIBEXEC_DIR/ds-stream-parse.mjs"
  echo "Installed DeepSeek backend -> claude-ds, claude-ds-stream, ds-agent (parser -> $LIBEXEC_DIR/ds-stream-parse.mjs)"
  if command -v claude >/dev/null 2>&1; then
    echo "  claude CLI: found"
  else
    if [ "$INSTALL_MISSING" -eq 1 ]; then try_install_missing_cli claude || true; fi
    if command -v claude >/dev/null 2>&1; then
      echo "  claude CLI: found"
    else
      echo "  WARNING: 'claude' CLI not found in PATH (the DeepSeek worker wraps it)."
    fi
  fi
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
    if [ "$INSTALL_MISSING" -eq 1 ]; then try_install_missing_cli agy || true; fi
    if command -v agy >/dev/null 2>&1; then
      echo "  agy CLI: found ($(agy --version 2>/dev/null || echo '?'))"
    else
      echo "  WARNING: 'agy' (Antigravity CLI) not found in PATH. Install it, then sign in:"
      echo "    curl -fsSL https://antigravity.google/cli/install.sh | bash"
      echo "    agy        # run once to sign in (Google), or set GEMINI_API_KEY in the config"
    fi
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
    if [ "$INSTALL_MISSING" -eq 1 ]; then try_install_missing_cli codex || true; fi
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
fi

# ---- OpenCode backend (oc-* family, via OpenRouter) --------------------------
if [ "$WANT_OC" -eq 1 ]; then
  install -m 0755 "$SCRIPT_DIR/oc-stream" "$BIN_DIR/oc-stream"
  install -m 0755 "$SCRIPT_DIR/oc-agent"  "$BIN_DIR/oc-agent"
  install -m 0644 "$SCRIPT_DIR/oc-stream-parse.mjs" "$LIBEXEC_DIR/oc-stream-parse.mjs"
  echo "Installed OpenCode backend -> oc-stream, oc-agent (parser -> $LIBEXEC_DIR/oc-stream-parse.mjs)"
  if command -v opencode >/dev/null 2>&1; then
    echo "  opencode CLI: found ($(opencode --version 2>/dev/null || echo '?'))"
  else
    if [ "$INSTALL_MISSING" -eq 1 ]; then try_install_missing_cli opencode || true; fi
    if command -v opencode >/dev/null 2>&1; then
      echo "  opencode CLI: found ($(opencode --version 2>/dev/null || echo '?'))"
    else
      echo "  WARNING: 'opencode' (OpenCode CLI) not found in PATH. Install it:"
      echo "    npm i -g opencode-ai"
      echo "    # auth is OPENROUTER_API_KEY (config below) -- no login/OAuth flow"
    fi
  fi
fi

# ---- GitHub Copilot backend (cp-* family) ----------------------------------
if [ "$WANT_CP" -eq 1 ]; then
  install -m 0755 "$SCRIPT_DIR/cp-stream" "$BIN_DIR/cp-stream"
  install -m 0755 "$SCRIPT_DIR/cp-agent"  "$BIN_DIR/cp-agent"
  install -m 0644 "$SCRIPT_DIR/cp-stream-parse.mjs" "$LIBEXEC_DIR/cp-stream-parse.mjs"
  echo "Installed GitHub Copilot backend -> cp-stream, cp-agent (parser -> $LIBEXEC_DIR/cp-stream-parse.mjs)"
  if command -v copilot >/dev/null 2>&1; then
    echo "  copilot CLI: found ($(copilot --version 2>/dev/null || echo '?'))"
  else
    if [ "$INSTALL_MISSING" -eq 1 ]; then try_install_missing_cli copilot || true; fi
    if command -v copilot >/dev/null 2>&1; then
      echo "  copilot CLI: found ($(copilot --version 2>/dev/null || echo '?'))"
    else
      echo "  WARNING: 'copilot' (GitHub Copilot CLI) not found in PATH. Install it, then authenticate:"
      echo "    npm i -g @github/copilot"
      echo "    brew install --cask copilot-cli"
      echo "    curl -fsSL https://gh.io/copilot-install | bash"
      echo "    gh auth login   # or set COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN; active Copilot subscription required"
    fi
  fi
fi

# ---- config skeleton (shared; created if missing, otherwise idempotently topped up) ---
# Fresh file: write the global header, then append every backend block (created ⊇ appended).
# Existing file: append only the backend blocks whose marker line is still absent — an
# existing key line (even if empty "") is NEVER touched (ensure_config_block matches ^KEY=
# at line-start, so no duplicate lines can be produced).
mkdir -p "$CONFIG_DIR"
CFG_CHANGED=0
if [ ! -f "$CONFIG" ]; then
  umask 077
  printf '%s\n' '# cli-dispatch config — DO NOT COMMIT.' > "$CONFIG"
  chmod 600 "$CONFIG"
  CFG_CREATED=1
else
  CFG_CREATED=0
fi
# Add all platform-supported backend blocks idempotently (all five on Unix).
for _b in deepseek antigravity codex opencode copilot; do
  if ensure_config_block "$CONFIG" "$_b"; then CFG_CHANGED=1; fi
done
if [ "$CFG_CREATED" -eq 1 ]; then
  echo "Created config template -> $CONFIG"
elif [ "$CFG_CHANGED" -eq 1 ]; then
  echo "Config updated (added missing backend blocks) -> $CONFIG"
else
  echo "Config already complete -> $CONFIG (left untouched)"
fi

# ---- policy.json skeleton (only with --policy-injection on; never clobbered) -----------
POLICY_FILE="$CONFIG_DIR/policy.json"
if [ "$POLICY_INJECTION" = "on" ] && [ ! -f "$POLICY_FILE" ]; then
  mkdir -p "$CONFIG_DIR"
  _VER="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$SCRIPT_DIR/../.claude-plugin/plugin.json" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"[^"]*$/\1/')"
  cat > "$POLICY_FILE" <<POL
{
  "schemaVersion": 1,
  "enabled": true,
  "issueReminder": true,
  "claudeMdBlock": false,
  "pluginVersionAtSetup": "${_VER:-unknown}",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
POL
  echo "Created policy.json (injection ENABLED) -> $POLICY_FILE"
fi

# Auto-open the config so the user can paste a key — triggered whenever the config was just
# created OR at least one backend block was added this run (CFG_CREATED/CFG_CHANGED), AND we
# are in an interactive terminal. A Claude-mediated Bash tool has no TTY, so it auto-selects
# non-interactive and the editor is NEVER opened — only the path is printed.
# Override the opener via CLI_DISPATCH_EDITOR (legacy CLAUDE_DS_EDITOR still honored), e.g. ="code".
if [ "$NONINTERACTIVE" -eq 1 ] || [ ! -t 0 ]; then INTERACTIVE=0; else INTERACTIVE=1; fi
_EDITOR="${CLI_DISPATCH_EDITOR:-${CLAUDE_DS_EDITOR:-}}"
if [ "$INTERACTIVE" -eq 1 ] && { [ "$CFG_CREATED" -eq 1 ] || [ "$CFG_CHANGED" -eq 1 ]; }; then
  if [ -n "$_EDITOR" ]; then
    "$_EDITOR" "$CONFIG" >/dev/null 2>&1 && echo "Opened config in \$CLI_DISPATCH_EDITOR -> add your key, then save." || true
  elif command -v open >/dev/null 2>&1; then            # macOS
    { open -e "$CONFIG" >/dev/null 2>&1 || open -t "$CONFIG" >/dev/null 2>&1; } && echo "Opened config in editor -> add your key, then save." || true
  elif command -v xdg-open >/dev/null 2>&1; then         # Linux
    xdg-open "$CONFIG" >/dev/null 2>&1 && echo "Opened config in editor -> add your key, then save." || true
  elif grep -qi microsoft /proc/version 2>/dev/null && command -v explorer.exe >/dev/null 2>&1; then  # WSL
    explorer.exe "$(wslpath -w "$CONFIG" 2>/dev/null)" >/dev/null 2>&1 && echo "Opened config in editor -> add your key, then save." || true
  else
    # No GUI opener available — never launch a TUI editor (nano/vim would hang the Bash tool).
    echo "No GUI editor found — edit manually: \$EDITOR $CONFIG (or nano/vim)"
  fi
else
  echo "Config: $CONFIG (edit to add your keys)"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    if [ "$(basename "${SHELL:-}")" = "zsh" ]; then
      ZSENV="$HOME/.zshenv"
      EXPORT_LINE='export PATH="$HOME/.local/bin:$PATH"'
      if grep -qF '$HOME/.local/bin' "$ZSENV" 2>/dev/null; then
        echo "~/.zshenv already exports \$HOME/.local/bin -> PATH (left untouched)"
      else
        echo "$EXPORT_LINE" >> "$ZSENV"
        echo "Added \$HOME/.local/bin to ~/.zshenv (read by non-interactive zsh -- needed for Claude Code subagents to find these CLIs). Restart your shell or Claude Code session."
      fi
    else
      echo "WARNING: $BIN_DIR is not in PATH. Add it to your shell profile."
    fi
    ;;
esac

# Write installed version stamp so status.md can detect staleness.
_PLUGIN_JSON="$SCRIPT_DIR/../.claude-plugin/plugin.json"
if [ -f "$_PLUGIN_JSON" ]; then
  _VER="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$_PLUGIN_JSON" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"[^"]*$/\1/')"
  if [ -n "$_VER" ]; then
    mkdir -p "$CONFIG_DIR"
    printf '%s' "$_VER" > "$CONFIG_DIR/.installed-version"
  fi
fi

echo "Done."
[ "$WANT_DS" -eq 1 ] && echo "  DeepSeek:    add your key to $CONFIG, then test: claude-ds -p 'Reply with exactly: OK'"
[ "$WANT_AG" -eq 1 ] && echo "  Antigravity: sign in with 'agy' (or set GEMINI_API_KEY), then test: ag-agent -q 'Reply with exactly: OK'"
[ "$WANT_CX" -eq 1 ] && echo "  Codex:       run 'codex login' (or set CODEX_API_KEY), then test: cx-agent --read-only -q 'Reply with exactly: OK'"
[ "$WANT_OC" -eq 1 ] && echo "  OpenCode:    add your OPENROUTER_API_KEY to $CONFIG, then test: oc-agent -q 'Reply with exactly: OK'"
[ "$WANT_CP" -eq 1 ] && echo "  Copilot:     run 'gh auth login' (or set COPILOT_GITHUB_TOKEN/GH_TOKEN), ensure Copilot subscription, then test: cp-agent -q 'Reply with exactly: OK'"
