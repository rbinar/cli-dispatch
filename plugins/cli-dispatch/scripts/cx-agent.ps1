#!/usr/bin/env pwsh
# cx-agent.ps1 — Windows/PowerShell variant of cx-agent: call the Codex worker like a subagent
# (ONE command, live progress, final answer). Synchronous wrapper over cx-stream.ps1.
# Default agentic (workspace-write in --cwd); pass --read-only for a REAL codex sandbox
# (-s read-only, no writes). Final answer -> stdout; live tool activity -> stderr.
$ErrorActionPreference = "Stop"

function Show-Usage { [Console]::Error.WriteLine('usage: cx-agent [--cwd <dir>] [--resume <id>] [--read-only] [--sandbox <mode>] [--model <m>] [--max-runtime <s>] [--idle-timeout <s>] [-q] "<task>"') }
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
    '^--cwd$'          { Need-Val '--cwd' $i $argc; $fwd += @('--cwd', $args[$i+1]); $i += 2; continue }
    '^--resume$'       { Need-Val '--resume' $i $argc; $fwd += @('--resume', $args[$i+1]); $i += 2; continue }
    '^--model$'        { Need-Val '--model' $i $argc; $fwd += @('--model', $args[$i+1]); $i += 2; continue }
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

if (-not $quiet) {
  [Console]::Error.WriteLine("> cx-agent -> Codex (OpenAI Codex CLI) worker")
  $env:CX_PROGRESS_STDERR = '1'
}

& cx-stream @fwd -p $task
exit $LASTEXITCODE
