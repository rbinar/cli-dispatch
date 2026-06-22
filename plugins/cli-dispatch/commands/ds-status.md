---
description: Check the claude-ds installation status
allowed-tools: Bash
---

# claude-ds status

Run the checks below (read-only; do NOT print the key VALUE):

```bash
command -v claude-ds >/dev/null 2>&1 && echo "wrapper: installed ($(command -v claude-ds))" || echo "wrapper: MISSING (run /cli-dispatch:ds-setup)"
command -v claude-ds-stream >/dev/null 2>&1 && echo "stream wrapper: installed ($(command -v claude-ds-stream))" || echo "stream wrapper: MISSING (run /cli-dispatch:ds-setup)"
CFG="${CLAUDE_DS_CONFIG:-$HOME/.config/claude-ds/config}"
if [ -f "$CFG" ]; then
  ( . "$CFG"; [ -n "${DEEPSEEK_API_KEY:-}" ] && echo "key: set" || echo "key: MISSING (add it to the config)" )
else
  echo "config: MISSING ($CFG)"
fi
command -v claude >/dev/null 2>&1 && echo "claude CLI: found" || echo "claude CLI: MISSING"
command -v node >/dev/null 2>&1 && echo "node: found (required by claude-ds-stream)" || echo "node: MISSING (claude-ds-stream needs it)"
```

**Native Windows** (PowerShell equivalent):

```powershell
if (Get-Command claude-ds -ErrorAction SilentlyContinue) { 'wrapper: installed' } else { 'wrapper: MISSING' }
if (Get-Command claude-ds-stream -ErrorAction SilentlyContinue) { 'stream wrapper: installed' } else { 'stream wrapper: MISSING' }
$cfg = Join-Path $HOME '.config/claude-ds/config'
if (Test-Path $cfg) { if ((Get-Content $cfg -Raw) -match 'DEEPSEEK_API_KEY="..*"') { 'key: set' } else { 'key: MISSING' } } else { 'config: MISSING' }
if (Get-Command claude -ErrorAction SilentlyContinue) { 'claude CLI: found' } else { 'claude CLI: MISSING' }
if (Get-Command node -ErrorAction SilentlyContinue) { 'node: found' } else { 'node: MISSING (claude-ds-stream needs it)' }
```

If everything is in place, suggest an optional smoke test (as a background task): `claude-ds -p "Reply with exactly: OK"`.
