#!/usr/bin/env bash
# Daily OS-level auto-clean of stale worker dirs: install | status | uninstall.
# Picks launchd (macOS) or cron (Linux/WSL) from `uname`. Native Windows is not
# handled here — commands/clean-schedule.md keeps the Scheduled Tasks block.
#
# Runs straight from the plugin cache via commands/clean-schedule.md — it is NOT
# installed into ~/.local/bin (same arrangement as cli-dispatch-status.sh).
#
# Usage: cli-dispatch-clean-schedule.sh [install|status|uninstall] [--time HH:MM] [--older-than DAYS]
#
# The default action is **status**, not install: this script is reachable from a
# `!` pre-execution line, which runs before the model sees anything and therefore
# has no opportunity to confirm. A bare invocation must never write a plist or
# rewrite a crontab. The COMMAND still documents `install` as its default — the
# markdown passes it explicitly when the user asked for one.

ACTION="status"; TIME="03:00"; OLDER=""
while [ "$#" -gt 0 ]; do case "$1" in
  install|status|uninstall) ACTION="$1"; shift;;
  --time) TIME="$2"; shift 2;;
  --older-than) OLDER="$2"; shift 2;;
  *) shift;; esac; done

BIN="$(command -v cli-dispatch-clean || echo "$HOME/.local/bin/cli-dispatch-clean")"
HH="${TIME%%:*}"; MM="${TIME##*:}"; HH="${HH#0}"; MM="${MM#0}"; HH="${HH:-0}"; MM="${MM:-0}"
LOG="$HOME/.cache/cli-dispatch/clean.log"; mkdir -p "$(dirname "$LOG")"

case "$(uname -s)" in
  Darwin) SCHEDULER="launchd" ;;
  Linux|*BSD|CYGWIN*|MINGW*|MSYS*) SCHEDULER="cron" ;;
  *) SCHEDULER="cron" ;;
esac
echo "scheduler: $SCHEDULER   action: $ACTION"

if [ "$SCHEDULER" = "launchd" ]; then
  LABEL="com.cli-dispatch.clean"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  OLDER_ARG=""; [ -n "$OLDER" ] && OLDER_ARG="<string>--older-than</string><string>$OLDER</string>"
  case "$ACTION" in
    status)
      if [ -f "$PLIST" ]; then
        echo "scheduled (launchd): $PLIST"
        launchctl list | grep -F "$LABEL" || echo "(loaded state unknown)"
        echo "--- last log ---"; tail -n 8 "$LOG" 2>/dev/null || echo "(no log yet)"
      else echo "not scheduled."; fi;;
    uninstall)
      launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "removed schedule ($LABEL).";;
    install)
      # launchd runs jobs with a minimal PATH (no shell rc sourced) — a node installed via nvm/
      # Homebrew/volta/asdf is invisible there even though it resolves fine interactively, which
      # made the scheduled clean silently fail every run for anyone not on system node. Bake the
      # resolved node dir into the job's own PATH; cli-dispatch-clean also probes common install
      # locations at runtime as a second line of defense.
      NODE_DIR="$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)")"
      JOB_PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      mkdir -p "$(dirname "$PLIST")"
      cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string><string>--remove</string><string>--quiet</string>$OLDER_ARG</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$JOB_PATH</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HH</integer><key>Minute</key><integer>$MM</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
      launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"
      echo "scheduled daily at $TIME (launchd: $PLIST). Log: $LOG";;
  esac
else
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
fi
