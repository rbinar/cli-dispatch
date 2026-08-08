# resolve-plugin-root.ps1 — PowerShell twin of resolve-plugin-root.sh (issue #150).
#
# Prints the plugin root that setup/run should actually use: the newest of (the session's
# plugin root, the newest versioned cache dir carrying scripts/install.ps1). See the .sh twin
# for the full rationale — in short, `${CLAUDE_PLUGIN_ROOT}` is whatever version the running
# session loaded, and a plugin upgrade does not change it, so interpolating it into an install
# command can point the user at an OLD installer.
#
# usage: resolve-plugin-root.ps1 [-SessionRoot <path>]
#   stdout: the resolved plugin root
#   stderr: a one-line note when the resolved root differs from the session's
#   exit 0 on success, 1 when no usable root exists
[CmdletBinding()]
param(
  [string]$SessionRoot = $env:CLAUDE_PLUGIN_ROOT
)

$ErrorActionPreference = 'Stop'

$cacheDir = if ($env:CLI_DISPATCH_PLUGIN_CACHE_DIR) {
  $env:CLI_DISPATCH_PLUGIN_CACHE_DIR
} else {
  Join-Path $HOME '.claude\plugins\cache\cli-dispatch\cli-dispatch'
}

function Get-PluginVersion([string]$root) {
  if (-not $root) { return $null }
  $manifest = Join-Path $root '.claude-plugin\plugin.json'
  if (-not (Test-Path -LiteralPath $manifest)) { return $null }
  try { return (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version } catch { return $null }
}

# [version] parsing is the ordering authority; anything it rejects returns $null and can
# therefore never win a comparison, mirroring the bash twin's non-semver-is-never-older rule.
function ConvertTo-Semver([string]$s) {
  if (-not $s) { return $null }
  if ($s -notmatch '^\d+\.\d+\.\d+$') { return $null }
  try { return [version]$s } catch { return $null }
}

$newestVer = $null
$newestPath = $null
if (Test-Path -LiteralPath $cacheDir) {
  foreach ($d in Get-ChildItem -LiteralPath $cacheDir -Directory -ErrorAction SilentlyContinue) {
    if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'scripts\install.ps1'))) { continue }
    $v = ConvertTo-Semver $d.Name
    if ($null -eq $v) { continue }
    if ($null -eq $newestVer -or $v -gt $newestVer) { $newestVer = $v; $newestPath = $d.FullName }
  }
}

$resolved = $SessionRoot
if ($newestPath) {
  if (-not $resolved -or -not (Test-Path -LiteralPath $resolved)) {
    $resolved = $newestPath
  } else {
    $sessionVer = ConvertTo-Semver (Get-PluginVersion $resolved)
    if ($null -ne $sessionVer -and $sessionVer -lt $newestVer) {
      $resolved = $newestPath
      [Console]::Error.WriteLine("resolve-plugin-root: session plugin is $sessionVer but $newestVer is installed - using the newer copy at $resolved (restart Claude Code to load it for slash commands).")
    }
  }
}

if (-not $resolved -or -not (Test-Path -LiteralPath $resolved)) {
  [Console]::Error.WriteLine('resolve-plugin-root: no usable plugin root found.')
  exit 1
}

Write-Output $resolved
