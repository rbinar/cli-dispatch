#!/usr/bin/env pwsh
# cx-worktree-run.ps1 — Windows variant of cx-worktree-run.sh. Runs the Codex worker on a
# brief inside an isolated git worktree off origin/main. YOU review the diff and handle git/PR.
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Branch,
  [Parameter(Mandatory = $true)][string]$BriefFile
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $Repo ".git"))) { Write-Error "Not a git repo: $Repo"; exit 1 }
if (-not (Test-Path $BriefFile)) { Write-Error "Brief file not found: $BriefFile"; exit 1 }

$WT = Join-Path ([System.IO.Path]::GetTempPath()) ("cx-wt-" + [System.IO.Path]::GetRandomFileName().Substring(0, 6))

$baseRef = "origin/main"
$localBranch = git -C $Repo symbolic-ref --short HEAD 2>$null
if ($localBranch) {
  $baseRef = $localBranch
} else {
  $remoteHead = git -C $Repo symbolic-ref --short refs/remotes/origin/HEAD 2>$null
  if ($remoteHead) {
    $baseRef = $remoteHead
  }
}
if ($baseRef.StartsWith("origin/")) {
  $refName = $baseRef.Substring(7)
  git -C $Repo fetch origin $refName 2>$null
}
git -C $Repo worktree add -b $Branch $WT $baseRef

$repoNM = Join-Path $Repo "node_modules"
$wtNM = Join-Path $WT "node_modules"
if ((Test-Path $repoNM) -and -not (Test-Path $wtNM)) {
  New-Item -ItemType Junction -Path $wtNM -Target $repoNM | Out-Null
}

Write-Host ">>> Running cx-stream (Codex/OpenAI, session-tracked) in $WT ..."
$brief = Get-Content -Raw $BriefFile
try { cx-stream --cwd $WT -p $brief } catch { }

Write-Host ">>> Worktree: $WT  (branch: $Branch)"
Write-Host ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
Write-Host "    Remove-Item `"$wtNM`" -Force; git -C `"$Repo`" worktree remove `"$WT`" --force; git -C `"$Repo`" worktree prune"
git -C $WT status --short
