#!/usr/bin/env pwsh
# Note: re-running setup (/cli-dispatch:setup) is required after every plugin version bump to keep ~/.local in sync.
# Usage: install.ps1 [-Backends deepseek,codex | all]
# Native Windows supports the DeepSeek and Codex backends; Antigravity needs a pseudo-TTY
# (not available on native Windows) — install it under WSL instead.
param([string]$Backends = "deepseek", [switch]$InstallMissing, [string]$PolicyInjection = "off", [switch]$NonInteractive)
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

# Shared parser helpers (backend-agnostic; always installed) — every *-parse.mjs
# imports './parse-utils.mjs', so it must sit next to them in LibExec.
Copy-Item -Force (Join-Path $ScriptDir "parse-utils.mjs") (Join-Path $LibExecDir "parse-utils.mjs")
Write-Host "Installed shared parser helpers -> $LibExecDir\parse-utils.mjs"

# Shared pwsh version-staleness check (backend-agnostic; always installed) — dot-sourced by
# cli-dispatch-dashboard.ps1, ds-agent.ps1, and cx-agent.ps1 via
# "(Split-Path -Parent $MyInvocation.MyCommand.Path)\version-check.ps1", so it must sit next
# to them in BinDir (mirrors version-check.sh's install on the bash side).
Copy-Item -Force (Join-Path $ScriptDir "version-check.ps1") (Join-Path $BinDir "version-check.ps1")
Write-Host "Installed shared version-check helper -> $BinDir\version-check.ps1"

# Dashboard (backend-agnostic; always installed).
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-dashboard.ps1") (Join-Path $BinDir "cli-dispatch-dashboard.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-dashboard.cmd") -Value (New-Shim "cli-dispatch-dashboard") -Encoding ASCII
Copy-Item -Force (Join-Path $ScriptDir "dashboard-server.mjs") (Join-Path $LibExecDir "dashboard-server.mjs")
Copy-Item -Force (Join-Path $ScriptDir "public-page.mjs") (Join-Path $LibExecDir "public-page.mjs")
Copy-Item -Force (Join-Path $ScriptDir "dashboard-utils.mjs") (Join-Path $LibExecDir "dashboard-utils.mjs")
# takeover on native Windows is untested (node-pty); assets shipped for parity.
Copy-Item -Force (Join-Path $ScriptDir "pty-host.mjs") (Join-Path $LibExecDir "pty-host.mjs")
Copy-Item -Force (Join-Path $ScriptDir "takeover-cmd.mjs") (Join-Path $LibExecDir "takeover-cmd.mjs")
New-Item -ItemType Directory -Force -Path (Join-Path $LibExecDir "vendor") | Out-Null
Copy-Item -Force (Join-Path $ScriptDir "vendor/LICENSE-xterm.txt") (Join-Path $LibExecDir "vendor/LICENSE-xterm.txt")
Copy-Item -Force (Join-Path $ScriptDir "vendor/xterm-addon-fit.js") (Join-Path $LibExecDir "vendor/xterm-addon-fit.js")
Copy-Item -Force (Join-Path $ScriptDir "vendor/xterm.css") (Join-Path $LibExecDir "vendor/xterm.css")
Copy-Item -Force (Join-Path $ScriptDir "vendor/xterm.js") (Join-Path $LibExecDir "vendor/xterm.js")
Write-Host "Installed dashboard -> $BinDir\cli-dispatch-dashboard.ps1 (+ .cmd shim; server + public-page + dashboard-utils + takeover pty-host/takeover-cmd/vendor xterm -> $LibExecDir\dashboard-server.mjs)"

# Cleanup tool (backend-agnostic; always installed).
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-clean.ps1") (Join-Path $BinDir "cli-dispatch-clean.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-clean.cmd") -Value (New-Shim "cli-dispatch-clean") -Encoding ASCII
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-clean.mjs") (Join-Path $LibExecDir "cli-dispatch-clean.mjs")
Write-Host "Installed cleaner -> $BinDir\cli-dispatch-clean.ps1 (+ .cmd shim; engine -> $LibExecDir\cli-dispatch-clean.mjs)"

# Blocking-wait tool (backend-agnostic; always installed).
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-wait.ps1") (Join-Path $BinDir "cli-dispatch-wait.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-wait.cmd") -Value (New-Shim "cli-dispatch-wait") -Encoding ASCII
Write-Host "Installed waiter -> $BinDir\cli-dispatch-wait.ps1 (+ .cmd shim; blocks until a session reaches a terminal state)"

