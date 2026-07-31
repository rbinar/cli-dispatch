# Installation status for cli-dispatch on native Windows.
#
# Twin of cli-dispatch-status.sh. Runs from the plugin cache, not ~/.local/bin.
# Only DeepSeek and Codex run natively on Windows; the Antigravity, OpenCode and
# Copilot backends are Unix-only, so they are not probed here.
#
# Read-only. Never prints a key VALUE, only whether one is set.
#
# Takes the plugin root as an optional first argument, mirroring the bash twin's
# $1 — the env var alone is not reliable (see cli-dispatch-status.sh's header).

param([string]$PluginRoot = $env:CLAUDE_PLUGIN_ROOT)

# Version staleness check
$pluginJson = if ($PluginRoot) { Join-Path $PluginRoot '.claude-plugin/plugin.json' } else { '' }
$installedVerFile = Join-Path $HOME '.config/cli-dispatch/.installed-version'
if ($pluginJson -and (Test-Path $installedVerFile) -and (Test-Path $pluginJson)) {
  try {
    $installedVer = (Get-Content -Raw $installedVerFile).Trim()
    $currentVer = (Get-Content -Raw $pluginJson | ConvertFrom-Json).version
    if ($installedVer -and $currentVer -and $installedVer -ne $currentVer) {
      "WARNING: installed copies are stale (installed: $installedVer, current: $currentVer) — re-run /cli-dispatch:setup"
    }
  } catch {}
}
if (Get-Command claude-ds -ErrorAction SilentlyContinue) { 'wrapper: installed' } else { 'wrapper: MISSING' }
if (Get-Command claude-ds-stream -ErrorAction SilentlyContinue) { 'stream wrapper: installed' } else { 'stream wrapper: MISSING' }
$cfg = if ($env:CLI_DISPATCH_CONFIG) { $env:CLI_DISPATCH_CONFIG } elseif ($env:CLAUDE_DS_CONFIG) { $env:CLAUDE_DS_CONFIG } elseif (Test-Path (Join-Path $HOME '.config/cli-dispatch/config')) { Join-Path $HOME '.config/cli-dispatch/config' } else { Join-Path $HOME '.config/claude-ds/config' }
if (Test-Path $cfg) { if ((Get-Content $cfg -Raw) -match 'DEEPSEEK_API_KEY="..*"') { 'key: set' } else { 'key: MISSING' } } else { 'config: MISSING' }
if (Get-Command claude -ErrorAction SilentlyContinue) { 'claude CLI: found' } else { 'claude CLI: MISSING' }
if (Get-Command node -ErrorAction SilentlyContinue) { 'node: found' } else { 'node: MISSING (claude-ds-stream needs it)' }
