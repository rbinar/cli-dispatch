#!/usr/bin/env pwsh
# cli-dispatch-run.ps1 — Windows port of cli-dispatch-run.
# Supports ds and cx backends only.
param()

$ErrorActionPreference = 'Stop'

function Show-Usage {
  Write-Host 'usage: cli-dispatch-run --backend <ds|ag|cx|oc|cp> --cwd <repo> [--prompt <text> | --prompt-file <path>] [--branch <name>] [--base-ref <ref>] [--model <slug>] [--effort low|medium|high] [--verify <cmd>] [--verify-timeout SECS] [--timeout SECS] [--resume <session-id>] [--cleanup-if-clean]'
}

function Need-Value {
  param([string]$Name, [int]$Index, [int]$Count)
  if ($Index + 1 -ge $Count) {
    Write-Host "cli-dispatch-run: $Name requires a value."
    Show-Usage
    exit 5
  }
}

$Backend = ''
$Cwd = ''
$Prompt = ''
$PromptFile = ''
$Branch = ''
$BaseRef = ''
$Model = ''
$Effort = ''
$Verify = @()
$VerifyTimeout = 600
$Timeout = 0
$Resume = ''
$CleanupIfClean = $false

$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '--backend' { Need-Value '--backend' $i $args.Count; $Backend = $args[$i + 1]; $i += 2 }
    '--cwd' { Need-Value '--cwd' $i $args.Count; $Cwd = $args[$i + 1]; $i += 2 }
    '--prompt' { Need-Value '--prompt' $i $args.Count; $Prompt = $args[$i + 1]; $i += 2 }
    '--prompt-file' { Need-Value '--prompt-file' $i $args.Count; $PromptFile = $args[$i + 1]; $i += 2 }
    '--branch' { Need-Value '--branch' $i $args.Count; $Branch = $args[$i + 1]; $i += 2 }
    '--base-ref' { Need-Value '--base-ref' $i $args.Count; $BaseRef = $args[$i + 1]; $i += 2 }
    '--model' { Need-Value '--model' $i $args.Count; $Model = $args[$i + 1]; $i += 2 }
    '--effort' { Need-Value '--effort' $i $args.Count; $Effort = $args[$i + 1]; $i += 2 }
    '--verify' { Need-Value '--verify' $i $args.Count; $Verify += $args[$i + 1]; $i += 2 }
    '--verify-timeout' { Need-Value '--verify-timeout' $i $args.Count; $VerifyTimeout = [int]$args[$i + 1]; $i += 2 }
    '--timeout' { Need-Value '--timeout' $i $args.Count; $Timeout = [int]$args[$i + 1]; $i += 2 }
    '--resume' { Need-Value '--resume' $i $args.Count; $Resume = $args[$i + 1]; $i += 2 }
    '--cleanup-if-clean' { $CleanupIfClean = $true; $i += 1 }
    '--help' { Show-Usage; exit 0 }
    '-h' { Show-Usage; exit 0 }
    default {
      Write-Host "cli-dispatch-run: unknown arg: $($args[$i])"
      Show-Usage
      exit 5
    }
  }
}

if (-not $Backend -or -not $Cwd) {
  Show-Usage
  exit 5
}
if ((-not $Prompt) -and (-not $PromptFile)) {
  Write-Host 'cli-dispatch-run: --prompt or --prompt-file is required'
  Show-Usage
  exit 5
}
if ($Prompt -and $PromptFile) {
  Write-Host 'cli-dispatch-run: use only one of --prompt and --prompt-file'
  Show-Usage
  exit 5
}

switch ($Backend) {
  'ds' { }
  'cx' { }
  'ag' { Write-Host "cli-dispatch-run: Unix-only backend '$Backend' requested"; exit 5 }
  'oc' { Write-Host "cli-dispatch-run: Unix-only backend '$Backend' requested"; exit 5 }
  'cp' { Write-Host "cli-dispatch-run: Unix-only backend '$Backend' requested"; exit 5 }
  default {
    Write-Host "cli-dispatch-run: unknown backend '$Backend'"
    exit 5
  }
}

