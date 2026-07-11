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

# Locate cx-stream (PATH, else next to this script) — mirrors cx-agent.ps1's fallback so
# this script doesn't hard-fail in an environment where /cli-dispatch:setup hasn't put
# cx-stream on PATH.
$stream = "cx-stream"
if (-not (Get-Command $stream -ErrorAction SilentlyContinue)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $stream = Join-Path $scriptDir "cx-stream.ps1"
}

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
# Default sandbox workspace-write → edits land in $WT. Pass --read-only for an analysis run.
# Mirrors bash's `trap _cleanup ERR INT TERM`: the worktree info + manual cleanup
# instructions are always shown (success or failure) — bash never auto-deletes the
# worktree, it just prints the commands so YOU can do it. The worker's exit code must
# propagate as this script's exit code (no more swallowing failures).
$workerExitCode = 0
try {
  & $stream --cwd $WT -p $brief
  $workerExitCode = $LASTEXITCODE
} catch {
  Write-Error $_.Exception.Message -ErrorAction Continue
  $workerExitCode = 1
} finally {
  Write-Host ">>> Worktree: $WT  (branch: $Branch)"
  Write-Host ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
  Write-Host "    Remove-Item `"$wtNM`" -Force; git -C `"$Repo`" worktree remove `"$WT`" --force; git -C `"$Repo`" worktree prune"
}
if ($workerExitCode -ne 0) { exit $workerExitCode }

git -C $WT status --short
