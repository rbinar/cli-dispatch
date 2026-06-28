#!/usr/bin/env pwsh
# Usage: install.ps1 [-Backends deepseek,codex | all]
# Native Windows supports the DeepSeek and Codex backends; Antigravity needs a pseudo-TTY
# (not available on native Windows) — install it under WSL instead.
param([string]$Backends = "deepseek")
$ErrorActionPreference = "Stop"

$backendList = ($Backends -replace '\s', '').ToLower()
if ($backendList -eq 'all') { $backendList = 'deepseek,codex' }
$want = @{}
foreach ($b in ($backendList -split ',')) { if ($b) { $want[$b] = $true } }
if ($want.ContainsKey('antigravity')) {
  Write-Host "NOTE: the Antigravity backend needs a pseudo-TTY (not on native Windows) — install it under WSL. Skipping here."
  $want.Remove('antigravity') | Out-Null
}
$wantDS = $want.ContainsKey('deepseek')
$wantCX = $want.ContainsKey('codex')
if (-not ($wantDS -or $wantCX)) { Write-Error "install.ps1: no installable backend in '-Backends $Backends' (deepseek,codex on native Windows)"; exit 1 }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinDir = Join-Path $HOME ".local/bin"
$LibExecDir = Join-Path $HOME ".local/share/cli-dispatch"
$ConfigDir = Join-Path $HOME ".config/cli-dispatch"
$Config = Join-Path $ConfigDir "config"

# One-time migration from the legacy claude-ds paths (wrappers also fall back at runtime).
$oldConfig = Join-Path $HOME ".config/claude-ds/config"
if ((Test-Path $oldConfig) -and (-not (Test-Path $Config))) {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  Move-Item -Force $oldConfig $Config
  Write-Host "Migrated config: $oldConfig -> $Config"
}
$cacheRoot = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
$oldSess = Join-Path $cacheRoot "claude-ds/sessions"; $newSess = Join-Path $cacheRoot "cli-dispatch/sessions"
if ((Test-Path $oldSess) -and (-not (Test-Path $newSess))) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $newSess) | Out-Null
  Move-Item -Force $oldSess $newSess
  Write-Host "Migrated sessions: $oldSess -> $newSess"
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $LibExecDir | Out-Null
Write-Host "Backends: $($want.Keys -join ',')"

# .cmd shim generator (uses pwsh if available, otherwise falls back to powershell).
function New-Shim($name) {
  @"
@echo off
where pwsh >nul 2>nul && (pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0$name.ps1" %*) || (powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0$name.ps1" %*)
"@
}

# Dashboard (backend-agnostic; always installed).
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-dashboard.ps1") (Join-Path $BinDir "cli-dispatch-dashboard.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-dashboard.cmd") -Value (New-Shim "cli-dispatch-dashboard") -Encoding ASCII
Copy-Item -Force (Join-Path $ScriptDir "dashboard-server.mjs") (Join-Path $LibExecDir "dashboard-server.mjs")
Write-Host "Installed dashboard -> $BinDir\cli-dispatch-dashboard.ps1 (+ .cmd shim; server -> $LibExecDir\dashboard-server.mjs)"

# Cleanup tool (backend-agnostic; always installed).
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-clean.ps1") (Join-Path $BinDir "cli-dispatch-clean.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-clean.cmd") -Value (New-Shim "cli-dispatch-clean") -Encoding ASCII
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-clean.mjs") (Join-Path $LibExecDir "cli-dispatch-clean.mjs")
Write-Host "Installed cleaner -> $BinDir\cli-dispatch-clean.ps1 (+ .cmd shim; engine -> $LibExecDir\cli-dispatch-clean.mjs)"

# ---- DeepSeek backend (claude-ds family) ----
if ($wantDS) {
  Copy-Item -Force (Join-Path $ScriptDir "claude-ds.ps1") (Join-Path $BinDir "claude-ds.ps1")
  Set-Content -Path (Join-Path $BinDir "claude-ds.cmd") -Value (New-Shim "claude-ds") -Encoding ASCII
  Write-Host "Installed wrapper -> $BinDir\claude-ds.ps1 (+ claude-ds.cmd shim)"

  Copy-Item -Force (Join-Path $ScriptDir "claude-ds-stream.ps1") (Join-Path $BinDir "claude-ds-stream.ps1")
  Set-Content -Path (Join-Path $BinDir "claude-ds-stream.cmd") -Value (New-Shim "claude-ds-stream") -Encoding ASCII
  Copy-Item -Force (Join-Path $ScriptDir "ds-stream-parse.mjs") (Join-Path $LibExecDir "ds-stream-parse.mjs")
  Write-Host "Installed stream wrapper -> $BinDir\claude-ds-stream.ps1 (+ .cmd shim; parser -> $LibExecDir\ds-stream-parse.mjs)"

  Copy-Item -Force (Join-Path $ScriptDir "ds-agent.ps1") (Join-Path $BinDir "ds-agent.ps1")
  Set-Content -Path (Join-Path $BinDir "ds-agent.cmd") -Value (New-Shim "ds-agent") -Encoding ASCII
  Write-Host "Installed agent wrapper -> $BinDir\ds-agent.ps1 (+ .cmd shim)"
}

