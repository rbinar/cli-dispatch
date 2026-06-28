#!/usr/bin/env pwsh
# cli-dispatch-clean.ps1 — Windows launcher for the stale-worker cleanup engine. Resolves
# cli-dispatch-clean.mjs (installed share dir → legacy claude-ds → next to this script) and
# runs it with node. Default DRY-RUN; pass --remove to delete. Used by hand and by the
# scheduled auto-clean (Scheduled Task).
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "cli-dispatch-clean: 'node' not found in PATH (required)."; exit 1 }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$engine = $env:CLI_DISPATCH_CLEAN_ENGINE
if ([string]::IsNullOrEmpty($engine)) {
  foreach ($cand in @(
    (Join-Path $HOME ".local/share/cli-dispatch/cli-dispatch-clean.mjs"),
    (Join-Path $HOME ".local/share/claude-ds/cli-dispatch-clean.mjs"),
    (Join-Path $ScriptDir "cli-dispatch-clean.mjs")
  )) { if (Test-Path $cand) { $engine = $cand; break } }
}
if ([string]::IsNullOrEmpty($engine) -or -not (Test-Path $engine)) { Write-Error "cli-dispatch-clean: cli-dispatch-clean.mjs not found (run /cli-dispatch:setup)."; exit 1 }

& node $engine @args
exit $LASTEXITCODE
