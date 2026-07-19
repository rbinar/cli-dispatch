#!/usr/bin/env pwsh
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

# Resolve a path the way bash's `cd … && pwd -P` does. Note that `(Get-Item …).FullName`
# alone returns the LINK's own path, not its target — it only expands 8.3 short names and
# normalizes; a repo reached through a junction/symlink would still compare unequal. Chase
# the link target first (ResolveLinkTarget on PS7, .Target on 5.1) and fall back in steps.
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

# --- in-place mode (issues #108 / #109) ----------------------------------------------
# If $Repo is ALREADY a linked worktree, the caller opened it for this job on purpose.
# Nesting a second worktree there puts the worker's cwd in a temp dir while the brief's
# absolute paths point at $Repo: writes land in $Repo, the leak post-check calls that a
# leak and exits 1 on a good run (#108), and the worker's own lint/test self-checks run in
# the untouched temp tree (#109). Run in place instead — no nested worktree, no cleanup.
# Detection: a linked worktree's git-dir differs from its git-common-dir.
# Escape hatch: CLI_DISPATCH_NO_IN_PLACE=1 forces the legacy nested-worktree behaviour.
$inPlace = $false
$guardRepo = $Repo
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
  if ($gitDirAbs -ne $gitCommonAbs) {
    $inPlace = $true
    # Leak-guard the MAIN checkout instead of $Repo — writes into $Repo are the point now.
    # `worktree list --porcelain` lists the main worktree first; Split-Path on the
    # git-common-dir is wrong for --separate-git-dir layouts and worktrees of a bare repo.
    $mainCheckout = $null
    $wtList = @(git -C $Repo worktree list --porcelain 2>$null)
    if ($wtList.Count -gt 0 -and $wtList[0] -match '^worktree\s+(.+?)\s*$') { $mainCheckout = $Matches[1] }
    $guardRepo = $null
    if ($mainCheckout) {
      $mainIsWorkTree = (git -C $mainCheckout rev-parse --is-inside-work-tree 2>$null)
      if ("$mainIsWorkTree".Trim() -eq "true") { $guardRepo = $mainCheckout }
    }
  }
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
  git -C $Repo worktree add -b $Branch $WT $baseRef 2>$null

  $repoNM = Join-Path $Repo "node_modules"
  $wtNM = Join-Path $WT "node_modules"
  if ((Test-Path $repoNM) -and -not (Test-Path $wtNM)) {
    New-Item -ItemType Junction -Path $wtNM -Target $repoNM | Out-Null
  }
}

# Snapshot the guarded repo's dirt BEFORE the worker runs: the post-check must fail only on
# NEW entries, or any pre-existing untracked file fails every good run (seen in production).
$preStatus = @()
if ($guardRepo) { $preStatus = @(git -C $guardRepo status --short 2>$null) }

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

# Post-run: verify the guarded repo gained no NEW dirt from the worker (issue #68).
# The worker should only write inside $WT; new entries in $guardRepo's status mean it
# resolved an absolute path back out of the tree it was given. In in-place mode $guardRepo
# is the MAIN checkout, never the target worktree the caller asked us to write to (#108).
# Compared against the pre-run snapshot so pre-existing dirt never fails a good run.
if (-not $guardRepo) {
  Write-Host ">>> post-check skipped: no main checkout to guard"
  exit 0
}
$postStatus = @(git -C $guardRepo status --short 2>$null)
$newDirt = @($postStatus | Where-Object { $_ -and ($preStatus -notcontains $_) })
if ($newDirt.Count -eq 0) {
  Write-Host ">>> post-check OK: no new changes in $guardRepo"
  exit 0
}
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
# Written to the temp dir, never next to the guarded repo — that parent is a directory the
# runner does not own (in in-place mode often the user's whole repos folder or $HOME).
$patchFile = Join-Path ([System.IO.Path]::GetTempPath()) "cli-dispatch-leaked-changes-$ts.patch"
git -C $guardRepo diff | Out-File -FilePath $patchFile -Encoding utf8
# Note: git diff does not cover untracked files; the status entries above do list them.
Write-Host ">>> post-check FAIL: worker leaked NEW changes outside the worktree into $guardRepo"
Write-Host ">>> patch saved: $patchFile"
Write-Host ($newDirt -join "`n")
exit 1
