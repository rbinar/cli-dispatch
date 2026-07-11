#!/usr/bin/env pwsh
# cx-stream.ps1 — Windows/PowerShell variant of cx-stream (the session-tracked Codex worker).
# Mirrors the bash cx-stream: pipes `codex exec --json` stdout through cx-stream-parse.mjs for
# live progress + a rolling status.json, writing the same session-dir layout the other backends
# use. Codex runs natively on Windows (unlike agy, which needs a pseudo-TTY), so this is a real
# first-class backend here. The parser .mjs is shared cross-platform.
$ErrorActionPreference = "Stop"
# Native stderr from codex/node is informational — don't let it raise terminating errors.
$PSNativeCommandUseErrorActionPreference = $false

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  Write-Error "cx-stream: 'codex' (OpenAI Codex CLI) not found in PATH. Install: npm i -g @openai/codex"
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "cx-stream: 'node' not found in PATH (required for the stream parser)."
  exit 1
}

# ---- optional config (shared across backends; env wins, legacy claude-ds fallback) ----
$Config = if ($env:CLI_DISPATCH_CONFIG) { $env:CLI_DISPATCH_CONFIG } elseif ($env:CLAUDE_DS_CONFIG) { $env:CLAUDE_DS_CONFIG } elseif (Test-Path (Join-Path $HOME ".config/cli-dispatch/config")) { Join-Path $HOME ".config/cli-dispatch/config" } else { Join-Path $HOME ".config/claude-ds/config" }
$cfg = @{}
if (Test-Path $Config) {
  Get-Content $Config | ForEach-Object {
    if ($_ -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') { $cfg[$matches[1]] = $matches[2] }
  }
}
# Surface auth keys to codex (codex prefers its own login; these are for headless/CI).
if ($cfg["CODEX_API_KEY"]) { $env:CODEX_API_KEY = $cfg["CODEX_API_KEY"] }
if ($cfg["OPENAI_API_KEY"]) { $env:OPENAI_API_KEY = $cfg["OPENAI_API_KEY"] }

# Forward the host's gh auth into the worker env (issue #56).
if (-not $env:CLI_DISPATCH_NO_GH_TOKEN -and -not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $tok = & gh auth token 2>$null
    if ($LASTEXITCODE -eq 0 -and $tok) { $env:GH_TOKEN = "$tok".Trim() }
  }
}

# ---- resolve the parser: env > installed location > script dir ----
$parser = $env:CX_PARSER
if ([string]::IsNullOrEmpty($parser)) {
  foreach ($cand in @(
    (Join-Path $HOME ".local/share/cli-dispatch/cx-stream-parse.mjs"),
    (Join-Path $HOME ".local/share/claude-ds/cx-stream-parse.mjs"),
    (Join-Path $ScriptDir "cx-stream-parse.mjs")
  )) {
    if (Test-Path $cand) { $parser = $cand; break }
  }
}
if ([string]::IsNullOrEmpty($parser) -or -not (Test-Path $parser)) {
  Write-Error "cx-stream: cx-stream-parse.mjs not found (set CX_PARSER)."
  exit 1
}

function ConvertTo-Int($v) { $n = 0; if ([int]::TryParse("$v", [ref]$n)) { return $n } return 0 }

function Reconcile-SessionError($dir, $err, $exitCode) {
  $statusJsonPath = Join-Path $dir "status.json"
  if (Test-Path $statusJsonPath) {
    try {
      $s = Get-Content -Raw $statusJsonPath | ConvertFrom-Json
      $s.state = "error"
      $s.error = $err
      $s | ConvertTo-Json -Depth 10 | Set-Content -Path $statusJsonPath -Encoding UTF8
    } catch {
      [Console]::Error.WriteLine("reconcile: cannot write status.json: $($_.Exception.Message)")
    }
  }
  
  $metaJsonPath = Join-Path $dir "meta.json"
  if (Test-Path $metaJsonPath) {
    try {
      $m = Get-Content -Raw $metaJsonPath | ConvertFrom-Json
      $m.state = "error"
      $m.exitCode = [int]$exitCode
      $m.error = $err
      $m | ConvertTo-Json -Depth 10 | Set-Content -Path $metaJsonPath -Encoding UTF8
    } catch {
      [Console]::Error.WriteLine("reconcile: cannot write meta.json: $($_.Exception.Message)")
    }
  }
}

