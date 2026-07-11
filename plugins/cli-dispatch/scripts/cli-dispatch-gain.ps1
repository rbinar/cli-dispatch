#!/usr/bin/env pwsh
# cli-dispatch-gain.ps1 — launches the gain-report engine.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = "Stop"

# scheduled tasks run with a minimal PATH — node installed via a version manager or
# non-default location is invisible. Probe common Windows install locations first.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeCandidates = @()
  if ($env:CLI_DISPATCH_NODE) { $nodeCandidates += $env:CLI_DISPATCH_NODE }
  $nodeCandidates += @(
    "node",
    (Join-Path $env:NVM_SYMLINK "node.exe"),
    (Join-Path $env:NVM_HOME "node.exe"),
    (Join-Path $env:VOLTA_HOME "bin\node.exe"),
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Volta\bin\node.exe"),
    (Join-Path $env:USERPROFILE "scoop\shims\node.exe")
  )
  foreach ($cand in $nodeCandidates) {
    if ($cand -and (Get-Command $cand -ErrorAction SilentlyContinue)) {
      $env:PATH = "$(Split-Path -Parent $cand);$env:PATH"
      Write-Host "cli-dispatch-gain: resolved node via $cand"
      break
    }
  }
}
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