# ---- Codex backend (cx-* family, OpenAI Codex CLI; native on Windows) ----
if ($wantCX) {
  Copy-Item -Force (Join-Path $ScriptDir "cx-stream.ps1") (Join-Path $BinDir "cx-stream.ps1")
  Set-Content -Path (Join-Path $BinDir "cx-stream.cmd") -Value (New-Shim "cx-stream") -Encoding ASCII
  Copy-Item -Force (Join-Path $ScriptDir "cx-stream-parse.mjs") (Join-Path $LibExecDir "cx-stream-parse.mjs")
  Write-Host "Installed Codex stream wrapper -> $BinDir\cx-stream.ps1 (+ .cmd shim; parser -> $LibExecDir\cx-stream-parse.mjs)"

  Copy-Item -Force (Join-Path $ScriptDir "cx-agent.ps1") (Join-Path $BinDir "cx-agent.ps1")
  Set-Content -Path (Join-Path $BinDir "cx-agent.cmd") -Value (New-Shim "cx-agent") -Encoding ASCII
  Write-Host "Installed Codex agent wrapper -> $BinDir\cx-agent.ps1 (+ .cmd shim)"

  if (Get-Command codex -ErrorAction SilentlyContinue) { Write-Host "  codex CLI: found ($(codex --version 2>$null))" }
  else { Write-Host "  WARNING: 'codex' (OpenAI Codex CLI) not found in PATH. Install: npm i -g @openai/codex, then run 'codex login'." }
}

if (-not (Test-Path $Config)) {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  @'
# cli-dispatch config — DO NOT COMMIT.

# --- DeepSeek backend (claude-ds) --- add your DeepSeek API key below.
DEEPSEEK_API_KEY=""
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"

# --- Codex backend (cx-agent / cx-stream, OpenAI Codex CLI) --- OPTIONAL.
# Auth: run `codex login` once (ChatGPT/OAuth — no key needed for personal use).
# For headless/CI, CODEX_API_KEY takes precedence over OPENAI_API_KEY.
CODEX_API_KEY=""
# Default model for the codex worker. Blank = codex's own default. Override per-call with
# `cx-agent --model <name>`. Current models: gpt-5.5 (default), gpt-5.4, gpt-5.4-mini.
CX_MODEL=""
'@ | Set-Content -Path $Config -Encoding UTF8
  Write-Host "Created config template -> $Config"
} else {
  Write-Host "Config already exists -> $Config (left untouched)"
}

# Open the config so the user can paste their key — only when the DeepSeek backend is
# selected AND its key is still empty. Best-effort: never fail the install if opening fails.
# Override the opener via $env:CLAUDE_DS_EDITOR (e.g. "code").
if ($wantDS -and ((Get-Content $Config -Raw) -cmatch 'DEEPSEEK_API_KEY=""')) {
  try {
    if ($env:CLAUDE_DS_EDITOR) { Start-Process $env:CLAUDE_DS_EDITOR $Config }
    else { Start-Process notepad $Config }
    Write-Host "Opened config in editor -> add your key, then save."
  } catch { }
}

$inPath = ($env:PATH -split ';') -contains $BinDir
if (-not $inPath) { Write-Host "WARNING: $BinDir is not in PATH. Add it (e.g. via 'setx PATH ...' or System settings)." }

if ($wantDS) {
  if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "claude CLI: found" } else { Write-Host "WARNING: claude CLI not found in PATH (the DeepSeek worker wraps it)." }
}
Write-Host "Done."
if ($wantDS) { Write-Host "  DeepSeek: add your key to $Config, then test: claude-ds -p 'Reply with exactly: OK'" }
if ($wantCX) { Write-Host "  Codex:    run 'codex login' (or set CODEX_API_KEY), then test: cx-agent --read-only -q 'Reply with exactly: OK'" }
