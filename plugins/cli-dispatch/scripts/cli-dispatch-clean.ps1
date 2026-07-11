#!/usr/bin/env pwsh
# cli-dispatch-clean.ps1 — Windows launcher for the stale-worker cleanup engine. Resolves
# cli-dispatch-clean.mjs (installed share dir → legacy claude-ds → next to this script) and
# runs it with node. Default DRY-RUN; pass --remove to delete. Used by hand and by the
# scheduled auto-clean (Scheduled Task).
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
      Write-Host "cli-dispatch-clean: resolved node via $cand"
      break
    }
  }
}
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