switch ($Effort) {
  '' {}
  'low' {}
  'medium' {}
  'high' {}
  default {
    Write-Host 'cli-dispatch-run: --effort must be low|medium|high'
    Show-Usage
    exit 5
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$SessionsRoot = if ($env:CLI_DISPATCH_SESSIONS_DIR) { $env:CLI_DISPATCH_SESSIONS_DIR }
elseif ($env:CLAUDE_DS_SESSIONS_DIR) { $env:CLAUDE_DS_SESSIONS_DIR }
else {
  $cacheRoot = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME '.cache' }
  $newRoot = Join-Path $cacheRoot 'cli-dispatch/sessions'
  $oldRoot = Join-Path $cacheRoot 'claude-ds/sessions'
  if ((Test-Path $newRoot) -or (-not (Test-Path $oldRoot))) { $newRoot } else { $oldRoot }
}

$NodeBin = if ($env:CLI_DISPATCH_NODE) { $env:CLI_DISPATCH_NODE } else { Join-Path $HOME '.local/share/cli-dispatch/node' }
if (-not (Test-Path $NodeBin)) { $NodeBin = 'node' }
if (-not (Get-Command $NodeBin -ErrorAction SilentlyContinue)) {
  Write-Host "cli-dispatch-run: node not found in PATH"
  exit 1
}

$VerdictWriter = if ($env:CLI_DISPATCH_VERDICT_WRITER) { $env:CLI_DISPATCH_VERDICT_WRITER } else { '' }
if (-not $VerdictWriter) {
  $candidates = @(
    (Join-Path $HOME '.local/share/cli-dispatch/verdict-writer.mjs'),
    (Join-Path $HOME '.local/share/claude-ds/verdict-writer.mjs'),
    (Join-Path $ScriptDir 'verdict-writer.mjs')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { $VerdictWriter = $candidate; break }
  }
}
if (-not (Test-Path $VerdictWriter)) {
  Write-Host 'cli-dispatch-run: verdict-writer.mjs not found'
  exit 1
}

function Read-JsonField {
  param([string]$Path, [string]$Key)
  try {
    $json = Get-Content -Raw -Path $Path -ErrorAction Stop | ConvertFrom-Json
    if ($null -ne $json.$Key) { return [string]$json.$Key }
  } catch {}
  return ''
}

function Tail-Lines {
  param([string]$Text, [int]$Count)
  if ($null -eq $Text) { return '' }
  $lines = $Text -split "`r?`n"
  $skip = [Math]::Max(0, $lines.Length - $Count)
  return ($lines[$skip..($lines.Length - 1)] -join "`n")
}

function Invoke-Verify {
  param([string[]]$Commands, [string]$Worktree, [int]$TimeoutMs, [int]$TailLines = 40)
  $result = @{ commands = $Commands; exitCode = 0; failedAt = $null; tail = '' }

  for ($i = 0; $i -lt $Commands.Length; $i += 1) {
    $command = $Commands[$i]
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/c `"$command`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    if ($Worktree) { $psi.WorkingDirectory = $Worktree }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $finished = $proc.WaitForExit($TimeoutMs)
    $output = "$(($proc.StandardOutput.ReadToEnd()) + ($proc.StandardError.ReadToEnd()))"

    if (-not $finished) {
      $result.exitCode = 124
      $result.failedAt = $i
      $result.tail = Tail-Lines -Text $output -Count $TailLines
      try { $proc.Kill() } catch {}
      break
    }

    if ($proc.ExitCode -ne 0) {
      $result.exitCode = $proc.ExitCode
      $result.failedAt = $i
      $result.tail = Tail-Lines -Text $output -Count $TailLines
      break
    }

    $result.tail = Tail-Lines -Text $output -Count $TailLines
  }

  return $result
}

function Test-WorktreeClean {
  param([string]$Worktree)
  if (-not $Worktree) { return $false }
  if (-not (Test-Path $Worktree)) { return $false }
  try {
    $status = git -C $Worktree status --short
    return [string]::IsNullOrWhiteSpace($status)
  } catch {
    return $false
  }
}

function Invoke-CleanupWorktree {
  param([string]$Worktree, [int]$VerdictExitCode)

  if (-not $Worktree) {
    Write-Host 'cli-dispatch-run: no worktree path found; kept path unknown'
    return
  }

  if (-not $CleanupIfClean) {
    Write-Host "cli-dispatch-run: --cleanup-if-clean not set; kept worktree at $Worktree"
    return
  }

  if ($VerdictExitCode -ne 0) {
    Write-Host "cli-dispatch-run: kept worktree because verdict exit code is $VerdictExitCode (expected 0): $Worktree"
    return
  }

  if (-not (Test-WorktreeClean -Worktree $Worktree)) {
    Write-Host "cli-dispatch-run: kept worktree because it is dirty:"
    try { git -C $Worktree status --short | Write-Host } catch { }
    Write-Host "cli-dispatch-run: kept worktree at $Worktree"
    Write-Host "cli-dispatch-run: manual cleanup: git -C `"$Worktree`" worktree remove `"$Worktree`" --force"
    return
  }

  try {
    git -C $Worktree worktree remove $Worktree --force | Out-Null
  } catch {
    Write-Host "cli-dispatch-run: git worktree remove failed for clean worktree; fallback to rm -rf: $Worktree"
    try { Remove-Item -Recurse -Force -LiteralPath $Worktree } catch { }
  }

  if (Test-Path $Worktree) {
    Write-Host "cli-dispatch-run: clean signals met but worktree still present; kept at $Worktree"
    Write-Host "cli-dispatch-run: manual cleanup: git -C `"$Worktree`" worktree remove `"$Worktree`" --force"
  } else {
    Write-Host "cli-dispatch-run: removed clean worktree at $Worktree"
  }
}

if (-not $PromptFile) {
  $tmpPrompt = New-TemporaryFile
  Set-Content -Path $tmpPrompt.FullName -Value $Prompt -NoNewline
  $PromptFile = $tmpPrompt.FullName
  $tmpFiles = @($tmpPrompt.FullName)
} elseif (-not (Test-Path $PromptFile)) {
  Write-Host "cli-dispatch-run: prompt file not found: $PromptFile"
  exit 1
} else {
  $tmpFiles = @()
}

$baseVars = @{}
if ($Model) {
  if ($Backend -eq 'ds') { $baseVars['DS_MODEL'] = $Model }
  if ($Backend -eq 'cx') { $baseVars['CX_MODEL'] = $Model }
}
if ($Effort) {
  if ($Backend -eq 'ds') { $baseVars['DS_EFFORT'] = $Effort }
  if ($Backend -eq 'cx') { $baseVars['CX_EFFORT'] = $Effort }
}

function Set-TempEnv { param([hashtable]$Vars)
  foreach ($k in $Vars.Keys) { Set-Item -Path ("Env:" + $k) -Value $Vars[$k] }
}
function Clear-TempEnv { param([hashtable]$Vars)
  foreach ($k in $Vars.Keys) { Remove-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue }
}

if ($Resume) {
  $SessionId = $Resume
  $SessionDir = Join-Path $SessionsRoot $SessionId
  if (-not (Test-Path $SessionDir)) {
    Write-Host "cli-dispatch-run: no such session: $SessionId"
    exit 5
  }
} else {
  if (-not $Branch) { $Branch = "$Backend-run-$((Get-Date -UFormat '%s'))-$PID" }

  $runner = Join-Path $ScriptDir "${Backend}-worktree-run.sh"
  if (-not (Test-Path $runner)) {
    Write-Host "cli-dispatch-run: runner not found: $runner"
    exit 5
  }

  if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
    Write-Host 'cli-dispatch-run: bash is required to run worktree runner on Windows.'
    exit 5
  }

  # ds prints "claude-ds session: <id>"; cx prints "  thread:  <id>" (the FINAL,
  # post-relocation session id). Matches the bash twin's marker table.
  $marker = if ($Backend -eq 'ds') { 'claude-ds session:' } else { 'thread:' }
  $launchMarker = Join-Path $env:TEMP ([IO.Path]::GetRandomFileName())
  New-Item -ItemType File -Path $launchMarker -Force | Out-Null
  $stderrFile = Join-Path $env:TEMP ([IO.Path]::GetRandomFileName())

  Set-TempEnv -Vars $baseVars
  & bash -lc "'$runner' '$Cwd' '$Branch' '$PromptFile'" 2> $stderrFile | Out-Null
  $runRc = $LASTEXITCODE
  Clear-TempEnv -Vars $baseVars

  if ($runRc -ne 0) {
    Write-Host (Get-Content -Raw $stderrFile)
    exit $runRc
  }

  $sessionId = $null
  $sessionLine = Select-String -Path $stderrFile -Pattern ([regex]::Escape($marker) + '\s*([A-Za-z0-9._-]+)') -AllMatches | Select-Object -Last 1
  if ($sessionLine -and $sessionLine.Matches.Count -gt 0) {
    $sessionId = $sessionLine.Matches[-1].Groups[1].Value
  }

  if (-not $sessionId) {
    $launchTime = (Get-Item -Path $launchMarker).LastWriteTimeUtc
    $session = Get-ChildItem -Path $SessionsRoot -Directory |
      Where-Object { $_.LastWriteTimeUtc -gt $launchTime } |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    if ($session) { $sessionId = $session.Name }
  }

  Remove-Item -Force $launchMarker, $stderrFile -ErrorAction SilentlyContinue

  if (-not $sessionId) {
    Write-Host 'cli-dispatch-run: failed to discover session id'
    exit 5
  }

  $SessionDir = Join-Path $SessionsRoot $sessionId
  $SessionId = $sessionId
}

