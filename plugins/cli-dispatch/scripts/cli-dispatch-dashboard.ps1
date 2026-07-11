#!/usr/bin/env pwsh
# cli-dispatch-dashboard — launch the local, read-only web dashboard (Windows).
$ErrorActionPreference = "Stop"

# Version staleness check (shared module — see version-check.ps1)
$__versionCheckPs1 = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'version-check.ps1'
if (Test-Path $__versionCheckPs1) {
  try { . $__versionCheckPs1; Show-VersionWarning } catch {}
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "cli-dispatch-dashboard: 'node' not found in PATH (required)."; exit 1 }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = $env:CLI_DISPATCH_DASHBOARD_SERVER
if ([string]::IsNullOrEmpty($server)) {
  foreach ($cand in @(
    (Join-Path $HOME ".local/share/cli-dispatch/dashboard-server.mjs"),
    (Join-Path $HOME ".local/share/claude-ds/dashboard-server.mjs"),
    (Join-Path $ScriptDir "dashboard-server.mjs"))) {
    if (Test-Path $cand) { $server = $cand; break }
  }
}
if ([string]::IsNullOrEmpty($server) -or -not (Test-Path $server)) { Write-Error "cli-dispatch-dashboard: dashboard-server.mjs not found (run /cli-dispatch:setup)."; exit 1 }
node $server @args
