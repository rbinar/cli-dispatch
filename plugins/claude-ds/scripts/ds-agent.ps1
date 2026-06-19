#!/usr/bin/env pwsh
# ds-agent — call claude-ds (DeepSeek) like a subagent: ONE command, live progress, final answer.
# Synchronous wrapper over claude-ds-stream. Default agentic (may write/run in --cwd);
# pass --read-only for analysis-only. Final answer -> stdout; live tool activity -> stderr.
$ErrorActionPreference = "Stop"

function Show-Usage { [Console]::Error.WriteLine('usage: ds-agent [--read-only] [--cwd <dir>] [--resume <id>] [--max-runtime <s>] [--idle-timeout <s>] [-q] "<task>"') }
function Need-Val($name, $idx, $argc) { if ($idx + 1 -ge $argc) { [Console]::Error.WriteLine("ds-agent: $name requires a value."); exit 1 } }

$quiet = $false
$agentic = $true
$task = $null
$fwd = @()
$i = 0
$argc = $args.Count
while ($i -lt $argc) {
  $a = $args[$i]
  switch -Regex ($a) {
    '^--read-only$'    { $agentic = $false; $fwd += '--read-only'; $i += 1; continue }
    '^--cwd$'          { Need-Val '--cwd' $i $argc; $fwd += @('--cwd', $args[$i+1]); $i += 2; continue }
    '^--resume$'       { Need-Val '--resume' $i $argc; $fwd += @('--resume', $args[$i+1]); $i += 2; continue }
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
if ($agentic) { $fwd += '--dangerously-skip-permissions' }

if (-not $quiet) {
  $mode = if ($agentic) { 'agentic: may modify cwd' } else { 'read-only' }
  [Console]::Error.WriteLine("> ds-agent -> claude-ds (DeepSeek) [$mode]")
  $env:CLAUDE_DS_PROGRESS_STDERR = '1'
}

& claude-ds-stream @fwd -p $task
exit $LASTEXITCODE