function Write-DiffArtifacts($dir, $cwd) {
  $null = git -C $cwd rev-parse --is-inside-work-tree 2>$null
  if ($LASTEXITCODE -ne 0) { return }

  $statusLines = & git -C $cwd status --short --untracked-files=all 2>$null
  if (-not $statusLines) { return }

  New-Item -ItemType Directory -Force -Path $dir -ErrorAction SilentlyContinue | Out-Null

  $diffPatchPath = Join-Path $dir "diff.patch"
  & git -C $cwd diff HEAD 2>$null | Set-Content -Path $diffPatchPath -Encoding UTF8

  $diffStatLines = & git -C $cwd diff --stat HEAD 2>$null
  $diffstat = ""
  if ($diffStatLines) {
    $diffstat = ($diffStatLines[-1]).Trim()
  }

  $changes = @()
  foreach ($line in $statusLines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $code = $line.Substring(0, 2)
    $file = $line.Substring(3)
    $fstatus = ""

    if ($code -eq "??") {
      $fstatus = "??"
    } else {
      $char1 = $code.Substring(0, 1)
      $char2 = $code.Substring(1, 1)
      $fstatus = if (-not [string]::IsNullOrWhiteSpace($char1)) { $char1 } else { $char2 }
      if ($fstatus -notin @('M', 'A', 'D', 'R', 'C')) {
        $fstatus = ""
      } elseif ($fstatus -in @('R', 'C')) {
        $fstatus = "A"
      }
    }

    if ([string]::IsNullOrEmpty($fstatus)) { continue }

    if ($fstatus -eq "??" -and (Test-Path (Join-Path $cwd $file))) {
      & git -C $cwd diff --no-index -- /dev/null $file 2>$null | Add-Content -Path $diffPatchPath -Encoding UTF8
    }

    $changes += [PSCustomObject]@{
      path   = $file
      status = $fstatus
    }
  }

  $changedFilesPath = Join-Path $dir "changed-files.json"
  $jsonObj = [PSCustomObject]@{
    files    = $changes
    diffstat = $diffstat
  }
  $jsonObj | ConvertTo-Json -Depth 5 | Set-Content -Path $changedFilesPath -Encoding UTF8
}

# ---- parse arguments ----
$cwd = (Get-Location).Path
$resumeId = ""
$prompt = $null
$readOnly = 0
$sandbox = ""
$effort = if ($env:CX_EFFORT) { $env:CX_EFFORT } else { "" }

# Model precedence: config overrides env in bash (since config is sourced afterwards)
$cxModelEnv = $env:CX_MODEL
$codexModelEnv = $env:CODEX_MODEL
if ($cfg.ContainsKey("CX_MODEL")) { $cxModelEnv = $cfg["CX_MODEL"] }
if ($cfg.ContainsKey("CODEX_MODEL")) { $codexModelEnv = $cfg["CODEX_MODEL"] }
$model = if (-not [string]::IsNullOrEmpty($cxModelEnv)) { $cxModelEnv } else { $codexModelEnv }

$maxRuntime = ConvertTo-Int $env:CX_MAX_RUNTIME
$idleTimeout = ConvertTo-Int $env:CX_IDLE_TIMEOUT

# Network toggle resolution
$cxNetworkEnv = if ($env:CX_NETWORK) { $env:CX_NETWORK } elseif ($cfg.ContainsKey("CX_NETWORK")) { $cfg["CX_NETWORK"] } else { "1" }
$network = 1
if ($cxNetworkEnv -in @('0', 'false', 'no', 'off')) { $network = 0 }

$verifyCmd = if ($env:CLI_DISPATCH_VERIFY_CMD) { $env:CLI_DISPATCH_VERIFY_CMD } elseif ($cfg.ContainsKey("CLI_DISPATCH_VERIFY_CMD")) { $cfg["CLI_DISPATCH_VERIFY_CMD"] } else { "" }

$passArgs = @()
$explicitCwd = $false
$explicitModel = $false