$StatusPath = Join-Path $SessionDir 'status.json'
$MetaPath = Join-Path $SessionDir 'meta.json'
$ChangedPath = Join-Path $SessionDir 'changed-files.json'
$State = Read-JsonField -Path $StatusPath -Key 'state'
$WorktreePath = Read-JsonField -Path $MetaPath -Key 'cwd'
if (-not $WorktreePath) { $WorktreePath = $Cwd }

$secsElapsed = 0
while ($true) {
  & (Join-Path $ScriptDir 'cli-dispatch-wait.ps1') $SessionId -Timeout 30 | Out-Null
  $waitRc = $LASTEXITCODE

  $State = Read-JsonField -Path $StatusPath -Key 'state'
  if ($State -eq 'human-controlled') {
    Write-Host 'cli-dispatch-run: human control requested'
    exit 4
  }

  if ($waitRc -eq 0) { break }

  if ($waitRc -eq 2) {
    if ($Timeout -ne 0) {
      $secsElapsed += 30
      if ($secsElapsed -lt $Timeout) { continue }
    } else { continue }
  }

  break
}

$timeoutExpired = 0
if ($Timeout -ne 0 -and $secsElapsed -ge $Timeout -and $State -ne 'done') {
  $timeoutExpired = 1
}

$diffPatchPath = Join-Path $SessionDir 'verdict-diff.patch'
Set-Content -Path $diffPatchPath -Value ''
if ($WorktreePath -and (Test-Path $WorktreePath)) {
  git -C $WorktreePath status --short --untracked-files=all > $diffPatchPath
  git -C $WorktreePath diff HEAD >> $diffPatchPath
}

