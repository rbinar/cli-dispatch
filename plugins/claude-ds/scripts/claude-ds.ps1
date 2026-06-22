#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

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
  Write-Error "claude-ds: DEEPSEEK_API_KEY not set. Add it to $Config (run /claude-ds:setup)."
  exit 1
}

$model = if ($cfg["DS_MODEL"]) { $cfg["DS_MODEL"] } else { "deepseek-v4-pro" }
$flash = if ($cfg["DS_FLASH_MODEL"]) { $cfg["DS_FLASH_MODEL"] } else { "deepseek-v4-flash" }

$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = $key
$env:ANTHROPIC_MODEL = $model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $model
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $flash
$env:CLAUDE_CODE_SUBAGENT_MODEL = $flash

& claude @args
exit $LASTEXITCODE
