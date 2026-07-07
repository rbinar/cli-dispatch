#!/usr/bin/env pwsh
# cli-dispatch-dashboard — launch the local, read-only web dashboard (Windows).
$ErrorActionPreference = "Stop"

# Version staleness check
$installedVerFile = Join-Path $HOME '.config/cli-dispatch/.installed-version'
if (Test-Path $installedVerFile) {
  try {
    $installedVer = (Get-Content -Raw $installedVerFile 2>$null)
    if ($installedVer) { $installedVer = $installedVer.Trim() }
    $cacheDir = Join-Path $HOME '.claude/plugins/cache/cli-dispatch/cli-dispatch'
    if ($installedVer -and (Test-Path $cacheDir)) {
      $subdirs = Get-ChildItem -Path $cacheDir -Directory 2>$null
      $newestVer = $null
      foreach ($dir in $subdirs) {
        $name = $dir.Name
        if ($name -match '^\d+\.\d+\.\d+$') {
          if ($null -eq $newestVer) {
            $newestVer = $name
          } else {
            $pName = $name -split '\.' | ForEach-Object { [int]$_ }
            $pNewest = $newestVer -split '\.' | ForEach-Object { [int]$_ }
            $isGreater = $false
            for ($idx = 0; $idx -lt 3; $idx++) {
              $vName = if ($idx -lt $pName.Length) { $pName[$idx] } else { 0 }
              $vNewest = if ($idx -lt $pNewest.Length) { $pNewest[$idx] } else { 0 }
              if ($vName -gt $vNewest) { $isGreater = $true; break }
              if ($vName -lt $vNewest) { break }
            }
            if ($isGreater) { $newestVer = $name }
          }
        }
      }
      if ($newestVer) {
        $pInst = $installedVer -split '\.' | ForEach-Object { [int]$_ }
        $pNew = $newestVer -split '\.' | ForEach-Object { [int]$_ }
        $isOlder = $false
        for ($idx = 0; $idx -lt 3; $idx++) {
          $vInst = if ($idx -lt $pInst.Length) { $pInst[$idx] } else { 0 }
          $vNew = if ($idx -lt $pNew.Length) { $pNew[$idx] } else { 0 }
          if ($vInst -lt $vNew) { $isOlder = $true; break }
          if ($vInst -gt $vNew) { break }
        }
        if ($isOlder) {
          [Console]::Error.WriteLine("cli-dispatch: installed copy ($installedVer) is older than the available plugin ($newestVer) — run /cli-dispatch:setup to re-sync ~/.local. Continuing with the installed copy.")
        }
      }
    }
  } catch {}
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
