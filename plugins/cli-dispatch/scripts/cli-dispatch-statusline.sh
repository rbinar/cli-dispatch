#!/usr/bin/env bash
# cli-dispatch-statusline.sh — statusline FRAGMENT (caveman-statusline.sh pattern): a
# combining statusline wrapper pipes the Claude Code statusline stdin JSON to each
# fragment and joins the non-empty outputs. This fragment prints a compact [CD] badge
# when cli-dispatch is active, plus a ▶N counter while N worker sessions are running —
# and prints NOTHING when inactive (the wrapper then skips it entirely).
#
# "Active" means: policy injection is enabled in policy.json, OR at least one worker
# session is currently running. Wire it up by adding a fragment line to your combining
# ~/.claude/hooks/statusline.sh that globs this file from the plugin cache dir
# (hash/version-named, so glob — do not hardcode), e.g.:
#   CD_SCRIPT=$(ls "$CONFIG_DIR"/plugins/cache/cli-dispatch/cli-dispatch/*/scripts/cli-dispatch-statusline.sh 2>/dev/null | head -1)
#
# Statuslines re-run frequently: keep this cheap. status.json files are tiny and the
# grep below touches nothing else — never read transcript.jsonl here.

# stdin carries the statusline JSON; this fragment doesn't need it, but drain it so the
# wrapper's pipe never sees SIGPIPE.
cat >/dev/null 2>&1 || true

# Session-dir root resolution — same order as watch/resume/kill/sessions/gain/clean/wait:
# CLI_DISPATCH_SESSIONS_DIR env override → ~/.cache/cli-dispatch/sessions → legacy claude-ds.
ROOT="${CLI_DISPATCH_SESSIONS_DIR:-}"
if [ -z "$ROOT" ]; then
  ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions"
  [ -d "$ROOT" ] || ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions"
fi

POLICY="${CLI_DISPATCH_POLICY_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/cli-dispatch/policy.json}"
ENABLED=0
[ -f "$POLICY" ] && grep -q '"enabled"[[:space:]]*:[[:space:]]*true' "$POLICY" 2>/dev/null && ENABLED=1

# Count only sessions that are running AND still alive. `state: running` alone is not
# liveness: a crashed worker keeps that state until `cli-dispatch-clean` sweeps it, which
# would pin a permanent phantom "▶1" in the statusline. Use the same staleness signal the
# rest of the repo uses — status.json mtime (dashboard-server.mjs: 90s; clean: staleSecs).
STALE_AFTER=90
RUNNING=0
if [ -d "$ROOT" ]; then
  NOW=$(date +%s)
  for _sf in "$ROOT"/*/status.json; do
    [ -f "$_sf" ] || continue
    grep -q '"state"[[:space:]]*:[[:space:]]*"running"' "$_sf" 2>/dev/null || continue
    # stat is not portable: BSD/macOS uses -f %m, GNU uses -c %Y.
    _mtime=$(stat -f %m "$_sf" 2>/dev/null || stat -c %Y "$_sf" 2>/dev/null || echo 0)
    [ "$_mtime" -gt 0 ] || continue
    [ "$((NOW - _mtime))" -le "$STALE_AFTER" ] && RUNNING=$((RUNNING + 1))
  done
fi

[ "$ENABLED" -eq 1 ] || [ "${RUNNING:-0}" -gt 0 ] || exit 0

BADGE=$'\033[36m[CD]\033[0m'
[ "${RUNNING:-0}" -gt 0 ] && BADGE="$BADGE"$'\033[33m'"▶${RUNNING}"$'\033[0m'
printf '%s' "$BADGE"
