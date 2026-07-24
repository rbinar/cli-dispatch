#!/usr/bin/env pwsh
# cli-dispatch-clean.ps1 — Windows launcher for the stale-worker cleanup engine, AND the
# worktree-artifact sweep (leftover *-wt-* dirs under $env:TEMP that a crashed/killed runner
# never cleaned up — see CLAUDE.md "deterministic runner + escalation path": real repo changes are isolated
# in a worktree, and a runner that dies before its own cleanup leaves that worktree behind
# forever). Session cleanup is delegated to cli-dispatch-clean.mjs (installed share dir →
# legacy claude-ds → next to this script); the worktree sweep runs directly in this launcher
# (pure PowerShell — no node dependency). Default DRY-RUN; pass --remove to delete. Used by
# hand and by the scheduled auto-clean (Scheduled Task).
#   cli-dispatch-clean.ps1 [--remove] [--stale-secs N] [--older-than DAYS] [--quiet]
#                           [--worktree-days N] [--skip-worktrees]
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

# ---- worktree artifact sweep -------------------------------------------------------------
# Parse just the flags this launcher owns (--worktree-days, --skip-worktrees); everything
# else (including --remove and --quiet, which the worktree sweep also honors) is forwarded to
# the engine unmodified via $engineArgs, same pass-through contract as before (@args).
$remove = $false
$quiet = $false
$wtDays = 3
$skipWorktrees = $false
$engineArgs = @()
$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    "--remove" { $remove = $true; $engineArgs += $args[$i]; $i++ }
    "--quiet" { $quiet = $true; $engineArgs += $args[$i]; $i++ }
    "--worktree-days" { if ($i + 1 -lt $args.Count) { $wtDays = [int]$args[$i + 1] }; $i += 2 }
    "--skip-worktrees" { $skipWorktrees = $true; $i++ }
    default { $engineArgs += $args[$i]; $i++ }
  }
}
if ($wtDays -le 0) { $wtDays = 3 }

function Write-WtLog($msg) { if (-not $quiet) { Write-Host $msg } }

if (-not $skipWorktrees) {
  # Defensive git resolution — same rationale as the node probe above: a Scheduled Task's
  # PATH is minimal, so even an interactively-working git can be invisible here.
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCmd) {
    $gitCandidates = @(
      (Join-Path $env:ProgramFiles "Git\bin\git.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Git\bin\git.exe"),
      (Join-Path $env:LOCALAPPDATA "Programs\Git\bin\git.exe")
    )
    foreach ($cand in $gitCandidates) {
      if ($cand -and (Test-Path $cand)) { $gitCmd = $cand; break }
    }
  }
  $gitBin = if ($gitCmd -is [System.Management.Automation.CommandInfo]) { $gitCmd.Source } else { $gitCmd }

  # Only $env:TEMP is swept on Windows — there is no Unix-style shared /tmp to also check.
  $tmpRoot = $env:TEMP
  Write-WtLog "worktree artifact sweep (pattern *-wt-*, older than ${wtDays}d):"
  $wtFound = 0; $wtDirty = 0; $wtRemoved = 0; $wtSkipped = 0
  $prunedRepos = @()

  if ($tmpRoot -and (Test-Path $tmpRoot)) {
    $cutoff = (Get-Date).AddDays(-$wtDays)
    $candidates = Get-ChildItem -Path $tmpRoot -Directory -Filter "*-wt-*" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff }
    foreach ($wt in $candidates) {
      $wtFound++
      if (-not $gitBin) {
        Write-WtLog "  SKIP (git unavailable) $($wt.FullName)"
        $wtSkipped++
        continue
      }
      $statusOut = & $gitBin -C $wt.FullName status --porcelain 2>$null
      if ($LASTEXITCODE -ne 0) {
        Write-WtLog "  SKIP (git status failed - not a valid worktree?) $($wt.FullName)"
        $wtSkipped++
        continue
      }
      if ($statusOut) {
        Write-WtLog "  DIRTY (skipped, uncommitted changes) $($wt.FullName)"
        $wtDirty++
        continue
      }
      Write-WtLog "  worktree stale (clean, idle > ${wtDays}d): $($wt.FullName)"
      if ($remove) {
        # Resolve the source repo from the worktree's ".git" file BEFORE removing it, so
        # `git worktree prune` can run against it afterward — best-effort only.
        $srcRepo = $null
        $gitFile = Join-Path $wt.FullName ".git"
        if (Test-Path $gitFile -PathType Leaf) {
          try {
            $gitdirLine = (Get-Content -Raw $gitFile) -split "`r?`n" | Where-Object { $_ -match '^gitdir:\s*(.+)$' } | Select-Object -First 1
            if ($gitdirLine -match '^gitdir:\s*(.+)$') {
              $gitdirPath = $Matches[1].Trim()
              $marker = [regex]::Escape("$([System.IO.Path]::DirectorySeparatorChar).git$([System.IO.Path]::DirectorySeparatorChar)worktrees$([System.IO.Path]::DirectorySeparatorChar)")
              if ($gitdirPath -match "(.+?)$marker") { $srcRepo = $Matches[1] }
              elseif ($gitdirPath -match "(.+?)/\.git/worktrees/") { $srcRepo = $Matches[1] }
            }
          } catch {}
        }
        Remove-Item -Recurse -Force $wt.FullName
        $wtRemoved++
        if ($srcRepo -and (Test-Path $srcRepo) -and ($prunedRepos -notcontains $srcRepo)) {
          try { & $gitBin -C $srcRepo worktree prune 2>$null | Out-Null } catch {}
          $prunedRepos += $srcRepo
        }
      }
    }
  }

  $wtEligible = $wtFound - $wtDirty - $wtSkipped
  if ($wtFound -eq 0) {
    Write-WtLog "  none found."
  } elseif ($remove) {
    Write-WtLog "  removed $wtRemoved worktree(s), skipped $wtDirty dirty, $wtSkipped unreadable."
  } else {
    Write-WtLog "  DRY-RUN - $wtEligible of $wtFound candidate(s) would be deleted ($wtDirty dirty, $wtSkipped unreadable - both kept). Re-run with --remove to delete."
  }
}

& node $engine @engineArgs
exit $LASTEXITCODE
