#!/usr/bin/env pwsh
# cli-dispatch-run.ps1 — Windows port of cli-dispatch-run.
# Supports ds and cx backends only.
param()

$ErrorActionPreference = 'Stop'

function Show-Usage {
  Write-Host 'usage: cli-dispatch-run --backend <ds|ag|cx|oc|cp> --cwd <repo> [--prompt <text> | --prompt-file <path>] [--branch <name>] [--model <slug>] [--effort low|medium|high] [--verify <cmd>] [--verify-timeout SECS] [--timeout SECS] [--resume <session-id>] [--cleanup-if-clean]'
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
# --resume re-attaches to an existing session and carries no prompt, so it is exempt from
# the prompt requirement (mirrors the bash twin's `[ -z "$RESUME" ] && [ -z "$PROMPT..." ]`).
# Without this exemption there was NO way to reach the resume path: promptless resume died
# here and prompted resume died at the later "--resume cannot take a prompt" guard.
if ((-not $Resume) -and (-not $Prompt) -and (-not $PromptFile)) {
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
  # SessionDir is passed explicitly rather than read from the enclosing scope: PowerShell's
  # dynamic scoping would make that work by accident, and a bookkeeping write aimed at a
  # scope-leaked path is not a thing to leave to accident.
  param([string]$Worktree, [int]$VerdictExitCode, [string]$SessionDir)

  if (-not $Worktree) {
    Write-Host 'cli-dispatch-run: no worktree path found; kept path unknown'
    return
  }

  if (-not $CleanupIfClean) {
    Write-Host "cli-dispatch-run: --cleanup-if-clean not set; kept worktree at $Worktree"
    return
  }

  # NEVER touch the directory the caller handed us via --cwd (issue #108). In in-place
  # mode the session's cwd IS that directory, so an unguarded `worktree remove --force`
  # here would delete work the caller owns. The runner only ever cleans up worktrees it
  # created itself. Two independent belts: the runner's own `in-place=1` marker (the mode
  # it actually took), and a resolved-path comparison (catches --resume, where the marker
  # from the original launch is no longer on this run's output).
  if ($script:InPlaceRun) {
    Write-Host "cli-dispatch-run: worker ran in-place in the caller's worktree; leaving it untouched: $Worktree"
    return
  }
  if ($Cwd) {
    # This is the belt that has to hold whenever the marker belt cannot (e.g. --resume).
    # Ask GIT to canonicalize: `rev-parse --show-toplevel` returns the same form for both
    # sides regardless of how the caller spelled the path. .NET is not enough here —
    # GetFullPath only normalizes the string (`C:\Users\RUNNE~1\…` compares unequal) and
    # ResolveLinkTarget/`.Target` only chase the LAST component, so a symlinked *parent*
    # (`/var` → `/private/var`, a junctioned drive root) still compares unequal. Verified
    # against a real repo: the .NET-only form mismatched, the git form matched.
    $resolve = {
      param($p)
      try {
        $top = git -C $p rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $top) { return "$top".Trim() }
      } catch { }
      try {
        $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
        try {
          $t = [System.IO.Directory]::ResolveLinkTarget($item.FullName, $true)
          if ($t) { return $t.FullName }
        } catch { }
        if ($item.Target) { return (Get-Item -LiteralPath $item.Target -Force).FullName }
        return $item.FullName
      } catch { try { [System.IO.Path]::GetFullPath($p) } catch { $p } }
    }
    if ((& $resolve $Worktree) -eq (& $resolve $Cwd)) {
      Write-Host "cli-dispatch-run: worktree is the caller-provided --cwd; leaving it untouched: $Worktree"
      return
    }
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
    Set-WorktreeRemovedInVerdict -SessionDir $SessionDir
  }
}

function ConvertTo-BashSingleQuoted {
  # Wrap a value for `bash -lc` so bash sees it as ONE literal argument, whatever it contains.
  # Single quotes protect everything except a single quote itself, which is escaped the only way
  # sh allows: close the string, emit an escaped quote, reopen it ('\'').
  # An empty value must still produce '' — an omitted argument would shift every later one.
  param([string]$Value)
  "'" + ("$Value" -replace "'", "'\''") + "'"
}

