#!/usr/bin/env pwsh
# claude-ds-stream.ps1 — the Windows/PowerShell variant of claude-ds-stream.
# Runs claude with the DeepSeek env in stream-json format and pipes stdout into
# ds-stream-parse.mjs. The parser is shared across backends.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-ConfigFile {
  param([string]$Path)
  $cfg = @{}
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) {
    return $cfg
  }
  Get-Content $Path | ForEach-Object {
    # -cmatch (case-sensitive): config keys are uppercase, and a case-insensitive
    # match miscompares the 'I' in DEEPSEEK_API_KEY under tr-TR locale.
    if ($_ -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
      $cfg[$matches[1]] = $matches[2]
    }
  }
  return $cfg
}

function ConvertTo-Int {
  param([string]$Value)
  $n = 0
  if ([int]::TryParse("$Value", [ref]$n)) { return $n }
  return 0
}

function Read-JsonMap {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  try {
    return (Get-Content -Raw $Path | ConvertFrom-Json -AsHashtable -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Get-JsonField {
  param([string]$Path, [string]$Field)
  $obj = Read-JsonMap $Path
  if ($null -eq $obj -or -not $obj.ContainsKey($Field)) { return "" }
  return [string]$obj[$Field]
}

function Write-JsonFile {
  param([string]$Path, [object]$Object, [string]$Label)
  try {
    Set-Content -Path $Path -Value ((ConvertTo-Json $Object -Depth 16) + "`n") -Encoding UTF8
    return $true
  } catch {
    [Console]::Error.WriteLine("reconcile: cannot write ${Label}: $($_.Exception.Message)")
    return $false
  }
}

function Reconcile-SessionError {
  param(
    [string]$Directory,
    [string]$ErrorMessage,
    [int]$ExitCode,
    [string[]]$AllowedStates = @('running', 'done')
  )
  $statusPath = Join-Path $Directory "status.json"
  $metaPath = Join-Path $Directory "meta.json"
  $state = Get-JsonField $statusPath "state"
  if ($AllowedStates.Count -gt 0 -and $state -and ($AllowedStates -notcontains $state)) {
    return
  }

  $status = Read-JsonMap $statusPath
  if ($status -isnot [System.Collections.IDictionary]) { $status = @{} }
  $status["state"] = "error"
  $status["error"] = $ErrorMessage
  Write-JsonFile -Path $statusPath -Object $status -Label "status.json" | Out-Null

  $meta = Read-JsonMap $metaPath
  if ($meta -isnot [System.Collections.IDictionary]) { $meta = @{} }
  $meta["state"] = "error"
  $meta["exitCode"] = $ExitCode
  $meta["error"] = $ErrorMessage
  Write-JsonFile -Path $metaPath -Object $meta -Label "meta.json" | Out-Null
}

function Record-VerifyResult {
  param(
    [string]$Directory,
    [string]$Command,
    [int]$ExitCode,
    [string]$TailText
  )
  $statusPath = Join-Path $Directory "status.json"
  $status = Read-JsonMap $statusPath
  if ($status -isnot [System.Collections.IDictionary]) { $status = @{} }
  $status["verify"] = @{
    cmd  = $Command
    exit = $ExitCode
    tail = $TailText
  }
  Write-JsonFile -Path $statusPath -Object $status -Label "status.json" | Out-Null
}

function Write-DiffArtifacts {
  param([string]$SessionDir, [string]$Cwd)
  $insideWorktree = (git -C "$Cwd" rev-parse --is-inside-work-tree 2>$null)
  if ($insideWorktree -ne "true") { return }
  $statusLines = git -C "$Cwd" status --short --untracked-files=all 2>$null
  if ([string]::IsNullOrWhiteSpace($statusLines)) { return }

  New-Item -ItemType Directory -Force -Path $SessionDir | Out-Null

  git -C "$Cwd" diff HEAD > (Join-Path $SessionDir "diff.patch") 2>$null
  $diffstat = (git -C "$Cwd" diff --stat HEAD | Select-Object -Last 1)

  $changes = @()
  foreach ($line in ($statusLines -split "`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $code = if ($line.Length -ge 2) { $line.Substring(0, 2) } else { $line.Trim() }
    $file = if ($line.Length -gt 3) { $line.Substring(3) } else { "" }
    if ([string]::IsNullOrWhiteSpace($file)) { continue }

    $status = ""
    if ($code -eq "??") {
      $status = "??"
    } else {
      if ($code.Length -ge 1) { $status = $code[0] }
      if ([string]::IsNullOrWhiteSpace($status)) { if ($code.Length -ge 2) { $status = $code[1] } }
      switch ($status) {
        "M" { }
        "A" { }
        "D" { }
        "R" { $status = "A" }
        "C" { $status = "A" }
        default { $status = "" }
      }
    }
    if ([string]::IsNullOrWhiteSpace($status)) { continue }

    if ($status -eq "??" -and (Test-Path (Join-Path $Cwd $file))) {
      git -C "$Cwd" diff --no-index -- /dev/null "$file" >> (Join-Path $SessionDir "diff.patch") 2>$null
    }

    $changes += @{ path = $file; status = $status }
  }

  $payload = @{ files = $changes; diffstat = $diffstat }
  Write-JsonFile -Path (Join-Path $SessionDir "changed-files.json") -Object $payload -Label "changed-files.json" | Out-Null
}

function Find-WorkerPid {
  param([string]$SessionId)
  $process = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($SessionId) -and $_.CommandLine.Contains("stream-json") } |
    Select-Object -First 1
  if ($null -eq $process) { return 0 }
  return [int]$process.ProcessId
}

function Kill-WorkerTree {
  param([int]$Pid)
  if ($Pid -le 0) { return }
  & taskkill /PID $Pid /T /F 2>$null | Out-Null
}

$Config = if ($env:CLI_DISPATCH_CONFIG) {
  $env:CLI_DISPATCH_CONFIG
} elseif ($env:CLAUDE_DS_CONFIG) {
  $env:CLAUDE_DS_CONFIG
} elseif (Test-Path (Join-Path $HOME ".config/cli-dispatch/config")) {
  Join-Path $HOME ".config/cli-dispatch/config"
} else {
  Join-Path $HOME ".config/claude-ds/config"
}

$cfg = Read-ConfigFile -Path $Config
$key = $cfg["DEEPSEEK_API_KEY"]
if ([string]::IsNullOrEmpty($key)) {
  Write-Error "claude-ds-stream: DEEPSEEK_API_KEY not set. Add it to $Config (run /cli-dispatch:setup)."
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "claude-ds-stream: 'node' not found in PATH (required for the stream parser)."
  exit 1
}

# Resolve parser.
$parser = if ($env:CLI_DISPATCH_PARSER) { $env:CLI_DISPATCH_PARSER } else { $env:CLAUDE_DS_PARSER }
if ([string]::IsNullOrWhiteSpace($parser)) {
  foreach ($cand in @(
    (Join-Path $HOME ".local/share/cli-dispatch/ds-stream-parse.mjs"),
    (Join-Path $HOME ".local/share/claude-ds/ds-stream-parse.mjs"),
    (Join-Path $ScriptDir "ds-stream-parse.mjs")
  )) {
    if (Test-Path $cand) { $parser = $cand; break }
  }
}
if ([string]::IsNullOrWhiteSpace($parser) -or -not (Test-Path $parser)) {
  Write-Error "claude-ds-stream: ds-stream-parse.mjs not found (set CLAUDE_DS_PARSER)."
  exit 1
}

# ---- parse arguments ----
$cwd = (Get-Location).Path
$resumeId = ""
$prompt = $null
$readOnly = 0
$effort = if ($env:CLAUDE_DS_EFFORT) { $env:CLAUDE_DS_EFFORT } else { "" }
$maxRuntime = ConvertTo-Int $env:CLAUDE_DS_MAX_RUNTIME
$idleTimeout = ConvertTo-Int $env:CLAUDE_DS_IDLE_TIMEOUT
$verifyCmd = if ($env:CLI_DISPATCH_VERIFY_CMD) { $env:CLI_DISPATCH_VERIFY_CMD } else { "" }
$passArgs = @()

function Need-Val {
  param([string]$Name, [int]$Index, [int]$Count)
  if ($Index + 1 -ge $Count) {
    Write-Error "claude-ds-stream: $Name requires a value."
    exit 1
  }
}

$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--cwd$' {
      Need-Val '--cwd' $i $argc
      $cwd = $args[$i + 1]
      $i += 2
      continue
    }
    '^--cwd=(.*)$' {
      $cwd = $matches[1]
      $i += 1
      continue
    }
    '^--resume$' {
      Need-Val '--resume' $i $argc
      $resumeId = $args[$i + 1]
      $i += 2
      continue
    }
    '^--resume=(.*)$' {
      $resumeId = $matches[1]
      $i += 1
      continue
    }
    '^-p$|^--prompt$' {
      Need-Val $a $i $argc
      $prompt = $args[$i + 1]
      $i += 2
      continue
    }
    '^--prompt=(.*)$' {
      $prompt = $matches[1]
      $i += 1
      continue
    }
    '^--read-only$' {
      $readOnly = 1
      $i += 1
      continue
    }
    '^--effort$' {
      Need-Val '--effort' $i $argc
      $effort = $args[$i + 1]
      $i += 2
      continue
    }
    '^--effort=(.*)$' {
      $effort = $matches[1]
      $i += 1
      continue
    }
    '^--max-runtime$' {
      Need-Val '--max-runtime' $i $argc
      $maxRuntime = ConvertTo-Int $args[$i + 1]
      $i += 2
      continue
    }
    '^--max-runtime=(.*)$' {
      $maxRuntime = ConvertTo-Int $matches[1]
      $i += 1
      continue
    }
    '^--idle-timeout$' {
      Need-Val '--idle-timeout' $i $argc
      $idleTimeout = ConvertTo-Int $args[$i + 1]
      $i += 2
      continue
    }
    '^--idle-timeout=(.*)$' {
      $idleTimeout = ConvertTo-Int $matches[1]
      $i += 1
      continue
    }
    '^--verify-cmd$' {
      Need-Val '--verify-cmd' $i $argc
      $verifyCmd = $args[$i + 1]
      $i += 2
      continue
    }
    '^--verify-cmd=(.*)$' {
      $verifyCmd = $matches[1]
      $i += 1
      continue
    }
    default {
      $passArgs += $a
      $i += 1
      continue
    }
  }
}

