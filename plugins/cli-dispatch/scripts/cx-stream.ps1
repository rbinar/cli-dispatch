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

# ---- parse arguments ----
$cwd = (Get-Location).Path
$resumeId = ""
$prompt = $null
$readOnly = 0
$sandbox = ""
$model = if ($cfg["CX_MODEL"]) { $cfg["CX_MODEL"] } elseif ($cfg["CODEX_MODEL"]) { $cfg["CODEX_MODEL"] } else { "" }
$maxRuntime = ConvertTo-Int $env:CX_MAX_RUNTIME
$idleTimeout = ConvertTo-Int $env:CX_IDLE_TIMEOUT
$passArgs = @()
function Need-Val($name, $idx, $argc) { if ($idx + 1 -ge $argc) { Write-Error "cx-stream: $name requires a value."; exit 1 } }
$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--cwd$'          { Need-Val '--cwd' $i $argc; $cwd = $args[$i+1]; $i += 2; continue }
    '^--cwd=(.*)'      { $cwd = $matches[1]; $i += 1; continue }
    '^--resume$'       { Need-Val '--resume' $i $argc; $resumeId = $args[$i+1]; $i += 2; continue }
    '^--resume=(.*)'   { $resumeId = $matches[1]; $i += 1; continue }
    '^--model$'        { Need-Val '--model' $i $argc; $model = $args[$i+1]; $i += 2; continue }
    '^--model=(.*)'    { $model = $matches[1]; $i += 1; continue }
    '^--sandbox$'      { Need-Val '--sandbox' $i $argc; $sandbox = $args[$i+1]; $i += 2; continue }
    '^--sandbox=(.*)'  { $sandbox = $matches[1]; $i += 1; continue }
    '^(-p|--prompt)$'  { Need-Val $a $i $argc; $prompt = $args[$i+1]; $i += 2; continue }
    '^--prompt=(.*)'   { $prompt = $matches[1]; $i += 1; continue }
    '^--read-only$'    { $readOnly = 1; $i += 1; continue }
    '^--max-runtime$'  { Need-Val '--max-runtime' $i $argc; $maxRuntime = ConvertTo-Int $args[$i+1]; $i += 2; continue }
    '^--max-runtime=(.*)'  { $maxRuntime = ConvertTo-Int $matches[1]; $i += 1; continue }
    '^--idle-timeout$' { Need-Val '--idle-timeout' $i $argc; $idleTimeout = ConvertTo-Int $args[$i+1]; $i += 2; continue }
    '^--idle-timeout=(.*)' { $idleTimeout = ConvertTo-Int $matches[1]; $i += 1; continue }
    default            { $passArgs += $a; $i += 1 }
  }
}

if ($null -eq $prompt) {
  if (-not [Console]::IsInputRedirected) { Write-Error "cx-stream: no prompt. Use -p ""<prompt>"" or pipe via stdin."; exit 1 }
  $prompt = [Console]::In.ReadToEnd()
}
if ([string]::IsNullOrWhiteSpace($prompt)) { Write-Error "cx-stream: empty prompt — nothing to delegate."; exit 1 }

# The resume id becomes a session-dir path component → reject path traversal early.
if (-not [string]::IsNullOrEmpty($resumeId)) {
  if ($resumeId -match '[\\/]' -or $resumeId -match '\.\.') { Write-Error "cx-stream: invalid --resume id"; exit 1 }
}

# Make cwd absolute.
try { $cwd = (Resolve-Path -LiteralPath $cwd -ErrorAction Stop).Path } catch { Write-Error "cx-stream: bad --cwd"; exit 1 }

# ---- resolve the sandbox mode (explicit --sandbox wins; then --read-only; default workspace-write) ----
$sandboxMode = "workspace-write"
if ($readOnly -eq 1) { $sandboxMode = "read-only" }
if (-not [string]::IsNullOrEmpty($sandbox)) { $sandboxMode = $sandbox }

# ---- build the codex command (resume accepts a different flag set than plain exec) ----
$outFile = New-TemporaryFile
$resume = 0
if (-not [string]::IsNullOrEmpty($resumeId)) {
  $resume = 1
  # `codex exec resume` rejects -s/-C/--color → pass sandbox via -c sandbox_mode=, drop cwd/color.
  $codexArgs = @('exec', 'resume', '--json', '-o', $outFile.FullName, '--skip-git-repo-check')
  if (-not [string]::IsNullOrEmpty($model)) { $codexArgs += @('-m', $model) }
  $codexArgs += @('-c', "sandbox_mode=$sandboxMode")
  if ($passArgs.Count -gt 0) { $codexArgs += $passArgs }
  $codexArgs += @($resumeId, $prompt)
} else {
  $codexArgs = @('exec', '--json', '-o', $outFile.FullName, '--skip-git-repo-check', '--color', 'never', '-C', $cwd, '-s', $sandboxMode)
  if (-not [string]::IsNullOrEmpty($model)) { $codexArgs += @('-m', $model) }
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
$branch = (git -C $cwd rev-parse --abbrev-ref HEAD 2>$null)

[Console]::Error.WriteLine("cx-stream -> Codex (OpenAI Codex CLI) worker")
[Console]::Error.WriteLine("  cwd:     $cwd")
[Console]::Error.WriteLine("  sandbox: $sandboxMode")
if (-not [string]::IsNullOrEmpty($model)) { [Console]::Error.WriteLine("  model:   $model") }
if ($resume -eq 1) { [Console]::Error.WriteLine("  resume:  $resumeId") }
[Console]::Error.WriteLine("  dir:     $sessionDir")
[Console]::Error.WriteLine("  status:  $(Join-Path $sessionDir 'status.json')")

# ---- parser env ----
$env:CX_SESSION_DIR = $sessionDir
$env:CX_PROMPT_PREVIEW = $prompt.Substring(0, [Math]::Min(120, $prompt.Length))
$env:CX_CWD = $cwd
$env:CX_BRANCH = $branch
$env:CX_MODEL = $model
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
      $p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -and $_.CommandLine -match '\bexec\b' -and $_.CommandLine.Contains('--json') -and $_.Name -match 'codex' } |
           Select-Object -First 1
      if ($p) { $procId = $p.ProcessId; break }
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

# ---- run codex; its JSONL stdout → parser. Feed codex empty stdin so it doesn't block on
# "Reading additional input from stdin..." (the prompt is passed as the last positional). ----
$rc = 0
try {
  $null | & codex @codexArgs | & node $parser | Out-Null
  $rc = $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine("cx-stream: $($_.Exception.Message)")
  $rc = 1
}
if ($null -eq $rc) { $rc = 0 }

if ($watchJob) { Stop-Job $watchJob -ErrorAction SilentlyContinue; Remove-Job $watchJob -Force -ErrorAction SilentlyContinue }

# ---- reconcile a watchdog timeout (always a failure) ----
if (Test-Path $timeoutFile) {
  $reason = (Get-Content -Raw $timeoutFile).Trim()
  [Console]::Error.WriteLine("cx-stream: stopped by watchdog ($reason).")
  if ($rc -eq 0) { $rc = 124 }
}

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

# ---- print ONLY the final agent message on stdout (codex -o file; clean) ----
if ((Test-Path $outFile.FullName) -and (Get-Item $outFile.FullName).Length -gt 0) {
  Get-Content -Raw $outFile.FullName
}

Remove-Item -Force $timeoutFile -ErrorAction SilentlyContinue
Remove-Item -Force $outFile.FullName -ErrorAction SilentlyContinue
exit $rc