function Set-WorktreeRemovedInVerdict {
  param([string]$SessionDir)

  # Issue #128: verdict.json is written BEFORE this cleanup runs (it is the escalation artifact
  # and must exist even if cleanup dies), so `worktreeRemoved` can only be recorded here, after
  # the removal actually happened. Called from the ONE branch that proved the directory is gone.
  #
  # Never fatal, mirroring the bash twin: the run is over, the verify verdict is on disk and the
  # worktree really is gone. A failed bookkeeping write must not change the run's exit code.
  if (-not $SessionDir) { return }
  $verdictPath = Join-Path $SessionDir 'verdict.json'
  if (-not (Test-Path $verdictPath)) { return }
  try {
    & $NodeBin $VerdictWriter mark-worktree-removed $verdictPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'cli-dispatch-run: could not record worktreeRemoved in verdict.json'
    }
  } catch {
    Write-Host 'cli-dispatch-run: could not record worktreeRemoved in verdict.json'
  }
}

# All temp files created below (prompt tmp file, worktree-launch stderr/marker,
# verify-results json) are tracked here and removed in the `finally` block so every
# exit path — normal, early `exit N`, thrown error, or Ctrl-C — cleans up. This is the
# PowerShell equivalent of the bash twin's `trap cleanup_tmp EXIT INT TERM` (see
# cli-dispatch-run's TEMP_FILES/cleanup_tmp).
$script:TempFiles = [System.Collections.Generic.List[string]]::new()
$script:InPlaceRun = $false

