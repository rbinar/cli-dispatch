#!/usr/bin/env pwsh
# cx-agent.ps1 — Windows/PowerShell variant of cx-agent: call the Codex worker like a subagent
# (ONE command, live progress, final answer). Synchronous wrapper over cx-stream.ps1.
# Default agentic (workspace-write in --cwd); pass --read-only for a REAL codex sandbox
# (-s read-only, no writes). Final answer -> stdout; live tool activity -> stderr.
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

function Show-Usage { [Console]::Error.WriteLine('usage: cx-agent [--cwd <dir>] [--resume <id>] [--read-only] [--sandbox <mode>] [--network] [--no-network] [--model <m>] [--effort low|medium|high] [--max-runtime <s>] [--idle-timeout <s>] [-q] "<task>"') }
function Need-Val($name, $idx, $argc) { if ($idx + 1 -ge $argc) { [Console]::Error.WriteLine("cx-agent: $name requires a value."); exit 1 } }

$quiet = $false
$task = $null
$fwd = @()
$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--read-only$'    { $fwd += '--read-only'; $i += 1; continue }
    '^(--network|--net)$'       { $fwd += '--network'; $i += 1; continue }
    '^(--no-network|--no-net)$' { $fwd += '--no-network'; $i += 1; continue }
    '^--cwd$'          { Need-Val '--cwd' $i $argc; $fwd += @('--cwd', $args[$i+1]); $i += 2; continue }
    '^--resume$'       { Need-Val '--resume' $i $argc; $fwd += @('--resume', $args[$i+1]); $i += 2; continue }
    '^--model$'        { Need-Val '--model' $i $argc; $fwd += @('--model', $args[$i+1]); $i += 2; continue }
    '^--effort$'       { Need-Val '--effort' $i $argc; $fwd += @('--effort', $args[$i+1]); $i += 2; continue }
    '^--sandbox$'      { Need-Val '--sandbox' $i $argc; $fwd += @('--sandbox', $args[$i+1]); $i += 2; continue }
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
if ([string]::IsNullOrWhiteSpace($task)) { [Console]::Error.WriteLine("cx-agent: empty task — nothing to delegate."); exit 1 }

$stream = "cx-stream"
if (-not (Get-Command $stream -ErrorAction SilentlyContinue)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $stream = Join-Path $scriptDir "cx-stream.ps1"
}

if (-not $quiet) {
  [Console]::Error.WriteLine("> cx-agent -> Codex (OpenAI Codex CLI) worker")
  $env:CX_PROGRESS_STDERR = '1'
}

& $stream @fwd -p $task
exit $LASTEXITCODE