function Need-Val($name, $idx, $argc) { if ($idx + 1 -ge $argc) { Write-Error "cx-stream: $name requires a value."; exit 1 } }
$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--cwd$'          { Need-Val '--cwd' $i $argc; $cwd = $args[$i+1]; $explicitCwd = $true; $i += 2; continue }
    '^--cwd=(.*)'      { $cwd = $matches[1]; $explicitCwd = $true; $i += 1; continue }
    '^--resume$'       { Need-Val '--resume' $i $argc; $resumeId = $args[$i+1]; $i += 2; continue }
    '^--resume=(.*)'   { $resumeId = $matches[1]; $i += 1; continue }
    '^--model$'        { Need-Val '--model' $i $argc; $model = $args[$i+1]; $explicitModel = $true; $i += 2; continue }
    '^--model=(.*)'    { $model = $matches[1]; $explicitModel = $true; $i += 1; continue }
    '^--effort$'       { Need-Val '--effort' $i $argc; $effort = $args[$i+1]; $i += 2; continue }
    '^--effort=(.*)'   { $effort = $matches[1]; $i += 1; continue }
    '^--sandbox$'      { Need-Val '--sandbox' $i $argc; $sandbox = $args[$i+1]; $i += 2; continue }
    '^--sandbox=(.*)'  { $sandbox = $matches[1]; $i += 1; continue }
    '^(-p|--prompt)$'  { Need-Val $a $i $argc; $prompt = $args[$i+1]; $i += 2; continue }
    '^--prompt=(.*)'   { $prompt = $matches[1]; $i += 1; continue }
    '^--read-only$'    { $readOnly = 1; $i += 1; continue }
    '^(--network|--net)$'  { $network = 1; $i += 1; continue }
    '^(--no-network|--no-net)$' { $network = 0; $i += 1; continue }
    '^--max-runtime$'  { Need-Val '--max-runtime' $i $argc; $maxRuntime = ConvertTo-Int $args[$i+1]; $i += 2; continue }
    '^--max-runtime=(.*)'  { $maxRuntime = ConvertTo-Int $matches[1]; $i += 1; continue }
    '^--idle-timeout$' { Need-Val '--idle-timeout' $i $argc; $idleTimeout = ConvertTo-Int $args[$i+1]; $i += 2; continue }
    '^--idle-timeout=(.*)' { $idleTimeout = ConvertTo-Int $matches[1]; $i += 1; continue }
    '^--verify-cmd$'   { Need-Val '--verify-cmd' $i $argc; $verifyCmd = $args[$i+1]; $i += 2; continue }
    '^--verify-cmd=(.*)' { $verifyCmd = $matches[1]; $i += 1; continue }
    default            { $passArgs += $a; $i += 1 }
  }
}