try {
  # --resume RE-ATTACHES to an existing session; it does NOT send a new prompt. Reject a
  # prompt loudly instead of ignoring it (mirrors the bash twin).
  if ($Resume -and ($Prompt -or $PromptFile)) {
    Write-Host 'cli-dispatch-run: --resume re-attaches to a session and cannot take a prompt — use /cli-dispatch:resume <id> "<follow-up>" to continue the conversation'
    exit 5
  }
  if (-not $Resume) {
    if ($PromptFile -and -not (Test-Path $PromptFile)) {
      Write-Host "cli-dispatch-run: prompt file not found: $PromptFile"
      exit 1
    }
    # Build the brief the worker actually sees: caller text + the standing cwd contract.
    # The caller's own --prompt-file is never modified in place; we always write a copy.
    # CLI_DISPATCH_NO_CWD_CONTRACT=1 opts out. Mirrors the bash twin.
    $tmpPrompt = New-TemporaryFile
    $script:TempFiles.Add($tmpPrompt.FullName)
    $briefText = if ($PromptFile) { Get-Content -Raw $PromptFile } else { $Prompt }
    if ($env:CLI_DISPATCH_NO_CWD_CONTRACT -ne "1") {
      # Workers have reported "ruff: all checks passed" after running the check in the tree
      # they were started in rather than the tree they edited — linting untouched originals
      # (issue #109). Pin every self-check to the working directory explicitly.
      $briefText = $briefText + @'

---
[cli-dispatch] Working-directory contract — applies to every command you run:
- Print your working directory first. That directory is the ONLY tree you may read or edit;
  state it in your report.
- Make that directory the process working directory for EVERY verification command (lint,
  tests, build, type-check) before running it. A check run anywhere else inspects untouched
  copies and produces false "all checks passed" claims.
- Report the exact command AND the directory it ran in for each result you claim.
- Your self-reported results are not the gate: the caller re-runs the verification chain
  independently, and only that run counts.
'@
    }
    if ($env:CLI_DISPATCH_NO_WORKER_REPORT -ne "1") {
      # The evidence record. Machine-readable proof of what the worker actually checked —
      # it does NOT make the proof trusted; the caller still re-runs everything. Mirrors the
      # bash twin.
      $briefText = $briefText + @'

---
[cli-dispatch] Before you finish, write `worker-report.json` in your working directory:

{
  "claims":      [{"claim": "...", "howVerified": "...", "command": "...", "result": "..."}],
  "notDone":     ["..."],
  "assumptions": ["..."]
}

- `claims` — one entry per factual assertion you are making about your own work ("the tests
  pass", "output is unchanged", "the ps1 twin still parses"). `command` is the exact command
  you ran to check it, `result` what it printed. If you did NOT run a command for a claim,
  leave `command` empty — an unchecked claim is still worth recording, but it will be
  counted and treated as unverified. Do not invent a command you did not run.
- `notDone` — anything in the task you did not do, could not do, or deliberately scoped out.
- `assumptions` — anything you had to decide for yourself because the task did not say.

This file is a record, not a gate: the caller re-verifies every claim independently. An
honest empty `command` is more useful than a confident one that was never executed.
'@
    }
    Set-Content -Path $tmpPrompt.FullName -Value $briefText -NoNewline
    $PromptFile = $tmpPrompt.FullName
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
    $script:TempFiles.Add($launchMarker)
    $stderrFile = Join-Path $env:TEMP ([IO.Path]::GetRandomFileName())
    $script:TempFiles.Add($stderrFile)

    Set-TempEnv -Vars $baseVars
    # Every argument is quoted through ConvertTo-BashSingleQuoted, not interpolated between bare
    # quotes (issue #125): a path containing an apostrophe — `C:\Users\O'Brien\repo` is an
    # ordinary Windows path — used to terminate the quoting early, so bash saw the rest of the
    # path as shell syntax. That is a broken run at best and an injection at worst.
    $bashCmd = @($runner, $Cwd, $Branch, $PromptFile | ForEach-Object { ConvertTo-BashSingleQuoted $_ }) -join ' '
    & bash -lc $bashCmd 2> $stderrFile | Out-Null
    $runRc = $LASTEXITCODE
    Clear-TempEnv -Vars $baseVars

    # The runner prints `>>> cli-dispatch: in-place=1` when it decided to run the worker in
    # the caller's own worktree. Cleanup keys off this MODE, not just a path comparison.
    # No `^` anchor: Windows PowerShell 5.1 wraps redirected native stderr in
    # NativeCommandError records with leading indentation, so a line-start anchor can miss.
    if (Select-String -Path $stderrFile -Pattern 'cli-dispatch: in-place=1' -SimpleMatch -Quiet) {
      $script:InPlaceRun = $true
    }

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
    $script:TempFiles.Add($verifyResultsPath)
    $verifyResult | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path $verifyResultsPath -NoNewline
  }

  if ($verifyResultsPath) {
    $verdictOut = & $NodeBin $VerdictWriter build-verdict $SessionDir $StatusPath $MetaPath $ChangedPath $timeoutExpired $verifyResultsPath
    $verdictExit = $LASTEXITCODE
  } else {
    $verdictOut = & $NodeBin $VerdictWriter build-verdict $SessionDir $StatusPath $MetaPath $ChangedPath $timeoutExpired
    $verdictExit = $LASTEXITCODE
  }
  # build-verdict produced no output → verdict could not be built. This is a setup error
  # regardless of what exit status the helper reported (it may exit 0 having printed nothing,
  # e.g. when its own guard silently no-ops). The error shape's exitCode here is the contract
  # value (5 = setup error), not a node exit status — unlike the normal path below where
  # $verdictExit carries the worker's result. Still write valid JSON so downstream JSON.parse
  # consumers don't crash. (Mirrors the bash twin.)
  if ([string]::IsNullOrWhiteSpace($verdictOut)) {
    $verdictOut = "{`"schemaVersion`":1,`"error`":`"build-verdict failed (exit $verdictExit) — see stderr`",`"sessionId`":`"$SessionId`",`"exitCode`":5}"
    Set-Content -Path (Join-Path $SessionDir 'verdict.json') -Value $verdictOut
    Write-Host "cli-dispatch-run: verdict could not be built — reporting exit code 5"
    Invoke-CleanupWorktree -Worktree $WorktreePath -VerdictExitCode 5 -SessionDir $SessionDir
    exit 5
  }
  Set-Content -Path (Join-Path $SessionDir 'verdict.json') -Value $verdictOut

  # Read the artifact we just wrote. A missing, malformed, or error-shaped verdict stays silent;
  # like the other closing notes, this advisory is informational and never changes the exit code.
  try {
    $verdictForNotes = Get-Content -Raw -Path (Join-Path $SessionDir 'verdict.json') -ErrorAction Stop | ConvertFrom-Json
    if ($verdictForNotes.trivial -eq $true) {
      Write-Host 'cli-dispatch-run: trivial diff (<50 lines) — consider doing work this size inline or batching it'
    }
  } catch {}

  Invoke-CleanupWorktree -Worktree $WorktreePath -VerdictExitCode $verdictExit -SessionDir $SessionDir

  exit $verdictExit
} finally {
  foreach ($tmp in $script:TempFiles) {
    if ($tmp -and (Test-Path $tmp)) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
  }
}
