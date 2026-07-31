---
description: Schedule (or remove) an automatic daily cleanup of stale worker dirs via the OS scheduler
allowed-tools: Bash
argument-hint: "[install|status|uninstall] [--time HH:MM] [--older-than DAYS]"
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-clean-schedule.sh" status`

The block above is the **current schedule state only** — it was pre-executed as a
read-only `status` probe. It did NOT install or remove anything, whatever
`$ARGUMENTS` says.

# cli-dispatch clean-schedule

Registers a **daily, OS-level** auto-clean that runs `cli-dispatch-clean --remove`
in the background, so stale worker dirs (a `running` session whose process died
before finalize) are pruned even when Claude Code isn't open. launchd on macOS,
cron on Linux/WSL. No cloud agent, no tokens. It only ever removes **stale** dirs
(idle > 600 s while `running`); a live worker is never touched. The job logs to
`~/.cache/cli-dispatch/clean.log`.

## What to do now

Read the action out of `$ARGUMENTS`: `install` (the command's default when no
action is given) | `status` | `uninstall`, plus optional `--time HH:MM` (default
`03:00`) and `--older-than DAYS` (also prune old finished sessions; default off →
stale only).

- **Action is `status`** — you already have the answer above. Report it and stop.
- **Action is `install` or `uninstall`** — this mutates the OS scheduler, so run
  it as a deliberate step, forwarding the user's arguments verbatim:

  ```bash
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-clean-schedule.sh" $ARGUMENTS
  ```

  If `$ARGUMENTS` carries no action word, pass `install` explicitly — the script's
  own default is `status` precisely so that a bare run can never write a plist or
  rewrite a crontab.

Prereq: `cli-dispatch-clean` on PATH (it is, via `/cli-dispatch:setup`). After an
install, confirm with the same command + `status`. To stop it: `... uninstall`.

## Native Windows only (Scheduled Tasks)

The bash script covers macOS and Linux/WSL. On native Windows use this instead:

```powershell
$parts = "$env:ARGUMENTS".Trim() -split '\s+'
$action = 'install'; $time = '03:00'; $older = ''
for ($i = 0; $i -lt $parts.Count; $i++) { switch ($parts[$i]) {
  { $_ -in 'install','status','uninstall' } { $action = $_ }
  '--time' { $time = $parts[++$i] }
  '--older-than' { $older = $parts[++$i] } } }
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
```
