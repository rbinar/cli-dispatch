#!/usr/bin/env pwsh
# ds-agent — call claude-ds (DeepSeek) like a subagent: it blocks until the worker is done,
# shows tool activity live on stderr, and prints the final answer on stdout.
# Default is agentic (the worker can write files / run bash in --cwd). Pass --read-only for
# a no-writes run.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Version staleness check (shared module — see version-check.ps1)
$__versionCheckPs1 = Join-Path $ScriptDir 'version-check.ps1'
if (Test-Path $__versionCheckPs1) {
  try { . $__versionCheckPs1 } catch {}
}

function Show-Usage { [Console]::Error.WriteLine('usage: ds-agent [--read-only] [--cwd <dir>] [--resume <id>] [--effort low|medium|high] [--max-runtime <s>] [--idle-timeout <s>] [-q] "<task>"') }
function Need-Val($name, $idx, $argc) { if ($idx + 1 -ge $argc) { [Console]::Error.WriteLine("ds-agent: $name requires a value."); exit 1 } }

$quiet = $false
$agentic = $true
$task = $null
$haveTask = $false
$workdir = $null
$fwd = @()

Show-VersionWarning

$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $arg = $args[$i]
  switch -Regex ($arg) {
    '^--read-only$' { $agentic = $false; $fwd += '--read-only'; $i += 1; continue }
    '^--cwd$' { Need-Val '--cwd' $i $argc; $workdir = $args[$i + 1]; $fwd += @('--cwd', $args[$i + 1]); $i += 2; continue }
    '^--resume$' { Need-Val '--resume' $i $argc; $fwd += @('--resume', $args[$i + 1]); $i += 2; continue }
    '^--effort$' { Need-Val '--effort' $i $argc; $fwd += @('--effort', $args[$i + 1]); $i += 2; continue }
    '^--max-runtime$' { Need-Val '--max-runtime' $i $argc; $fwd += @('--max-runtime', $args[$i + 1]); $i += 2; continue }
    '^--idle-timeout$' { Need-Val '--idle-timeout' $i $argc; $fwd += @('--idle-timeout', $args[$i + 1]); $i += 2; continue }
    '^-q$|^--quiet$' { $quiet = $true; $i += 1; continue }
    '^--help$|^-h$' { Show-Usage; exit 0 }
    '^-p$|^--prompt$' { Need-Val $arg $i $argc; $task = $args[$i + 1]; $haveTask = $true; $i += 2; continue }
    '^-' { $fwd += $arg; $i += 1; continue }
    default { $task = $arg; $haveTask = $true; $i += 1; continue }
  }
}

if (-not $haveTask) {
  if ([Console]::IsInputRedirected) { $task = [Console]::In.ReadToEnd() } else { Show-Usage; exit 1 }
}
if ($agentic) { $fwd += '--dangerously-skip-permissions' }

# Pre-flight git snapshot (issue #94): an agentic worker pointed at a DIRTY git checkout
# has destroyed uncommitted work before. Capture EVERYTHING as a dangling commit and print
# the recovery SHA. Skipped when clean, not a repo, or git is unavailable.
if ($agentic) {
  $wd = if ($workdir) { $workdir } else { (Get-Location).Path }
  $gitOk = $false
  if (Get-Command git -ErrorAction SilentlyContinue) {
    git -C $wd rev-parse --git-dir 2>$null | Out-Null
    $gitOk = ($LASTEXITCODE -eq 0)
  }
  if ($gitOk) {
    if (git -C $wd status --porcelain 2>$null | Select-Object -First 1) {
      $snapIdx = [System.IO.Path]::GetTempFileName()
      Remove-Item $snapIdx -ErrorAction SilentlyContinue
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
        [Console]::Error.WriteLine("⚑ preflight snapshot of dirty checkout: $snapSha")
        [Console]::Error.WriteLine("  recover any lost file: git -C '$wd' restore --source=$snapSha -- <path>")
      }
    }
  }
}

$stream = (Get-Command claude-ds-stream -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrWhiteSpace($stream)) {
  $stream = Join-Path $ScriptDir "claude-ds-stream.ps1"
}
if (-not (Test-Path $stream)) {
  [Console]::Error.WriteLine("ds-agent: claude-ds-stream not found (run /cli-dispatch:setup).")
  exit 1
}

if (-not $quiet) {
  $mode = if ($agentic) { 'agentic: may modify cwd' } else { 'read-only' }
  [Console]::Error.WriteLine("> ds-agent -> claude-ds (DeepSeek) [$mode]")
  $env:CLAUDE_DS_PROGRESS_STDERR = '1'
}

& $stream @fwd -p $task
exit $LASTEXITCODE
