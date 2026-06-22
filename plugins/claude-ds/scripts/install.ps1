#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinDir = Join-Path $HOME ".local/bin"
$LibExecDir = Join-Path $HOME ".local/share/claude-ds"
$ConfigDir = Join-Path $HOME ".config/claude-ds"
$Config = Join-Path $ConfigDir "config"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Copy-Item -Force (Join-Path $ScriptDir "claude-ds.ps1") (Join-Path $BinDir "claude-ds.ps1")

# .cmd shim generator (uses pwsh if available, otherwise falls back to powershell).
function New-Shim($name) {
  @"
@echo off
where pwsh >nul 2>nul && (pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0$name.ps1" %*) || (powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0$name.ps1" %*)
"@
}
Set-Content -Path (Join-Path $BinDir "claude-ds.cmd") -Value (New-Shim "claude-ds") -Encoding ASCII
Write-Host "Installed wrapper -> $BinDir\claude-ds.ps1 (+ claude-ds.cmd shim)"

# Stream/session-tracking variant + its Node parser.
Copy-Item -Force (Join-Path $ScriptDir "claude-ds-stream.ps1") (Join-Path $BinDir "claude-ds-stream.ps1")
Set-Content -Path (Join-Path $BinDir "claude-ds-stream.cmd") -Value (New-Shim "claude-ds-stream") -Encoding ASCII
New-Item -ItemType Directory -Force -Path $LibExecDir | Out-Null
Copy-Item -Force (Join-Path $ScriptDir "ds-stream-parse.mjs") (Join-Path $LibExecDir "ds-stream-parse.mjs")
Write-Host "Installed stream wrapper -> $BinDir\claude-ds-stream.ps1 (+ .cmd shim; parser -> $LibExecDir\ds-stream-parse.mjs)"

# Single-command, subagent-style synchronous wrapper.
Copy-Item -Force (Join-Path $ScriptDir "ds-agent.ps1") (Join-Path $BinDir "ds-agent.ps1")
Set-Content -Path (Join-Path $BinDir "ds-agent.cmd") -Value (New-Shim "ds-agent") -Encoding ASCII
Write-Host "Installed agent wrapper -> $BinDir\ds-agent.ps1 (+ .cmd shim)"

if (-not (Test-Path $Config)) {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  @'
# claude-ds config — DO NOT COMMIT. Add your DeepSeek API key below.
DEEPSEEK_API_KEY=""
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
'@ | Set-Content -Path $Config -Encoding UTF8
  Write-Host "Created config template -> $Config (add your DeepSeek API key)"
} else {
  Write-Host "Config already exists -> $Config (left untouched)"
}

# Open the config so the user can paste their key — only while the key is still
# empty. Best-effort: never fail the install if opening doesn't work.
# Override the opener via $env:CLAUDE_DS_EDITOR (e.g. "code").
if ((Get-Content $Config -Raw) -cmatch 'DEEPSEEK_API_KEY=""') {
  try {
    if ($env:CLAUDE_DS_EDITOR) { Start-Process $env:CLAUDE_DS_EDITOR $Config }
    else { Start-Process notepad $Config }
    Write-Host "Opened config in editor -> add your key, then save."
  } catch { }
}

$inPath = ($env:PATH -split ';') -contains $BinDir
if (-not $inPath) { Write-Host "WARNING: $BinDir is not in PATH. Add it (e.g. via 'setx PATH ...' or System settings)." }

if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "claude CLI: found" } else { Write-Host "WARNING: claude CLI not found in PATH." }
Write-Host "Done. Add your key to $Config, then test: claude-ds -p 'Reply with exactly: OK'"
