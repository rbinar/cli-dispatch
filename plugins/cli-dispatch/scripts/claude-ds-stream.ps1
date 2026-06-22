#!/usr/bin/env pwsh
# claude-ds-stream.ps1 — the Windows/PowerShell variant of claude-ds-stream.
# Runs claude with the DeepSeek env in stream-json format and pipes stdout into
# ds-stream-parse.mjs. The parser .mjs is shared cross-platform.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$Config = if ($env:CLAUDE_DS_CONFIG) { $env:CLAUDE_DS_CONFIG } else { Join-Path $HOME ".config/claude-ds/config" }
$cfg = @{}
if (Test-Path $Config) {
  Get-Content $Config | ForEach-Object {
    # -cmatch (case-sensitive): config keys are uppercase, and a case-insensitive
    # match miscompares the 'I' in DEEPSEEK_API_KEY under tr-TR locale (dotless-i
    # case folding => the key line never matches => "DEEPSEEK_API_KEY not set").
    if ($_ -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') { $cfg[$matches[1]] = $matches[2] }
  }
}

$key = $cfg["DEEPSEEK_API_KEY"]
if ([string]::IsNullOrEmpty($key)) {
  Write-Error "claude-ds-stream: DEEPSEEK_API_KEY not set. Add it to $Config (run /cli-dispatch:ds-setup)."
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "claude-ds-stream: 'node' not found in PATH (required for the stream parser)."
  exit 1
}

# Resolve the parser path.
$parser = $env:CLAUDE_DS_PARSER
if ([string]::IsNullOrEmpty($parser)) {
  foreach ($cand in @(
    (Join-Path $HOME ".local/share/claude-ds/ds-stream-parse.mjs"),
    (Join-Path $ScriptDir "ds-stream-parse.mjs")
  )) {
    if (Test-Path $cand) { $parser = $cand; break }
  }
}
if ([string]::IsNullOrEmpty($parser) -or -not (Test-Path $parser)) {
  Write-Error "claude-ds-stream: ds-stream-parse.mjs not found (set CLAUDE_DS_PARSER)."
  exit 1
}

# Safe integer parse (non-numeric / null -> 0).
function ConvertTo-Int($v) { $n = 0; if ([int]::TryParse("$v", [ref]$n)) { return $n } return 0 }

# ---- parse arguments ----
$cwd = (Get-Location).Path
$resumeId = ""
$prompt = $null
$readOnly = 0
$maxRuntime = ConvertTo-Int $env:CLAUDE_DS_MAX_RUNTIME    # seconds; 0 = no overall cap
$idleTimeout = ConvertTo-Int $env:CLAUDE_DS_IDLE_TIMEOUT  # seconds; 0 = no idle cap
$passArgs = @()
# Guard value-consuming flags ($argc/$idx passed in — $args inside a function would
# refer to the function's own args, not the script's).
function Need-Val($name, $idx, $argc) {
  if ($idx + 1 -ge $argc) { Write-Error "claude-ds-stream: $name requires a value."; exit 1 }
}
$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--cwd$'      { Need-Val '--cwd' $i $argc; $cwd = $args[$i+1]; $i += 2; continue }
    '^--cwd=(.*)'  { $cwd = $matches[1]; $i += 1; continue }
    '^--resume$'   { Need-Val '--resume' $i $argc; $resumeId = $args[$i+1]; $i += 2; continue }
    '^--resume=(.*)' { $resumeId = $matches[1]; $i += 1; continue }
    '^(-p|--prompt)$' { Need-Val $a $i $argc; $prompt = $args[$i+1]; $i += 2; continue }
    '^--prompt=(.*)' { $prompt = $matches[1]; $i += 1; continue }
    '^--read-only$' { $readOnly = 1; $i += 1; continue }
    '^--max-runtime$'  { Need-Val '--max-runtime' $i $argc;  $maxRuntime = ConvertTo-Int $args[$i+1]; $i += 2; continue }
    '^--max-runtime=(.*)'  { $maxRuntime = ConvertTo-Int $matches[1]; $i += 1; continue }
    '^--idle-timeout$' { Need-Val '--idle-timeout' $i $argc; $idleTimeout = ConvertTo-Int $args[$i+1]; $i += 2; continue }
    '^--idle-timeout=(.*)' { $idleTimeout = ConvertTo-Int $matches[1]; $i += 1; continue }
    default        { $passArgs += $a; $i += 1 }
  }
}

if ($null -eq $prompt) {
  if (-not [Console]::IsInputRedirected) {
    Write-Error "claude-ds-stream: no prompt. Use -p ""<prompt>"" or pipe via stdin."
    exit 1
  }
  $prompt = [Console]::In.ReadToEnd()
}

# ---- prepare the session directory ----
$sessionsRoot = $env:CLAUDE_DS_SESSIONS_DIR
if ([string]::IsNullOrEmpty($sessionsRoot)) {
  $cacheRoot = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
  $sessionsRoot = Join-Path $cacheRoot "claude-ds/sessions"
}
$resume = 0
if (-not [string]::IsNullOrEmpty($resumeId)) {
  $sid = $resumeId; $resume = 1
} else {
  $sid = [guid]::NewGuid().ToString()
}
$sessionDir = Join-Path $sessionsRoot $sid
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null

$branch = (git -C $cwd rev-parse --abbrev-ref HEAD 2>$null)
$model = if ($cfg["DS_MODEL"]) { $cfg["DS_MODEL"] } else { "deepseek-v4-pro" }
$flash = if ($cfg["DS_FLASH_MODEL"]) { $cfg["DS_FLASH_MODEL"] } else { "deepseek-v4-flash" }