$verifyResultsPath = ''
if (($Verify.Count -gt 0) -and ($State -ne 'human-controlled')) {
  $verifyResult = Invoke-Verify -Commands $Verify -Worktree $WorktreePath -TimeoutMs ($VerifyTimeout * 1000) -TailLines 40
  $verifyResultsPath = Join-Path $env:TEMP ([IO.Path]::GetRandomFileName())
  $verifyResult | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path $verifyResultsPath -NoNewline
}

if ($verifyResultsPath) {
  $verdictOut = & $NodeBin $VerdictWriter build-verdict $SessionDir $StatusPath $MetaPath $ChangedPath $timeoutExpired $verifyResultsPath
  $verdictExit = $LASTEXITCODE
} else {
  $verdictOut = & $NodeBin $VerdictWriter build-verdict $SessionDir $StatusPath $MetaPath $ChangedPath $timeoutExpired
  $verdictExit = $LASTEXITCODE
}
Set-Content -Path (Join-Path $SessionDir 'verdict.json') -Value $verdictOut

Invoke-CleanupWorktree -Worktree $WorktreePath -VerdictExitCode $verdictExit

foreach ($tmp in $tmpFiles) { if (Test-Path $tmp) { Remove-Item -Force $tmp | Out-Null } }

exit $verdictExit