if ($null -eq $prompt) {
  if (-not [Console]::IsInputRedirected) {
    Write-Error "claude-ds-stream: no prompt. Use -p ""<prompt>"" or pipe via stdin."
    exit 1
  }
  $prompt = [Console]::In.ReadToEnd()
}

# ---- prepare session dir ----
$sessionsRoot = if ($env:CLI_DISPATCH_SESSIONS_DIR) {
  $env:CLI_DISPATCH_SESSIONS_DIR
} elseif ($env:CLAUDE_DS_SESSIONS_DIR) {
  $env:CLAUDE_DS_SESSIONS_DIR
} else {
  $cache = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
  $newRoot = Join-Path $cache "cli-dispatch/sessions"
  $oldRoot = Join-Path $cache "claude-ds/sessions"
  if ((Test-Path $newRoot) -or (-not (Test-Path $oldRoot))) { $newRoot } else { $oldRoot }
}

$resume = 0
if (-not [string]::IsNullOrWhiteSpace($resumeId)) {
  $sid = $resumeId
  $resume = 1
} else {
  $sid = [guid]::NewGuid().ToString()
}
$sessionDir = Join-Path $sessionsRoot $sid
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null
# worker.pid = the wrapper's own PID, matching bash (printf '%s' "$$" > worker.pid) —
# the dashboard kills the tree from this. Best-effort: the script-block pipeline cannot
# expose the inner claude PID directly.
$pidFile = Join-Path $sessionDir 'worker.pid'
Set-Content -Path $pidFile -Value "$PID" -NoNewline -Encoding UTF8 -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $sessionDir 'prompt.txt') -Value $prompt -NoNewline -Encoding UTF8

