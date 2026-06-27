---
description: Check the cli-dispatch installation status (DeepSeek + Antigravity + Codex)
allowed-tools: Bash
---

# cli-dispatch status

Run the checks below (read-only; do NOT print the key VALUE):

```bash
echo "== DeepSeek backend (claude-ds) =="
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

command -v node >/dev/null 2>&1 && echo "node: found (required by all stream parsers)" || echo "node: MISSING (the stream wrappers need it)"
```

**Native Windows** (PowerShell equivalent):

```powershell
if (Get-Command claude-ds -ErrorAction SilentlyContinue) { 'wrapper: installed' } else { 'wrapper: MISSING' }
if (Get-Command claude-ds-stream -ErrorAction SilentlyContinue) { 'stream wrapper: installed' } else { 'stream wrapper: MISSING' }
$cfg = if ($env:CLI_DISPATCH_CONFIG) { $env:CLI_DISPATCH_CONFIG } elseif ($env:CLAUDE_DS_CONFIG) { $env:CLAUDE_DS_CONFIG } elseif (Test-Path (Join-Path $HOME '.config/cli-dispatch/config')) { Join-Path $HOME '.config/cli-dispatch/config' } else { Join-Path $HOME '.config/claude-ds/config' }
if (Test-Path $cfg) { if ((Get-Content $cfg -Raw) -match 'DEEPSEEK_API_KEY="..*"') { 'key: set' } else { 'key: MISSING' } } else { 'config: MISSING' }
if (Get-Command claude -ErrorAction SilentlyContinue) { 'claude CLI: found' } else { 'claude CLI: MISSING' }
if (Get-Command node -ErrorAction SilentlyContinue) { 'node: found' } else { 'node: MISSING (claude-ds-stream needs it)' }
```

If everything is in place, suggest an optional smoke test (as a background task): `claude-ds -p "Reply with exactly: OK"`.
