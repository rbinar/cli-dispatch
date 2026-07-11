#!/usr/bin/env pwsh
# version-check.ps1 — shared version-staleness check for pwsh entry points. Dot-sourced by
# cli-dispatch-dashboard.ps1, ds-agent.ps1, and cx-agent.ps1 (mirrors the bash equivalent,
# version-check.sh, sourced the same way by the bash *-agent wrappers — see that file for
# the shared installed-vs-cached-plugin-version semantics). Best-effort: any failure
# (missing file, malformed version) is silently ignored via the try/return-early style below.

function Show-VersionWarning {
  $installedVerFile = Join-Path $HOME '.config/cli-dispatch/.installed-version'
  if (-not (Test-Path $installedVerFile)) { return }
  try {
    $installedVer = (Get-Content -Raw $installedVerFile 2>$null).Trim()
    if ([string]::IsNullOrEmpty($installedVer)) { return }
    $cacheDir = Join-Path $HOME '.claude/plugins/cache/cli-dispatch/cli-dispatch'
    if (-not (Test-Path $cacheDir)) { return }
    $subdirs = Get-ChildItem -Path $cacheDir -Directory 2>$null
    $newestVer = $null
    foreach ($dir in $subdirs) {
      $name = $dir.Name
      if ($name -notmatch '^\d+\.\d+\.\d+$') { continue }
      if ($null -eq $newestVer) { $newestVer = $name; continue }
      $parts = [int[]]($name -split '\.')
      $curr = [int[]]($newestVer -split '\.')
      for ($i = 0; $i -lt 3; $i++) {
        $vName = if ($i -lt $parts.Length) { $parts[$i] } else { 0 }
        $vCur = if ($i -lt $curr.Length) { $curr[$i] } else { 0 }
        if ($vName -gt $vCur) { $newestVer = $name; break }
        if ($vName -lt $vCur) { break }
      }
    }
    if ([string]::IsNullOrEmpty($newestVer) -or $newestVer -eq $installedVer) { return }
    $nextParts = [int[]]($newestVer -split '\.')
    $instParts = [int[]]($installedVer -split '\.')
    for ($i = 0; $i -lt 3; $i++) {
      $vNext = if ($i -lt $nextParts.Length) { $nextParts[$i] } else { 0 }
      $vInst = if ($i -lt $instParts.Length) { $instParts[$i] } else { 0 }
      if ($vNext -lt $vInst) { return }
      if ($vNext -gt $vInst) {
        [Console]::Error.WriteLine("cli-dispatch: installed copy ($installedVer) is older than the available plugin ($newestVer) — run /cli-dispatch:setup to re-sync ~/.local. Continuing with the installed copy.")
        return
      }
    }
  } catch {}
}