$branch = (git -C "$cwd" rev-parse --abbrev-ref HEAD 2>$null)
$modelCfg = if ($cfg.ContainsKey("DS_MODEL")) { $cfg["DS_MODEL"] } else { "" }
$flashCfg = if ($cfg.ContainsKey("DS_FLASH_MODEL")) { $cfg["DS_FLASH_MODEL"] } else { "" }
$model = if (-not [string]::IsNullOrWhiteSpace($modelCfg)) { $modelCfg } elseif ($env:DS_MODEL) { $env:DS_MODEL } else { "deepseek-v4-pro" }
$flash = if (-not [string]::IsNullOrWhiteSpace($flashCfg)) { $flashCfg } elseif ($env:DS_FLASH_MODEL) { $env:DS_FLASH_MODEL } else { "deepseek-v4-flash" }

$originalLocation = Get-Location

[Console]::Error.WriteLine("claude-ds session: $sid")
[Console]::Error.WriteLine("  cwd:    $cwd")
[Console]::Error.WriteLine("  dir:    $sessionDir")
[Console]::Error.WriteLine("  status: $(Join-Path $sessionDir 'status.json')")
[Console]::Error.WriteLine("  log:    $(Join-Path $sessionDir 'progress.log')")

# Forward host gh token into worker env (issue #56).
if (-not $env:CLI_DISPATCH_NO_GH_TOKEN -and -not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $tok = & gh auth token 2>$null
    if ($LASTEXITCODE -eq 0 -and $tok) { $env:GH_TOKEN = "$tok".Trim() }
  }
}