if ($null -eq $prompt) {
  if (-not [Console]::IsInputRedirected) { Write-Error "cx-stream: no prompt. Use -p `"<prompt>`" or pipe via stdin."; exit 1 }
  $prompt = [Console]::In.ReadToEnd()
}
if ([string]::IsNullOrWhiteSpace($prompt)) { Write-Error "cx-stream: empty prompt — nothing to delegate."; exit 1 }

# The resume id becomes a session-dir path component → reject path traversal early.
if (-not [string]::IsNullOrEmpty($resumeId)) {
  if ($resumeId -match '[\\/]' -or $resumeId -match '\.\.') { Write-Error "cx-stream: invalid --resume id"; exit 1 }
}

# On resume, restore recorded cwd and model from the session's meta.json.
# Resolve sessions root (same logic as the session-bookkeeping block below).
if (-not [string]::IsNullOrEmpty($resumeId)) {
  $resumeSessionsRoot = if ($env:CLI_DISPATCH_SESSIONS_DIR) { $env:CLI_DISPATCH_SESSIONS_DIR } else { $env:CLAUDE_DS_SESSIONS_DIR }
  if ([string]::IsNullOrEmpty($resumeSessionsRoot)) {
    $cacheRoot = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
    $newRoot = Join-Path $cacheRoot "cli-dispatch/sessions"; $oldRoot = Join-Path $cacheRoot "claude-ds/sessions"
    $resumeSessionsRoot = if ((Test-Path $newRoot) -or (-not (Test-Path $oldRoot))) { $newRoot } else { $oldRoot }
  }
  $recordedMeta = Join-Path $resumeSessionsRoot "$resumeId/meta.json"
  if (Test-Path $recordedMeta) {
    try {
      $meta = Get-Content -Raw $recordedMeta | ConvertFrom-Json
      if ($meta.cwd -and (Test-Path $meta.cwd)) { $cwd = $meta.cwd }
      if (-not $explicitModel -and $meta.model) {
        $recModel = $meta.model
        if ($recModel -match '^(.*)\s+\(') { $recModel = $matches[1] }
        if (-not [string]::IsNullOrEmpty($recModel)) { $model = $recModel }
      }
    } catch {}
  } else {
    # Session may have been killed before relocation (SIGKILL, crash, etc.) —
    # scan provisional cx-*/ dirs for a meta.json whose threadId matches.
    $rescueCount = 0
    $rescueDir = ""
    Get-ChildItem -Path (Join-Path $resumeSessionsRoot "cx-*") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $candMeta = Join-Path $_.FullName "meta.json"
      if (Test-Path $candMeta) {
        try {
          $cand = Get-Content -Raw $candMeta | ConvertFrom-Json
          if ($cand.threadId -eq $resumeId) { $rescueCount++; $script:rescueDir = $_.FullName }
        } catch {}
      }
    }
    if ($rescueCount -eq 1) {
      $finalDir = Join-Path $resumeSessionsRoot $resumeId
      if (-not (Test-Path $finalDir)) {
        try { Move-Item -Force $rescueDir $finalDir -ErrorAction Stop } catch {}
      }
      $recordedMeta = Join-Path $resumeSessionsRoot "$resumeId/meta.json"
      if (Test-Path $recordedMeta) {
        try {
          $meta = Get-Content -Raw $recordedMeta | ConvertFrom-Json
          if ($meta.cwd -and (Test-Path $meta.cwd)) { $cwd = $meta.cwd }
          if (-not $explicitModel -and $meta.model) {
            $recModel = $meta.model
            if ($recModel -match '^(.*)\s+\(') { $recModel = $matches[1] }
            if (-not [string]::IsNullOrEmpty($recModel)) { $model = $recModel }
          }
        } catch {}
      }
    }
  }
  # Fail-safe: if we still have no meta.json and the caller did not pass --cwd
  # explicitly, refuse to run. Silently adopting the invoking shell's cwd is
  # exactly the bug being fixed — it can write files into the wrong repo checkout.
  if (-not (Test-Path $recordedMeta) -and -not $explicitCwd) {
    Write-Error "cx-stream: unknown session '$resumeId' — recorded cwd not found."
    Write-Error "  The session may have been killed before its working directory was saved."
    Write-Error "  Resuming without the original cwd is unsafe (it would silently adopt the"
    Write-Error "  invoking shell's cwd). Pass --cwd <path> explicitly to proceed."
    exit 1
  }
}

# Make cwd absolute.
try { $cwd = (Resolve-Path -LiteralPath $cwd -ErrorAction Stop).Path } catch { Write-Error "cx-stream: bad --cwd"; exit 1 }

# ---- resolve the sandbox mode (explicit --sandbox wins; then --read-only; default workspace-write) ----
$sandboxMode = "workspace-write"
if ($readOnly -eq 1) { $sandboxMode = "read-only" }
if (-not [string]::IsNullOrEmpty($sandbox)) { $sandboxMode = $sandbox }

# Network access applies only to the workspace-write sandbox
$netArgs = @()
$netState = "n/a"
if ($sandboxMode -eq "workspace-write") {
  if ($network -eq 1) {
    $netArgs = @('-c', 'sandbox_workspace_write.network_access=true')
    $netState = "on"
  } else {
    $netState = "off"
  }
}

# --effort low|medium|high → codex model_reasoning_effort config override.
if (-not [string]::IsNullOrEmpty($effort)) {
  $effort = $effort.ToLower()
  if ($effort -notin @('low','medium','high')) { Write-Error "cx-stream: --effort must be low|medium|high (got '$effort')."; exit 2 }
}

# Scrape codex's own config.toml for defaults when the user hasn't passed a flag,
# so the dashboard can show the model/effort actually in use. NOT added to the
# codex command line — codex applies these defaults itself.
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$codexConfig = Join-Path $codexHome "config.toml"
$metaModel = ""
$metaEffort = ""
if (Test-Path $codexConfig) {
  if ([string]::IsNullOrEmpty($model)) {
    try {
      $m = Get-Content $codexConfig | Select-String '^model\s*=\s*"([^"]*)"' | Select-Object -First 1
      if ($m) { $metaModel = $m.Matches.Groups[1].Value }
    } catch {}
  }
  if ([string]::IsNullOrEmpty($effort)) {
    try {
      $m = Get-Content $codexConfig | Select-String '^model_reasoning_effort\s*=\s*"([^"]*)"' | Select-Object -First 1
      if ($m) { $metaEffort = $m.Matches.Groups[1].Value }
    } catch {}
  }
}
$effectiveEffort = if ($effort) { $effort } else { $metaEffort }

# ---- build the codex command (resume accepts a different flag set than plain exec) ----
# Temporary files
$outFile = New-TemporaryFile
$rcFile = New-TemporaryFile
$parserOutFile = New-TemporaryFile

$resume = 0
if (-not [string]::IsNullOrEmpty($resumeId)) {
  $resume = 1
  # `codex exec resume` rejects -s/-C/--color → pass sandbox via -c sandbox_mode=, drop cwd/color.
  $codexArgs = @('exec', 'resume', '--json', '-o', $outFile.FullName, '--skip-git-repo-check')
  if (-not [string]::IsNullOrEmpty($model)) { $codexArgs += @('-m', $model) }
  if ($effort) { $codexArgs += @('-c', "model_reasoning_effort=$effort") }
  $codexArgs += @('-c', "sandbox_mode=$sandboxMode")
  if ($netArgs.Count -gt 0) { $codexArgs += $netArgs }
  if ($passArgs.Count -gt 0) { $codexArgs += $passArgs }
  $codexArgs += @($resumeId, $prompt)
} else {
  $codexArgs = @('exec', '--json', '-o', $outFile.FullName, '--skip-git-repo-check', '--color', 'never', '-C', $cwd, '-s', $sandboxMode)
  if (-not [string]::IsNullOrEmpty($model)) { $codexArgs += @('-m', $model) }
  if ($effort) { $codexArgs += @('-c', "model_reasoning_effort=$effort") }
  if ($netArgs.Count -gt 0) { $codexArgs += $netArgs }
  if ($passArgs.Count -gt 0) { $codexArgs += $passArgs }
  $codexArgs += @($prompt)
}

# ---- session bookkeeping (provisional dir; relocated to the real thread id on completion) ----
$sessionsRoot = if ($env:CLI_DISPATCH_SESSIONS_DIR) { $env:CLI_DISPATCH_SESSIONS_DIR } else { $env:CLAUDE_DS_SESSIONS_DIR }
if ([string]::IsNullOrEmpty($sessionsRoot)) {
  $cacheRoot = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
  $newRoot = Join-Path $cacheRoot "cli-dispatch/sessions"; $oldRoot = Join-Path $cacheRoot "claude-ds/sessions"
  $sessionsRoot = if ((Test-Path $newRoot) -or (-not (Test-Path $oldRoot))) { $newRoot } else { $oldRoot }
}
New-Item -ItemType Directory -Force -Path $sessionsRoot | Out-Null
if ($resume -eq 1) { $sid = $resumeId } else { $sid = "cx-" + [int][double]::Parse((Get-Date -UFormat %s)) + "-" + $PID }
$sessionDir = Join-Path $sessionsRoot $sid
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null
Set-Content -Path (Join-Path $sessionDir 'worker.pid') -Value $PID -NoNewline -Encoding UTF8 # best-effort
Set-Content -Path (Join-Path $sessionDir 'prompt.txt') -Value $prompt -NoNewline -Encoding UTF8
$branch = (git -C $cwd rev-parse --abbrev-ref HEAD 2>$null)

[Console]::Error.WriteLine("cx-stream -> Codex (OpenAI Codex CLI) worker")
[Console]::Error.WriteLine("  cwd:     $cwd")
$netLabel = if ($netState -ne "n/a") { " (network: $netState)" } else { "" }
[Console]::Error.WriteLine("  sandbox: $sandboxMode$netLabel")
if (-not [string]::IsNullOrEmpty($model)) { [Console]::Error.WriteLine("  model:   $model") }
if ($resume -eq 1) { [Console]::Error.WriteLine("  resume:  $resumeId") }
[Console]::Error.WriteLine("  dir:     $sessionDir")
[Console]::Error.WriteLine("  status:  $(Join-Path $sessionDir 'status.json')")

# ---- parser env ----
$env:CX_SESSION_DIR = $sessionDir
$env:CX_PROMPT_PREVIEW = $prompt.Substring(0, [Math]::Min(120, $prompt.Length))
$env:CX_CWD = $cwd
$env:CX_BRANCH = $branch
$cxModelLabel = if ($model) { $model } else { $metaModel }
if ($effectiveEffort) { $cxModelLabel = "$cxModelLabel ($effectiveEffort)" }
$env:CX_MODEL = $cxModelLabel
$env:CX_THREAD_ID = if ($resume -eq 1) { $resumeId } else { "" }
$env:CX_RESUME = "$resume"

# ---- watchdog: runtime cap + idle on transcript mtime (best-effort; mirrors claude-ds-stream.ps1) ----
$timeoutFile = Join-Path $sessionDir '.timeout'
Remove-Item -Force $timeoutFile -ErrorAction SilentlyContinue
$watchJob = $null
if ($maxRuntime -gt 0 -or $idleTimeout -gt 0) {
  [Console]::Error.WriteLine("  guard:   max-runtime=${maxRuntime}s idle-timeout=${idleTimeout}s")
  $watchJob = Start-Job -ScriptBlock {
    param($sessionDir, $maxRuntime, $idleTimeout)
    $start = Get-Date
    $transcript = Join-Path $sessionDir 'transcript.jsonl'
    $tf = Join-Path $sessionDir '.timeout'
    $procId = $null
    for ($n = 0; $n -lt 160; $n++) {
      $matchingProcs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -and $_.CommandLine -match '\bexec\b' -and $_.CommandLine.Contains('--json') -and $_.Name -match 'codex' })
      if ($matchingProcs.Count -eq 1) { $procId = $matchingProcs[0].ProcessId; break }
      if ($matchingProcs.Count -gt 1) {
        [Console]::Error.WriteLine("  guard:   multiple matching processes ($($matchingProcs.Count)) for codex exec, skipping kill to avoid wrong-process termination")
      }
      Start-Sleep -Milliseconds 250
    }
    if (-not $procId) { return }
    while (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Start-Sleep -Seconds 2
      $now = Get-Date
      if ($maxRuntime -gt 0 -and ($now - $start).TotalSeconds -ge $maxRuntime) {
        Set-Content -Path $tf -Value "runtime ${maxRuntime}s"; & taskkill /PID $procId /T /F 2>$null | Out-Null; return
      }
      if ($idleTimeout -gt 0) {
        $m = $start
        try { $m = (Get-Item $transcript -ErrorAction Stop).LastWriteTime } catch {}
        if (($now - $m).TotalSeconds -ge $idleTimeout) {
          Set-Content -Path $tf -Value "idle ${idleTimeout}s"; & taskkill /PID $procId /T /F 2>$null | Out-Null; return
        }
      }
    }
  } -ArgumentList $sessionDir, $maxRuntime, $idleTimeout
}

$rc = 0
$completedNormal = $false
$doneFile = Join-Path $sessionDir '.cx.done'
Remove-Item -Force $doneFile -ErrorAction SilentlyContinue

try {
  # ---- run codex; its JSONL stdout → parser. Feed codex empty stdin so it doesn't block on
  # "Reading additional input from stdin..." (the prompt is passed as the last positional). ----
  try {
    $null | & { & codex @codexArgs; Set-Content -Path $rcFile.FullName -Value $LASTEXITCODE } | & node $parser > $parserOutFile.FullName
    $rc = ConvertTo-Int (Get-Content -Raw $rcFile.FullName -ErrorAction SilentlyContinue)
  } catch {
    [Console]::Error.WriteLine("cx-stream: $($_.Exception.Message)")
    $rc = 1
  }
  if ($null -eq $rc) { $rc = 0 }

  if ($watchJob) { Stop-Job $watchJob -ErrorAction SilentlyContinue; Remove-Job $watchJob -Force -ErrorAction SilentlyContinue }

  # ---- reconcile a watchdog timeout (always a failure) ----
  if (Test-Path $timeoutFile) {
    $reason = (Get-Content -Raw $timeoutFile).Trim()
    Set-Content -Path $doneFile -Value "timeout: $reason" -NoNewline -Encoding UTF8
    [Console]::Error.WriteLine("cx-stream: stopped by watchdog ($reason).")
    if ($rc -eq 0) { $rc = 124 }
    Reconcile-SessionError -dir $sessionDir -err "timeout: $reason" -exitCode $rc
  } else {
    if ($rc -ne 0) {
      $codexState = ""
      $statusFile = Join-Path $sessionDir 'status.json'
      if (Test-Path $statusFile) {
        try { $codexState = (Get-Content -Raw $statusFile | ConvertFrom-Json).state } catch {}
      }
      if ($codexState -eq "done" -or [string]::IsNullOrEmpty($codexState)) {
        Reconcile-SessionError -dir $sessionDir -err "codex exited with code $rc" -exitCode $rc
      }
    }
    Set-Content -Path $doneFile -Value "$rc" -NoNewline -Encoding UTF8
  }
  $workerRc = $rc

  # ---- surface a turn-level error (codex can emit turn.failed yet exit 0) ----
  $statusFile = Join-Path $sessionDir 'status.json'
  if (Test-Path $statusFile) {
    try {
      $s = Get-Content -Raw $statusFile | ConvertFrom-Json
      if ($s.state -eq 'error') {
        if ($s.error) { [Console]::Error.WriteLine("cx-stream: codex turn failed: $($s.error)") }
        else { [Console]::Error.WriteLine("cx-stream: codex turn failed.") }
        if ($rc -eq 0) { $rc = 1 }
      }
    } catch {}
  }

  # ---- Optional verify hook (clean worker exit only; never affects exit code) ----
  if ($workerRc -eq 0 -and -not [string]::IsNullOrEmpty($verifyCmd)) {
    $verifyOutput = [System.IO.Path]::GetTempFileName()
    $verifyTail = [System.IO.Path]::GetTempFileName()
    $prevCwd = Get-Location
    try {
      Set-Location -LiteralPath $cwd
      $isWin = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
      if ($isWin) {
        & cmd.exe /c $verifyCmd > $verifyOutput 2>&1
      } else {
        & sh -c $verifyCmd > $verifyOutput 2>&1
      }
      $verifyRc = $LASTEXITCODE

      $lines = Get-Content -Path $verifyOutput -Tail 20 -ErrorAction SilentlyContinue
      if ($lines) {
        $lines | Set-Content -Path $verifyTail -Encoding UTF8 -ErrorAction SilentlyContinue
      } else {
        Set-Content -Path $verifyTail -Value "" -Encoding UTF8 -ErrorAction SilentlyContinue
      }

      $env:CLI_DISPATCH_RV_DIR = $sessionDir
      $env:CLI_DISPATCH_RV_CMD = $verifyCmd
      $env:CLI_DISPATCH_RV_EXIT = "$verifyRc"
      $env:CLI_DISPATCH_RV_TAIL_FILE = $verifyTail

      & node -e '
        const fs = require("fs");
        const p = require("path");
        const dir = process.env.CLI_DISPATCH_RV_DIR;
        const cmd = process.env.CLI_DISPATCH_RV_CMD || "";
        const rc = Number(process.env.CLI_DISPATCH_RV_EXIT);
        const tailFile = process.env.CLI_DISPATCH_RV_TAIL_FILE;
        let tail = "";
        try { tail = fs.readFileSync(tailFile, "utf8"); } catch {}
        let status = {};
        try { status = JSON.parse(fs.readFileSync(p.join(dir, "status.json"), "utf8")); } catch {}
        status.verify = {
          cmd,
          exit: Number.isFinite(rc) ? rc : 0,
          tail,
        };
        try { fs.writeFileSync(p.join(dir, "status.json"), JSON.stringify(status, null, 2) + "\n"); } catch {}
      '

      $env:CLI_DISPATCH_RV_DIR = $null
      $env:CLI_DISPATCH_RV_CMD = $null
      $env:CLI_DISPATCH_RV_EXIT = $null
      $env:CLI_DISPATCH_RV_TAIL_FILE = $null
    } catch {
      [Console]::Error.WriteLine("cx-stream: verify command execution failed: $($_.Exception.Message)")
    } finally {
      Set-Location -LiteralPath $prevCwd
      Remove-Item -Force $verifyOutput -ErrorAction SilentlyContinue
      Remove-Item -Force $verifyTail -ErrorAction SilentlyContinue
    }
  }

  # ---- relocate the provisional session dir to the real thread id (best-effort) ----
  if ($resume -eq 0) {
    $metaFile = Join-Path $sessionDir 'meta.json'
    $threadId = ""
    if (Test-Path $metaFile) { try { $threadId = (Get-Content -Raw $metaFile | ConvertFrom-Json).threadId } catch {} }
    if (-not [string]::IsNullOrEmpty($threadId) -and $threadId -ne $sid) {
      $finalDir = Join-Path $sessionsRoot $threadId
      if (-not (Test-Path $finalDir)) {
        try { Move-Item -Force $sessionDir $finalDir; $sessionDir = $finalDir } catch {}
      } else {
        [Console]::Error.WriteLine("cx-stream: thread dir $finalDir exists; session left at $sessionDir")
      }
      [Console]::Error.WriteLine("  thread:  $threadId")
    }
  }

  # ---- extract diff artifacts ----
  Write-DiffArtifacts -dir $sessionDir -cwd $cwd

  # ---- print ONLY the final agent message on stdout (codex -o file; clean) ----
  if ((Test-Path $outFile.FullName) -and (Get-Item $outFile.FullName).Length -gt 0) {
    Get-Content -Raw $outFile.FullName
  } elseif ((Test-Path $parserOutFile.FullName) -and (Get-Item $parserOutFile.FullName).Length -gt 0) {
    Get-Content -Raw $parserOutFile.FullName
  }

  $completedNormal = $true
} finally {
  if ($watchJob) {
    Stop-Job $watchJob -ErrorAction SilentlyContinue
    Remove-Job $watchJob -Force -ErrorAction SilentlyContinue
  }

  # Reconcile status.json/meta.json to state:error on abnormal/interrupted run
  $takeoverState = ""
  $statusFile = Join-Path $sessionDir 'status.json'
  if (Test-Path $statusFile) {
    try {
      $takeoverState = (Get-Content -Raw $statusFile | ConvertFrom-Json).state
    } catch {}
  }

  if ($takeoverState -ne "human-controlled") {
    if (-not $completedNormal) {
      [Console]::Error.WriteLine("cx-stream: interrupted.")
      if ($resume -eq 0) {
        $metaFile = Join-Path $sessionDir 'meta.json'
        $threadId = ""
        if (Test-Path $metaFile) {
          try { $threadId = (Get-Content -Raw $metaFile | ConvertFrom-Json).threadId } catch {}
        }
        if (-not [string]::IsNullOrEmpty($threadId) -and $threadId -ne $sid) {
          $finalDir = Join-Path $sessionsRoot $threadId
          if (-not (Test-Path $finalDir)) {
            try { Move-Item -Force $sessionDir $finalDir; $sessionDir = $finalDir } catch {}
          }
        }
      }
      Reconcile-SessionError -dir $sessionDir -err "interrupted" -exitCode 130
    }
  }

  Remove-Item -Force $timeoutFile -ErrorAction SilentlyContinue
  Remove-Item -Force $outFile.FullName -ErrorAction SilentlyContinue
  Remove-Item -Force $rcFile.FullName -ErrorAction SilentlyContinue
  Remove-Item -Force $parserOutFile.FullName -ErrorAction SilentlyContinue
}

exit $rc
