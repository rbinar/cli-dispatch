#!/usr/bin/env pwsh
# cli-dispatch-gain.ps1 — launches the gain-report engine.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "cli-dispatch-gain: 'node' not found in PATH (required)."; exit 1 }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$engine = $env:CLI_DISPATCH_GAIN_ENGINE
if ([string]::IsNullOrEmpty($engine)) {
  foreach ($cand in @(
    (Join-Path $HOME ".local/share/cli-dispatch/gain-report.mjs"),
    (Join-Path $HOME ".local/share/claude-ds/gain-report.mjs"),
    (Join-Path $ScriptDir "gain-report.mjs")
  )) {
    if (Test-Path $cand) { $engine = $cand; break }
  }
}
if ([string]::IsNullOrEmpty($engine) -or -not (Test-Path $engine)) { Write-Error "cli-dispatch-gain: gain-report.mjs not found (run /cli-dispatch:setup)." ; exit 1 }

& node $engine @Arguments
exit $LASTEXITCODE