# --effort mapping to MAX_THINKING_TOKENS.
$think = 0
if (-not [string]::IsNullOrWhiteSpace($effort)) {
  switch ($effort.ToLower()) {
    'low' { $think = 1024; $effort = 'low' }
    'medium' { $think = 8192; $effort = 'medium' }
    'high' { $think = 31999; $effort = 'high' }
    default {
      Write-Error "claude-ds-stream: --effort must be low|medium|high (got '$effort')."
      exit 2
    }
  }
}

# ---- env ----
$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = $key
$env:ANTHROPIC_MODEL = $model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $model
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $flash
$env:CLAUDE_CODE_SUBAGENT_MODEL = $flash
if ($think -gt 0) { $env:MAX_THINKING_TOKENS = "$think" }

$env:CLAUDE_DS_SESSION_DIR = $sessionDir
$env:CLAUDE_DS_PROMPT_PREVIEW = $prompt.Substring(0, [Math]::Min(120, $prompt.Length))
$env:CLAUDE_DS_CWD = $cwd
$env:CLAUDE_DS_BRANCH = $branch
$env:CLAUDE_DS_MODEL = if ($think -gt 0) { "$model ($effort)" } else { $model }
$env:CLAUDE_DS_RESUME = "$resume"

# ---- build worker args ----
$claudeArgs = @(
  "--print",
  "--output-format", "stream-json",
  "--include-partial-messages",
  "--verbose",
  "--permission-mode", "bypassPermissions",
  "--strict-mcp-config",
  "--add-dir", $cwd
)
if ($resume -eq 1) {
  $claudeArgs += @("--resume", $sid)
} else {
  $claudeArgs += @("--session-id", $sid)
}
$emptyMcpConfig = $null
if ($readOnly -eq 1) {
  $emptyMcpConfig = [System.IO.Path]::GetTempFileName()
  Set-Content -Path $emptyMcpConfig -Value '{"mcpServers":{}}' -NoNewline -Encoding UTF8
  $claudeArgs += @("--tools", "Read,Grep,Glob", "--mcp-config", $emptyMcpConfig)
}
if ($passArgs.Count -gt 0) { $claudeArgs += $passArgs }

# ---- timeout/idle watchdog ----
$pidfile = Join-Path $sessionDir '.claude.pid'
$timeoutFile = Join-Path $sessionDir '.timeout'
$parserDone = Join-Path $sessionDir '.parser_done'
$claudeRcFile = Join-Path $sessionDir '.claude.rc'
$watchJob = $null

