---
description: Schedule (or remove) an automatic daily cleanup of stale worker dirs via the OS scheduler
allowed-tools: Bash
argument-hint: "[install|status|uninstall] [--time HH:MM] [--older-than DAYS]"
---

# cli-dispatch clean-schedule

Register a **daily, OS-level** auto-clean that runs `cli-dispatch-clean --remove` in the
background — so stale worker dirs (a `running` session whose process died before finalize)
are pruned automatically, even when Claude Code isn't open. Uses **launchd** (macOS),
**cron** (Linux/WSL), or **Scheduled Tasks** (Windows). No cloud agent, no tokens.

Args (`$ARGUMENTS`): action `install` (default) | `status` | `uninstall`; `--time HH:MM`
(default `03:00`); `--older-than DAYS` (also prune old finished sessions; default off → stale
only). It only ever removes **stale** dirs (idle > 600 s while `running`); a live worker is
never touched. The job logs to `~/.cache/cli-dispatch/clean.log`.

Prereq: `cli-dispatch-clean` installed on PATH (it is, via `/cli-dispatch:setup`). Pick the
block for the current OS.

## macOS (launchd)

```bash
ACTION="install"; TIME="03:00"; OLDER=""
set -- $ARGUMENTS
while [ "$#" -gt 0 ]; do case "$1" in
  install|status|uninstall) ACTION="$1"; shift;;
  --time) TIME="$2"; shift 2;;
  --older-than) OLDER="$2"; shift 2;;
  *) shift;; esac; done
LABEL="com.cli-dispatch.clean"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BIN="$(command -v cli-dispatch-clean || echo "$HOME/.local/bin/cli-dispatch-clean")"
HH="${TIME%%:*}"; MM="${TIME##*:}"; HH="${HH#0}"; MM="${MM#0}"; HH="${HH:-0}"; MM="${MM:-0}"
LOG="$HOME/.cache/cli-dispatch/clean.log"; mkdir -p "$(dirname "$LOG")"
OLDER_ARG=""; [ -n "$OLDER" ] && OLDER_ARG="<string>--older-than</string><string>$OLDER</string>"
case "$ACTION" in
  status)
    if [ -f "$PLIST" ]; then echo "scheduled (launchd): $PLIST"; launchctl list | grep -F "$LABEL" || echo "(loaded state unknown)"; echo "--- last log ---"; tail -n 8 "$LOG" 2>/dev/null || echo "(no log yet)"
    else echo "not scheduled."; fi;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "removed schedule ($LABEL).";;
  install)
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string><string>--remove</string><string>--quiet</string>$OLDER_ARG</array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HH</integer><key>Minute</key><integer>$MM</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
    launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"
    echo "scheduled daily at $TIME (launchd: $PLIST). Log: $LOG";;
esac
```

## Linux / WSL (cron)

```bash
ACTION="install"; TIME="03:00"; OLDER=""
set -- $ARGUMENTS
while [ "$#" -gt 0 ]; do case "$1" in
  install|status|uninstall) ACTION="$1"; shift;;
  --time) TIME="$2"; shift 2;;
  --older-than) OLDER="$2"; shift 2;;
  *) shift;; esac; done
BIN="$(command -v cli-dispatch-clean || echo "$HOME/.local/bin/cli-dispatch-clean")"
HH="${TIME%%:*}"; MM="${TIME##*:}"; HH="${HH#0}"; MM="${MM#0}"; HH="${HH:-0}"; MM="${MM:-0}"
LOG="$HOME/.cache/cli-dispatch/clean.log"; mkdir -p "$(dirname "$LOG")"
TAG="# cli-dispatch-clean"
OLDER_ARG=""; [ -n "$OLDER" ] && OLDER_ARG=" --older-than $OLDER"
LINE="$MM $HH * * * $BIN --remove --quiet$OLDER_ARG >> $LOG 2>&1 $TAG"
EXIST="$(crontab -l 2>/dev/null || true)"
case "$ACTION" in
  status)
    printf '%s\n' "$EXIST" | grep -F "$TAG" && { echo "--- last log ---"; tail -n 8 "$LOG" 2>/dev/null; } || echo "not scheduled.";;
  uninstall)
    printf '%s\n' "$EXIST" | grep -vF "$TAG" | crontab - ; echo "removed schedule.";;
  install)
    { printf '%s\n' "$EXIST" | grep -vF "$TAG"; echo "$LINE"; } | crontab -
    echo "scheduled daily at $TIME (cron). Log: $LOG";;
esac
```

## Windows (Scheduled Tasks)

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

After install, confirm with the same command + `status`. To stop it: `... uninstall`.
