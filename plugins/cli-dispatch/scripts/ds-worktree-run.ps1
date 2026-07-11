#!/usr/bin/env pwsh
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Branch,
  [Parameter(Mandatory = $true)][string]$BriefFile
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $Repo ".git"))) { Write-Error "Not a git repo: $Repo"; exit 1 }
if (-not (Test-Path $BriefFile)) { Write-Error "Brief file not found: $BriefFile"; exit 1 }

# Locate claude-ds-stream (PATH, else next to this script) — mirrors ds-agent.ps1's fallback
# so this script doesn't hard-fail in an environment where /cli-dispatch:setup hasn't put
# claude-ds-stream on PATH.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stream = (Get-Command claude-ds-stream -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrWhiteSpace($stream)) {
  $stream = Join-Path $ScriptDir "claude-ds-stream.ps1"
}
if (-not (Test-Path $stream)) {
  [Console]::Error.WriteLine("ds-worktree-run.ps1: claude-ds-stream not found (run /cli-dispatch:setup).")
  exit 1
}

$WT = Join-Path ([System.IO.Path]::GetTempPath()) ("ds-wt-" + [System.IO.Path]::GetRandomFileName().Substring(0, 6))

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

# Snapshot the main repo's dirt BEFORE the worker runs: the post-check must fail only on
# NEW entries, or any pre-existing untracked file fails every good run (seen in production).
$preStatus = @(git -C $Repo status --short 2>$null)

Write-Host ">>> Running claude-ds-stream (agentic, session-tracked) in $WT ..."
$brief = Get-Content -Raw $BriefFile
# Stream variant: progress/status/transcript are written to a session dir (path on stderr).
# Mirrors bash's `trap _cleanup ERR INT TERM`: the worktree info + manual cleanup
# instructions are always shown (success or failure) — bash never auto-deletes the
# worktree, it just prints the commands so YOU can do it. The worker's exit code must
# propagate as this script's exit code (no more swallowing failures).
$workerExitCode = 0
try {
  & $stream --cwd $WT --dangerously-skip-permissions -p $brief
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

# Post-run: verify the MAIN repo gained no NEW dirt from the worker (issue #68).
# The worker should only write inside $WT; new entries in $Repo's status mean it resolved
# an absolute path back into the main checkout. Compared against the pre-run snapshot so
# pre-existing dirt never fails a good run.
$postStatus = @(git -C $Repo status --short 2>$null)
$newDirt = @($postStatus | Where-Object { $_ -and ($preStatus -notcontains $_) })
if ($newDirt.Count -eq 0) {
  Write-Host ">>> post-check OK: no new changes in $Repo"
  exit 0
}
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$patchFile = Join-Path (Split-Path -Parent $Repo) "leaked-changes-$ts.patch"
git -C $Repo diff | Out-File -FilePath $patchFile -Encoding utf8
# Note: git diff does not cover untracked files; the status entries above do list them.
Write-Host ">>> post-check FAIL: worker leaked NEW changes outside the worktree into $Repo"
Write-Host ">>> patch saved: $patchFile"
Write-Host ($newDirt -join "`n")
exit 1