if ($maxRuntime -gt 0 -or $idleTimeout -gt 0) {
  [Console]::Error.WriteLine("  guard:  max-runtime=${maxRuntime}s idle-timeout=${idleTimeout}s")
  $watchJob = Start-Job -ScriptBlock {
    param($sid, $sessionDir, $maxRuntime, $idleTimeout, $pidfile, $timeoutFile)
    $start = Get-Date
    $transcript = Join-Path $sessionDir "transcript.jsonl"
    $watchPid = 0
    for ($n = 0; $n -lt 160; $n++) {
      $matchingProcs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($sid) -and $_.CommandLine.Contains("stream-json") })
      if ($matchingProcs.Count -eq 1) { $watchPid = [int]$matchingProcs[0].ProcessId; break }
      if ($matchingProcs.Count -gt 1) {
        [Console]::Error.WriteLine("  guard:  multiple matching processes ($($matchingProcs.Count)) for session $sid, skipping kill to avoid wrong-process termination")
      }
      Start-Sleep -Milliseconds 250
    }
    if ($watchPid -eq 0) { return }
    Set-Content -Path $pidfile -Value "$watchPid" -NoNewline -Encoding UTF8 -ErrorAction SilentlyContinue
    while (Get-Process -Id $watchPid -ErrorAction SilentlyContinue) {
      Start-Sleep -Seconds 2
      $now = Get-Date
      if ($maxRuntime -gt 0 -and (($now - $start).TotalSeconds -ge $maxRuntime)) {
        Set-Content -Path $timeoutFile -Value "runtime ${maxRuntime}s" -NoNewline -Encoding UTF8
        & taskkill /PID $watchPid /T /F 2>$null | Out-Null
        return
      }
      if ($idleTimeout -gt 0) {
        $m = $null
        try { $m = (Get-Item $transcript -ErrorAction Stop).LastWriteTime } catch {}
        if (-not $m) { $m = $start }
        if ((($now - $m).TotalSeconds) -ge $idleTimeout) {
          Set-Content -Path $timeoutFile -Value "idle ${idleTimeout}s" -NoNewline -Encoding UTF8
          & taskkill /PID $watchPid /T /F 2>$null | Out-Null
          return
        }
      }
    }
  } -ArgumentList $sid, $sessionDir, $maxRuntime, $idleTimeout, $pidfile, $timeoutFile
}

$runStarted = $false
$completed = $false
$interrupted = $false
$humanTookOver = $false
$interruptedSignal = "SIGINT"
$claudeRc = 0

Set-Content -Path $claudeRcFile -Value "0" -NoNewline -Encoding UTF8 -ErrorAction SilentlyContinue