[Console]::Error.WriteLine("claude-ds session: $sid")
[Console]::Error.WriteLine("  cwd:    $cwd")
[Console]::Error.WriteLine("  dir:    $sessionDir")
[Console]::Error.WriteLine("  status: $(Join-Path $sessionDir 'status.json')")

# ---- DeepSeek env ----
$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = $key
$env:ANTHROPIC_MODEL = $model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $model
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $flash
$env:CLAUDE_CODE_SUBAGENT_MODEL = $flash

# ---- parser env ----
$env:CLAUDE_DS_SESSION_DIR = $sessionDir
$env:CLAUDE_DS_PROMPT_PREVIEW = $prompt.Substring(0, [Math]::Min(120, $prompt.Length))
$env:CLAUDE_DS_CWD = $cwd
$env:CLAUDE_DS_BRANCH = $branch
$env:CLAUDE_DS_MODEL = $model
$env:CLAUDE_DS_RESUME = "$resume"

# ---- claude arguments (buildClaudeArgs core) ----
$claudeArgs = @(
  "--print",
  "--output-format", "stream-json",
  "--include-partial-messages",
  "--verbose",
  "--permission-mode", "bypassPermissions",
  # Don't inherit the user's global ~/.claude MCP servers into the worker; pass
  # --mcp-config <file> to add servers deliberately (strict honors that).
  "--strict-mcp-config",
  "--add-dir", $cwd
)
if ($resume -eq 1) { $claudeArgs += @("--resume", $sid) } else { $claudeArgs += @("--session-id", $sid) }
# --read-only: restrict to a read-only tool set. --tools REPLACES the built-in set, so
# Write/Edit/Bash are unavailable even under bypassPermissions (--disallowed-tools does
# NOT work here — bypassPermissions skips the permission system deny rules live in).
if ($readOnly -eq 1) { $claudeArgs += @("--tools", "Read,Grep,Glob") }
if ($passArgs.Count -gt 0) { $claudeArgs += $passArgs }

# Optional safety net: a background-job watchdog kills the worker (and its child tree via
# taskkill /T /F) if it exceeds the runtime cap or stalls. We can't capture the worker's PID
# mid-pipe in PowerShell, so the watchdog locates it by its unique --session-id value +
# stream-json invocation in the process command line. Mirrors the bash watchdog.
$timeoutFile = Join-Path $sessionDir '.timeout'
Remove-Item -Force $timeoutFile -ErrorAction SilentlyContinue
$watchJob = $null
if ($maxRuntime -gt 0 -or $idleTimeout -gt 0) {
  [Console]::Error.WriteLine("  guard:  max-runtime=${maxRuntime}s idle-timeout=${idleTimeout}s")
  $watchJob = Start-Job -ScriptBlock {
    param($sid, $sessionDir, $maxRuntime, $idleTimeout)
    $start = Get-Date
    $transcript = Join-Path $sessionDir 'transcript.jsonl'
    $tf = Join-Path $sessionDir '.timeout'
    $procId = $null
    for ($n = 0; $n -lt 160; $n++) {
      $p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -and $_.CommandLine.Contains($sid) -and $_.CommandLine.Contains('stream-json') } |
           Select-Object -First 1
      if ($p) { $procId = $p.ProcessId; break }
      Start-Sleep -Milliseconds 250
    }
    if (-not $procId) { return }
    while (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Start-Sleep -Seconds 2
      $now = Get-Date
      if ($maxRuntime -gt 0 -and ($now - $start).TotalSeconds -ge $maxRuntime) {
        Set-Content -Path $tf -Value "runtime ${maxRuntime}s"
        & taskkill /PID $procId /T /F 2>$null | Out-Null
        return
      }
      if ($idleTimeout -gt 0) {
        $m = $start
        try { $m = (Get-Item $transcript -ErrorAction Stop).LastWriteTime } catch {}
        if (($now - $m).TotalSeconds -ge $idleTimeout) {
          Set-Content -Path $tf -Value "idle ${idleTimeout}s"
          & taskkill /PID $procId /T /F 2>$null | Out-Null
          return
        }
      }
    }
  } -ArgumentList $sid, $sessionDir, $maxRuntime, $idleTimeout
}

# Run claude with its working directory set to $cwd (not just --add-dir allow-listed),
# so relative work lands there — matching octo-ai's spawn({ cwd }). Parser/session paths
# are absolute, so this doesn't affect where the session files are written.
Set-Location -LiteralPath $cwd

# Prompt via stdin; claude stdout into the parser.
$prompt | & claude @claudeArgs | & node $parser
$rc = $LASTEXITCODE

if ($watchJob) { Stop-Job $watchJob -ErrorAction SilentlyContinue; Remove-Job $watchJob -Force -ErrorAction SilentlyContinue }

# Reconcile a timeout kill into the session state (mirrors the bash wrapper).
if (Test-Path $timeoutFile) {
  $env:CLAUDE_DS_RECON_DIR = $sessionDir
  $env:CLAUDE_DS_RECON_ERR = "timeout: " + ((Get-Content -Raw $timeoutFile).Trim())
  node -e "const fs=require('fs'),p=require('path');const d=process.env.CLAUDE_DS_RECON_DIR,err=process.env.CLAUDE_DS_RECON_ERR;for(const f of ['status.json','meta.json']){const fp=p.join(d,f);try{const o=JSON.parse(fs.readFileSync(fp,'utf8'));o.state='error';o.error=err;fs.writeFileSync(fp,JSON.stringify(o,null,2)+String.fromCharCode(10))}catch(e){}}"
  Remove-Item -Force $timeoutFile -ErrorAction SilentlyContinue
  exit 143
}
exit $rc