# Gain-report tool (backend-agnostic; always installed).
Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-gain.ps1") (Join-Path $BinDir "cli-dispatch-gain.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-gain.cmd") -Value (New-Shim "cli-dispatch-gain") -Encoding ASCII
Copy-Item -Force (Join-Path $ScriptDir "gain-report.mjs") (Join-Path $LibExecDir "gain-report.mjs")
Write-Host "Installed gain reporter -> $BinDir\cli-dispatch-gain.ps1 (+ .cmd shim; engine -> $LibExecDir\gain-report.mjs)"

Copy-Item -Force (Join-Path $ScriptDir "cli-dispatch-run.ps1") (Join-Path $BinDir "cli-dispatch-run.ps1")
Set-Content -Path (Join-Path $BinDir "cli-dispatch-run.cmd") -Value (New-Shim "cli-dispatch-run") -Encoding ASCII
Copy-Item -Force (Join-Path $ScriptDir "verdict-writer.mjs") (Join-Path $LibExecDir "verdict-writer.mjs")
# cli-dispatch-run resolves its per-backend worktree runners next to itself and invokes the
# .sh variant via bash even on Windows — ship them (ds/cx are the Windows-native backends) or
# those backends fail with "backend runner not found". The .ps1 twins ride along for parity.
foreach ($wr in @("ds-worktree-run.sh", "cx-worktree-run.sh", "ds-worktree-run.ps1", "cx-worktree-run.ps1")) {
  Copy-Item -Force (Join-Path $ScriptDir $wr) (Join-Path $BinDir $wr)
}
Write-Host "Installed cli-dispatch-run -> $BinDir\cli-dispatch-run.ps1 (+ .cmd shim, ds/cx worktree runners; engine -> $LibExecDir\verdict-writer.mjs)"

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
  else {
    if ($InstallMissing) {
      try {
        if (Get-Command npm -ErrorAction SilentlyContinue) {
          Write-Host "  codex CLI: not found — attempting 'npm i -g @openai/codex' (-InstallMissing)..."
          npm i -g @openai/codex
        } elseif (Get-Command winget -ErrorAction SilentlyContinue) {
          Write-Host "  codex CLI: not found — npm unavailable, attempting 'winget install OpenAI.Codex' (-InstallMissing)..."
          winget install OpenAI.Codex
        } else {
          Write-Host "  FAIL: cannot install codex — npm (and winget) not found in PATH; npm is required."
        }
      } catch { Write-Host "  FAIL: codex install attempt failed: $_" }
      if (Get-Command codex -ErrorAction SilentlyContinue) { Write-Host "  codex CLI: SUCCESS — installed ($(codex --version 2>$null))" }
      else {
        Write-Host "  FAIL: codex CLI still not found after install attempt."
        Write-Host "  WARNING: 'codex' (OpenAI Codex CLI) not found in PATH. Install: npm i -g @openai/codex, then run 'codex login'."
      }
    } else { Write-Host "  WARNING: 'codex' (OpenAI Codex CLI) not found in PATH. Install: npm i -g @openai/codex, then run 'codex login'." }
  }
}

