#!/usr/bin/env pwsh
# cx-worktree-run.ps1 — Windows variant of cx-worktree-run.sh. Runs the Codex worker on a
# brief inside an isolated git worktree off origin/main. YOU review the diff and handle git/PR.
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Branch,
  [Parameter(Mandatory = $true)][string]$BriefFile
)
$ErrorActionPreference = "Stop"

# An inherited GIT_DIR/GIT_WORK_TREE (git hooks, any parent git process) overrides
# `git -C $Repo` — every repo probe below would then describe the INHERITED repo, not
# $Repo, and in-place detection could hand the worker the user's main checkout with zero
# isolation. Drop them before the first git call. Mirrors the bash twin's `unset`.
foreach ($v in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE') {
  Remove-Item -Path ("Env:" + $v) -ErrorAction SilentlyContinue
}

# Normalize a path for comparison. Chases the LAST component's link target
# (ResolveLinkTarget on PS7, .Target on 5.1) and expands 8.3 short names; it does NOT
# resolve symlinked *parent* directories, so it is not a full `pwd -P` equivalent. That is
# sufficient here: both values it compares (git-dir vs git-common-dir) come from git itself
# and are therefore spelled consistently.
function Resolve-RealPath([string]$p) {
  if (-not $p) { return $p }
  try {
    $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
    try {
      $t = [System.IO.Directory]::ResolveLinkTarget($item.FullName, $true)
      if ($t) { return $t.FullName }
    } catch { }
    if ($item.Target) { return (Get-Item -LiteralPath $item.Target -Force).FullName }
    return $item.FullName
  } catch { try { return [System.IO.Path]::GetFullPath($p) } catch { return $p } }
}

# Repo detection must accept main checkouts, linked worktrees (.git is a FILE, not a dir)
# and submodules — ask git instead of probing for a .git directory (issue #107). rev-parse
# exits 0 while PRINTING "false" inside a bare repo or a .git admin dir, so compare output.
$isWorkTree = (git -C $Repo rev-parse --is-inside-work-tree 2>$null)
if ("$isWorkTree".Trim() -ne "true") { [Console]::Error.WriteLine("Not a git repo (or not a work tree): $Repo"); exit 1 }
if (-not (Test-Path $BriefFile)) { Write-Error "Brief file not found: $BriefFile"; exit 1 }

# Locate cx-stream (PATH, else next to this script) — mirrors cx-agent.ps1's fallback so
# this script doesn't hard-fail in an environment where /cli-dispatch:setup hasn't put
# cx-stream on PATH.
$stream = "cx-stream"
if (-not (Get-Command $stream -ErrorAction SilentlyContinue)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $stream = Join-Path $scriptDir "cx-stream.ps1"
}

# --- in-place mode (issues #108 / #109) ----------------------------------------------
# If $Repo is ALREADY a linked worktree, the caller opened it for this job on purpose.
# Nesting a second worktree there puts the worker's cwd in a temp dir while the brief's
# absolute paths point at $Repo: writes land in $Repo, the leak post-check calls that a
# leak and exits 1 on a good run (#108), and the worker's own lint/test self-checks run in
# the untouched temp tree (#109). Run in place instead — no nested worktree, no cleanup.
# Detection: a linked worktree's git-dir differs from its git-common-dir.
# Escape hatch: CLI_DISPATCH_NO_IN_PLACE=1 forces the legacy nested-worktree behaviour.
$inPlace = $false
$gitDirAbs = (git -C $Repo rev-parse --absolute-git-dir 2>$null)
$gitCommonAbs = (git -C $Repo rev-parse --path-format=absolute --git-common-dir 2>$null)
if (-not $gitCommonAbs) {
  # git < 2.31 has no --path-format; resolve the (possibly relative) path by hand.
  $gcd = (git -C $Repo rev-parse --git-common-dir 2>$null)
  if ($gcd) {
    $gitCommonAbs = if ([System.IO.Path]::IsPathRooted($gcd)) { $gcd } else { Join-Path $Repo $gcd }
  }
}
if ($env:CLI_DISPATCH_NO_IN_PLACE -ne "1" -and $gitDirAbs -and $gitCommonAbs) {
  $gitDirAbs = Resolve-RealPath $gitDirAbs
  $gitCommonAbs = Resolve-RealPath $gitCommonAbs
  if ($gitDirAbs -ne $gitCommonAbs) { $inPlace = $true }
}

$wtNM = $null
if ($inPlace) {
  $WT = $Repo
  # Machine-read by cli-dispatch-run so cleanup keys off the MODE, not just a path compare.
  [Console]::Error.WriteLine(">>> cli-dispatch: in-place=1")
  Write-Host ">>> In-place mode: $Repo is already a linked worktree — running there (no nested worktree, no cleanup)."
  if ($Branch) {
    $headNow = (git -C $WT symbolic-ref --short HEAD 2>$null)
    if (-not $headNow) { $headNow = "detached" }
    Write-Host ">>> Note: --branch `"$Branch`" is ignored in in-place mode; HEAD stays $headNow."
  }
} else {
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
  git -C $Repo worktree add -b $Branch $WT $baseRef 2>$null

  $repoNM = Join-Path $Repo "node_modules"
  $wtNM = Join-Path $WT "node_modules"
  if ((Test-Path $repoNM) -and -not (Test-Path $wtNM)) {
    New-Item -ItemType Junction -Path $wtNM -Target $repoNM | Out-Null
  }
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
  if ($inPlace) {
    $headNow = (git -C $WT symbolic-ref --short HEAD 2>$null)
    if (-not $headNow) { $headNow = "detached" }
    Write-Host ">>> In-place worktree: $WT  (branch: $headNow)"
    Write-Host ">>> This worktree belongs to YOU — the runner created nothing and removed nothing."
  } else {
    Write-Host ">>> Worktree: $WT  (branch: $Branch)"
    Write-Host ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
    Write-Host "    Remove-Item `"$wtNM`" -Force; git -C `"$Repo`" worktree remove `"$WT`" --force; git -C `"$Repo`" worktree prune"
  }
}
if ($workerExitCode -ne 0) { exit $workerExitCode }

git -C $WT status --short
