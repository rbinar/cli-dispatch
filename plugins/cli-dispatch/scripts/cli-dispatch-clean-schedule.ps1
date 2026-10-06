# Native-Windows twin of cli-dispatch-clean-schedule.sh: a daily Scheduled Task that runs
# `cli-dispatch-clean --remove --quiet`. Runs from the plugin dir via commands/clean.md
# (`--schedule`) and is not installed, like its bash twin.
#
# Usage: cli-dispatch-clean-schedule.ps1 [install|status|uninstall] [--time HH:MM] [--older-than DAYS]
# The default action is status, so a bare run can never create a task.
$action = 'status'; $time = '03:00'; $older = ''
for ($i = 0; $i -lt $args.Count; $i++) { switch ($args[$i]) {
  { $_ -in 'install','status','uninstall' } { $action = $_ }
  '--time' { $time = $args[++$i] }
  '--older-than' { $older = $args[++$i] } } }
$name = 'cli-dispatch-clean'
$bin = (Get-Command cli-dispatch-clean.cmd -ErrorAction SilentlyContinue).Source
if (-not $bin) { $bin = Join-Path $HOME '.local/bin/cli-dispatch-clean.cmd' }
$argline = '--remove --quiet'; if ($older) { $argline += " --older-than $older" }
switch ($action) {
  'status'    { schtasks /Query /TN $name /V /FO LIST 2>$null; if ($LASTEXITCODE -ne 0) { 'not scheduled.' } }
  'uninstall' { schtasks /Delete /TN $name /F 2>$null; 'removed schedule.' }
  'install'   {
    schtasks /Create /TN $name /TR "`"$bin`" $argline" /SC DAILY /ST $time /F | Out-Null
    "scheduled daily at $time (Scheduled Task: $name)."
  }
}
