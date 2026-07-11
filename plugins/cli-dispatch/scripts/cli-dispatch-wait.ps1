#!/usr/bin/env pwsh
# cli-dispatch-wait.ps1 — blocking wait primitive: polls a worker session's status.json until
# it reaches a terminal state (done/error/killed), then prints a compact summary. Lets *-runner
# babysitter subagents stop hand-rolling poll loops. See github.com/rbinar/cli-dispatch#88.
param(
  [Parameter(Position = 0)][string]$SessionId,
  [int]$Timeout = 0,
  [int]$Poll = 10
)
$ErrorActionPreference = "Stop"

function Show-Usage {
  Write-Host "usage: cli-dispatch-wait.ps1 <session-id> [-Timeout SECS] [-Poll SECS]"
  Write-Host "tip:   /cli-dispatch:sessions  to list session ids"
}

if ([string]::IsNullOrEmpty($SessionId)) {
  Show-Usage
  exit 1
}
if ($SessionId -eq '-h' -or $SessionId -eq '--help' -or $SessionId -eq '-help') {
  Show-Usage
  exit 0
}

# ---- resolve the sessions root (env wins; legacy claude-ds fallback) ----
$sessionsRoot = if ($env:CLI_DISPATCH_SESSIONS_DIR) { $env:CLI_DISPATCH_SESSIONS_DIR } else { $env:CLAUDE_DS_SESSIONS_DIR }
if ([string]::IsNullOrEmpty($sessionsRoot)) {
  $cacheRoot = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
  $newRoot = Join-Path $cacheRoot "cli-dispatch/sessions"; $oldRoot = Join-Path $cacheRoot "claude-ds/sessions"
  $sessionsRoot = if ((Test-Path $newRoot) -or (-not (Test-Path $oldRoot))) { $newRoot } else { $oldRoot }
}

$sessionDir = Join-Path $sessionsRoot $SessionId
if (-not (Test-Path $sessionDir)) {
  Write-Host "no such session: $SessionId (use /cli-dispatch:sessions to list them)"
  exit 1
}

$statusFile = Join-Path $sessionDir "status.json"

# Read the 'state' field from status.json. Tolerates a missing/malformed file — returns
# $null (treated as an unknown, non-terminal state) rather than throwing.
function Get-SessionState {
  try {
    $s = Get-Content -Raw -Path $statusFile -ErrorAction Stop | ConvertFrom-Json
    return $s.state
  } catch {
    return $null
  }
}

# Print the compact final summary: status.json's state/usage/finalResultPreview,
# changed-files.json's diffstat (or "(none)" if absent), and the last ~20 lines of
# progress.log. Every read tolerates a missing/malformed file.
function Write-Summary([string]$State) {
  $usage = $null
  $finalResultPreview = $null
  try {
    $s = Get-Content -Raw -Path $statusFile -ErrorAction Stop | ConvertFrom-Json
    $usage = $s.usage
    $finalResultPreview = $s.finalResultPreview
  } catch {}

  $diffstat = "(none)"
  $changedFilesPath = Join-Path $sessionDir "changed-files.json"
  if (Test-Path $changedFilesPath) {
    try {
      $cf = Get-Content -Raw -Path $changedFilesPath -ErrorAction Stop | ConvertFrom-Json
      if ($cf.diffstat) { $diffstat = $cf.diffstat }
    } catch {}
  }

  Write-Host "state: $State"
  $usageStr = if ($null -eq $usage) { "(none)" } else { $usage | ConvertTo-Json -Compress }
  Write-Host "usage: $usageStr"
  Write-Host "diffstat: $diffstat"
  Write-Host "finalResultPreview: $finalResultPreview"
  Write-Host "progress.log (tail):"
  $progressLog = Join-Path $sessionDir "progress.log"
  if (Test-Path $progressLog) {
    try { Get-Content -Path $progressLog -Tail 20 -ErrorAction Stop | ForEach-Object { Write-Host $_ } } catch {}
  }
}

# ---- core loop: silent polling until a terminal state or timeout ----
$startTime = Get-Date
while ($true) {
  $state = Get-SessionState

  # Empty/null = status.json missing/unreadable (dir removed, relocated, or never
  # finalized) — say so instead of silently reporting it like a normal terminal state.
  if ([string]::IsNullOrEmpty($state)) {
    [Console]::Error.WriteLine("cli-dispatch-wait: cannot read state for $SessionId (status.json missing or unreadable — session dir removed/relocated?)")
  }

  # Terminal = anything other than running/human-controlled (done|error|killed, in practice).
  if ($state -ne 'running' -and $state -ne 'human-controlled') { break }

  if ($Timeout -gt 0) {
    $elapsedSeconds = ((Get-Date) - $startTime).TotalSeconds
    if ($elapsedSeconds -gt $Timeout) {
      Write-Summary $state
      $elapsedInt = [math]::Floor($elapsedSeconds)
      Write-Host "TIMEOUT after ${elapsedInt}s, state still: $state"
      exit 2
    }
  }
  Start-Sleep -Seconds $Poll
}

Write-Summary $state
if ($state -eq 'done') { exit 0 } else { exit 1 }
