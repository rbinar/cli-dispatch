#!/usr/bin/env pwsh
# ds-agent — call claude-ds (DeepSeek) like a subagent: ONE command, live progress, final answer.
# Synchronous wrapper over claude-ds-stream. Default agentic (may write/run in --cwd);
# pass --read-only for analysis-only. Final answer -> stdout; live tool activity -> stderr.
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

function Show-Usage { [Console]::Error.WriteLine('usage: ds-agent [--read-only] [--cwd <dir>] [--resume <id>] [--max-runtime <s>] [--idle-timeout <s>] [-q] "<task>"') }
function Need-Val($name, $idx, $argc) { if ($idx + 1 -ge $argc) { [Console]::Error.WriteLine("ds-agent: $name requires a value."); exit 1 } }

$quiet = $false
$agentic = $true
$task = $null
$fwd = @()
$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--read-only$'    { $agentic = $false; $fwd += '--read-only'; $i += 1; continue }
    '^--cwd$'          { Need-Val '--cwd' $i $argc; $workdir = $args[$i+1]; $fwd += @('--cwd', $args[$i+1]); $i += 2; continue }
    '^--resume$'       { Need-Val '--resume' $i $argc; $fwd += @('--resume', $args[$i+1]); $i += 2; continue }
    '^--max-runtime$'  { Need-Val '--max-runtime' $i $argc; $fwd += @('--max-runtime', $args[$i+1]); $i += 2; continue }
    '^--idle-timeout$' { Need-Val '--idle-timeout' $i $argc; $fwd += @('--idle-timeout', $args[$i+1]); $i += 2; continue }
    '^(-q|--quiet)$'   { $quiet = $true; $i += 1; continue }
    '^(-p|--prompt)$'  { Need-Val $a $i $argc; $task = $args[$i+1]; $i += 2; continue }
    '^(-h|--help)$'    { Show-Usage; exit 0 }
    '^-'               { $fwd += $a; $i += 1; continue }
    default            { $task = $a; $i += 1; continue }
  }
}

if ($null -eq $task) {
  if ([Console]::IsInputRedirected) { $task = [Console]::In.ReadToEnd() } else { Show-Usage; exit 1 }
}
if ($agentic) { $fwd += '--dangerously-skip-permissions' }

# Pre-flight git snapshot (issue #94): an agentic worker pointed at a DIRTY git checkout
# has destroyed uncommitted work before (git restore/clean). Capture EVERYTHING (tracked
# + untracked) as a dangling commit — zero working-tree impact — and print the recovery
# SHA. Skipped when clean, not a repo, or git is unavailable; never blocks the run.
if ($agentic) {
  $wd = if ($workdir) { $workdir } else { (Get-Location).Path }
  $gitOk = (Get-Command git -ErrorAction SilentlyContinue) -and ((git -C $wd rev-parse --git-dir 2>$null); $LASTEXITCODE -eq 0)
  if ($gitOk -and (git -C $wd status --porcelain 2>$null | Select-Object -First 1)) {
    $snapIdx = [System.IO.Path]::GetTempFileName(); Remove-Item $snapIdx -ErrorAction SilentlyContinue
    $snapSha = $null
    try {
      Push-Location $wd
      $env:GIT_INDEX_FILE = $snapIdx
      git read-tree HEAD 2>$null
      git add -A 2>$null
      $tree = (git write-tree 2>$null)
      Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
      if ($tree) { $snapSha = (git commit-tree $tree -p HEAD -m "ds-agent preflight snapshot $(Get-Date -Format o)" 2>$null) }
    } finally {
      Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
      Pop-Location
      Remove-Item $snapIdx -ErrorAction SilentlyContinue
    }
    if ($snapSha) {
      [Console]::Error.WriteLine("! preflight snapshot of dirty checkout: $snapSha")
      [Console]::Error.WriteLine("  recover any lost file: git -C '$wd' restore --source=$snapSha -- <path>")
    }
  }
}

if (-not $quiet) {
  $mode = if ($agentic) { 'agentic: may modify cwd' } else { 'read-only' }
  [Console]::Error.WriteLine("> ds-agent -> claude-ds (DeepSeek) [$mode]")
  $env:CLAUDE_DS_PROGRESS_STDERR = '1'
}

& claude-ds-stream @fwd -p $task
exit $LASTEXITCODE