# Idempotently append one backend's config block to $CfgPath (native Windows: deepseek +
# codex only — Antigravity/OpenCode/Copilot are Unix-only). Mirrors install.sh's
# ensure_config_block: never touches an existing block, only appends a missing one.
function Ensure-ConfigBlock {
  param([string]$CfgPath, [string]$Backend)
  switch ($Backend) {
    'deepseek' { $marker = 'DEEPSEEK_API_KEY='; $block = @'

# --- DeepSeek backend (claude-ds) --- add your DeepSeek API key below.
DEEPSEEK_API_KEY=""
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
'@ }
    'codex' { $marker = 'CODEX_API_KEY='; $block = @'

# --- Codex backend (cx-agent / cx-stream, OpenAI Codex CLI) --- OPTIONAL.
# Auth: run `codex login` once (ChatGPT/OAuth — no key needed for personal use).
# For headless/CI, CODEX_API_KEY takes precedence over OPENAI_API_KEY.
CODEX_API_KEY=""
# Default model for the codex worker. Blank = codex's own default. Override per-call with
# `cx-agent --model <name>`. gpt-5.6-sol/terra/luna rank above gpt-5.5, gpt-5.4, gpt-5.4-mini.
CX_MODEL=""
# Optional comma-separated candidate model list — when set, the delegating agent
# picks the best fit from this list (same reasoning as an orchestrator-provided inline
# list). Leave empty to use only the single CX_MODEL default above.
CX_MODELS=""
'@ }
    default { return $null }
  }
  if ((Test-Path $CfgPath) -and (Select-String -Path $CfgPath -Pattern "^$([regex]::Escape($marker))" -Quiet)) {
    return $false  # unchanged
  }
  Add-Content -Path $CfgPath -Value $block -Encoding UTF8
  return $true     # appended
}

$cfgCreated = $false; $cfgChanged = $false
if (-not (Test-Path $Config)) {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  Set-Content -Path $Config -Value '# cli-dispatch config — DO NOT COMMIT.' -Encoding UTF8
  $cfgCreated = $true
}
foreach ($b in @('deepseek', 'codex')) { if (Ensure-ConfigBlock -CfgPath $Config -Backend $b) { $cfgChanged = $true } }
if ($cfgCreated) { Write-Host "Created config template -> $Config" }
elseif ($cfgChanged) { Write-Host "Config updated (added missing backend blocks) -> $Config" }
else { Write-Host "Config already complete -> $Config (left untouched)" }

# Write the policy.json skeleton — only when -PolicyInjection on AND the file doesn't already
# exist (never clobber an existing policy.json).
$policyFile = Join-Path $ConfigDir "policy.json"
if (($PolicyInjection -eq "on") -and (-not (Test-Path $policyFile))) {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  $ver = "unknown"
  try { $ver = (Get-Content -Raw (Join-Path $ScriptDir "..\.claude-plugin\plugin.json") | ConvertFrom-Json).version } catch {}
  $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  @"
{
  "schemaVersion": 1,
  "enabled": true,
  "issueReminder": true,
  "claudeMdBlock": false,
  "pluginVersionAtSetup": "$ver",
  "updatedAt": "$now"
}
"@ | Set-Content -Path $policyFile -Encoding UTF8
  Write-Host "Created policy.json (injection ENABLED) -> $policyFile"
}

# Open the config so the user can paste their key — only when the config was created or
# changed (a new backend block appended) AND the session is interactive. Best-effort: never
# fail the install if opening fails. Override the opener via $env:CLI_DISPATCH_EDITOR or
# $env:CLAUDE_DS_EDITOR (e.g. "code"); CLI_DISPATCH_EDITOR is preferred, CLAUDE_DS_EDITOR is
# the legacy fallback.
$interactive = -not ($NonInteractive -or -not [Environment]::UserInteractive)
if (-not ($cfgCreated -or $cfgChanged)) {
  Write-Host "Config: $Config (edit to add your keys)"
} elseif (-not $interactive) {
  Write-Host "Config: $Config (edit to add your keys)"
} else {
  try {
    if ($env:CLI_DISPATCH_EDITOR) { Start-Process $env:CLI_DISPATCH_EDITOR $Config }
    elseif ($env:CLAUDE_DS_EDITOR) { Start-Process $env:CLAUDE_DS_EDITOR $Config }
    else { Start-Process notepad $Config }
    Write-Host "Opened config in editor -> add your key, then save."
  } catch { }
}

$inPath = ($env:PATH -split ';') -contains $BinDir
if (-not $inPath) { Write-Host "WARNING: $BinDir is not in PATH. Add it (e.g. via 'setx PATH ...' or System settings)." }

if ($wantDS) {
  if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "claude CLI: found" }
  else {
    if ($InstallMissing) {
      try {
        if (Get-Command npm -ErrorAction SilentlyContinue) {
          Write-Host "claude CLI: not found — attempting 'npm i -g @anthropic-ai/claude-code' (-InstallMissing)..."
          npm i -g @anthropic-ai/claude-code
        } else {
          Write-Host "FAIL: cannot install claude CLI — npm not found in PATH; Node.js/npm is required."
        }
      } catch { Write-Host "FAIL: claude CLI install attempt failed: $_" }
      if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "claude CLI: SUCCESS — installed" }
      else {
        Write-Host "FAIL: claude CLI still not found after install attempt."
        Write-Host "WARNING: claude CLI not found in PATH (the DeepSeek worker wraps it)."
      }
    } else { Write-Host "WARNING: claude CLI not found in PATH (the DeepSeek worker wraps it)." }
  }
}
# Write installed version stamp so status.md can detect staleness.
$pluginJson = Join-Path $ScriptDir "..\.claude-plugin\plugin.json"
if (Test-Path $pluginJson) {
  try {
    $j = Get-Content -Raw $pluginJson | ConvertFrom-Json
    $ver = $j.version
    if ($ver) {
      New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
      Set-Content -Path (Join-Path $ConfigDir '.installed-version') -Value $ver -NoNewline -Encoding UTF8
    }
  } catch {}
}

Write-Host "Done."
if ($wantDS) { Write-Host "  DeepSeek: add your key to $Config, then test: claude-ds -p 'Reply with exactly: OK'" }
if ($wantCX) { Write-Host "  Codex:    run 'codex login' (or set CODEX_API_KEY), then test: cx-agent --read-only -q 'Reply with exactly: OK'" }