try {
  $runStarted = $true
  $prompt | & {
    Set-Location -LiteralPath $cwd
    & claude @claudeArgs
    Set-Content -Path $claudeRcFile -Value "$LASTEXITCODE" -NoNewline -Encoding UTF8 -ErrorAction SilentlyContinue
  } | & node $parser
  Set-Content -Path $parserDone -Value "done" -NoNewline -Encoding UTF8 -ErrorAction SilentlyContinue

  try {
    $rcRaw = (Get-Content -Raw $claudeRcFile -ErrorAction Stop).Trim()
    $parsed = 0
    if ([int]::TryParse($rcRaw, [ref]$parsed)) { $claudeRc = $parsed }
  } catch {
    $claudeRc = $LASTEXITCODE
  }

  if ($watchJob) { Stop-Job -Job $watchJob -ErrorAction SilentlyContinue; Remove-Job $watchJob -Force -ErrorAction SilentlyContinue; $watchJob = $null }

  $state = Get-JsonField (Join-Path $sessionDir "status.json") "state"
  if ($state -eq "human-controlled") {
    [Console]::Error.WriteLine("claude-ds-stream: session taken over by a human — leaving record to the dashboard.")
    $completed = $true
    $claudeRc = 0
    $humanTookOver = $true
  } else {
    $readOnlyViolation = ""
    if ($readOnly -eq 1) {
      $readOnlyStatus = git -C "$cwd" status --short 2>$null
      if (-not [string]::IsNullOrWhiteSpace($readOnlyStatus)) {
        $readOnlyLines = ($readOnlyStatus -split "`r?`n")
        $count = 0
        foreach ($line in $readOnlyLines) { if ($line) { $count++ } }
        [Console]::Error.WriteLine(">>> READ-ONLY VIOLATION: $count file(s) modified in $cwd despite --read-only")
        [Console]::Error.WriteLine($readOnlyStatus)
        $readOnlyViolation = "read-only violation: $count file(s) modified despite --read-only"
      }
    }

    $err = ""
    if (-not [string]::IsNullOrWhiteSpace($readOnlyViolation)) {
      $err = $readOnlyViolation
    } elseif (Test-Path $timeoutFile) {
      $timeoutReason = (Get-Content -Raw $timeoutFile -ErrorAction SilentlyContinue).Trim()
      $err = "timeout: $timeoutReason"
    } elseif ($claudeRc -ne 0) {
      $err = "claude exited $claudeRc"
    }

    if ([string]::IsNullOrWhiteSpace($err) -and $claudeRc -eq 0 -and -not [string]::IsNullOrWhiteSpace($verifyCmd)) {
      $verifyOutput = [System.IO.Path]::GetTempFileName()
      $verifyRc = 0
      try {
        Set-Location -LiteralPath $cwd
        if (Get-Command bash -ErrorAction SilentlyContinue) {
          bash -c $verifyCmd > $verifyOutput 2>&1
        } else {
          & pwsh -NoProfile -Command $verifyCmd > $verifyOutput 2>&1
        }
        $verifyRc = $LASTEXITCODE
      } finally {
        $verifyTail = (Get-Content -Path $verifyOutput -Tail 20 -ErrorAction SilentlyContinue) -join "`n"
        Record-VerifyResult -Directory $sessionDir -Command $verifyCmd -ExitCode $verifyRc -TailText $verifyTail
        Remove-Item -Force $verifyOutput -ErrorAction SilentlyContinue
      }
      Set-Location -LiteralPath $originalLocation.Path
    }

    Write-DiffArtifacts -SessionDir $sessionDir -Cwd $cwd

    if (-not [string]::IsNullOrWhiteSpace($err)) {
      $currentState = Get-JsonField (Join-Path $sessionDir "status.json") "state"
      if ($currentState -eq "running" -or $currentState -eq "done") {
        Reconcile-SessionError -Directory $sessionDir -ErrorMessage $err -ExitCode $claudeRc
      }
    }

    Remove-Item -Force $pidFile, $timeoutFile -ErrorAction SilentlyContinue
    $completed = $true
  }
} catch [System.Management.Automation.PipelineStoppedException] {
  $interrupted = $true
  $interruptedSignal = "SIGINT"
  $claudeRc = 130
} finally {
  if ($emptyMcpConfig) {
    Remove-Item -Force $emptyMcpConfig -ErrorAction SilentlyContinue
  }

  if ($watchJob) {
    Stop-Job -Job $watchJob -ErrorAction SilentlyContinue
    Remove-Job $watchJob -Force -ErrorAction SilentlyContinue
    $watchJob = $null
  }

  if (-not $completed) {
    if ($runStarted -and $interrupted) {
      [Console]::Error.WriteLine("claude-ds-stream: interrupted ($interruptedSignal).")
      for ($i = 0; $i -lt 30; $i++) {
        if (Test-Path $parserDone) { break }
        Start-Sleep -Milliseconds 100
      }
      $pidFromFile = 0
      if (Test-Path $pidfile) {
        $raw = (Get-Content -Raw $pidfile -ErrorAction SilentlyContinue).Trim()
        [void][int]::TryParse($raw, [ref]$pidFromFile)
      }
      $pidToKill = 0
      if ($pidFromFile -gt 0 -and $pidFromFile -ne $PID) {
        $pidToKill = $pidFromFile
      } else {
        $pidToKill = Find-WorkerPid -SessionId $sid
      }
      Kill-WorkerTree -Pid $pidToKill
      Reconcile-SessionError -Directory $sessionDir -ErrorMessage "interrupted: $interruptedSignal" -ExitCode $claudeRc
    }
  }

  if ($completed -and -not $interrupted) {
    Remove-Item -Force $timeoutFile -ErrorAction SilentlyContinue
  }
  Set-Location -LiteralPath $originalLocation.Path | Out-Null
}

if ($interrupted) {
  exit $claudeRc
}

if ($humanTookOver) {
  exit 0
}

exit $claudeRc
