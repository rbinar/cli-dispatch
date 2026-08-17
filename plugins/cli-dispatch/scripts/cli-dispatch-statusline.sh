#!/usr/bin/env bash
# cli-dispatch-statusline.sh — statusline FRAGMENT (caveman-statusline.sh pattern): a
# combining statusline wrapper pipes the Claude Code statusline stdin JSON to each
# fragment and joins the non-empty outputs. With Claude Code's snake_case session_id,
# this fragment prints a compact [CD] badge plus per-backend counts for workers spawned
# by this Claude Code session. Older callers without session_id retain the global ▶N
# counter. It prints NOTHING when inactive (the wrapper then skips it entirely).
#
# "Active" means: policy injection is enabled in policy.json, OR at least one applicable
# worker session is currently running. Wire it up by adding a fragment line to your combining
# ~/.claude/hooks/statusline.sh that globs this file from the plugin cache dir
# (hash/version-named, so glob — do not hardcode), e.g.:
#   CD_SCRIPT=$(ls "$CONFIG_DIR"/plugins/cache/cli-dispatch/cli-dispatch/*/scripts/cli-dispatch-statusline.sh 2>/dev/null | head -1)
#
# Statuslines re-run frequently: keep this cheap. status.json and meta.json are tiny;
# never read transcript.jsonl here.

# Drain stdin fully before inspecting it so the wrapper's pipe never sees SIGPIPE. Real
# Claude Code statusline JSON uses snake_case session_id. Deliberately do not recognize
# camelCase sessionId: callers without session_id must retain the legacy global behavior.
STATUSLINE_JSON=$(cat 2>/dev/null || true)
SESSION_ID=$(printf '%s\n' "$STATUSLINE_JSON" \
  | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | sed -n '1p')
SCOPED=0
[ -n "$SESSION_ID" ] && SCOPED=1

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
DS_RUNNING=0
AG_RUNNING=0
CX_RUNNING=0
OC_RUNNING=0
CP_RUNNING=0
if [ -d "$ROOT" ]; then
  # CLI_DISPATCH_NOW pins "now" so a test can assert the EXACT staleness boundary. Without it
  # a boundary fixture races real elapsed time: a session written at now-90 is read a second
  # later as 91 and drops out, so the ≤-boundary test failed intermittently under full-suite
  # load (and only that test — the 91s sibling stays excluded either way).
  NOW=${CLI_DISPATCH_NOW:-$(date +%s)}
  for _sf in "$ROOT"/*/status.json; do
    [ -f "$_sf" ] || continue
    grep -q '"state"[[:space:]]*:[[:space:]]*"running"' "$_sf" 2>/dev/null || continue
    # stat is not portable: BSD/macOS uses -f %m, GNU uses -c %Y.
    _mtime=$(stat -f %m "$_sf" 2>/dev/null || stat -c %Y "$_sf" 2>/dev/null || echo 0)
    [ "$_mtime" -gt 0 ] || continue
    [ "$((NOW - _mtime))" -le "$STALE_AFTER" ] || continue

    if [ "$SCOPED" -eq 0 ]; then
      RUNNING=$((RUNNING + 1))
      continue
    fi

    _mf="${_sf%/status.json}/meta.json"
    [ -f "$_mf" ] || continue
    _parent=$(sed -n 's/.*"parentSessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_mf" | sed -n '1p')
    [ "$_parent" = "$SESSION_ID" ] || continue

    RUNNING=$((RUNNING + 1))
    _backend=$(sed -n 's/.*"backend"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_mf" | sed -n '1p')
    case "$_backend" in
      deepseek|ds)       DS_RUNNING=$((DS_RUNNING + 1)) ;;
      antigravity|ag)    AG_RUNNING=$((AG_RUNNING + 1)) ;;
      codex|cx)          CX_RUNNING=$((CX_RUNNING + 1)) ;;
      opencode|oc)       OC_RUNNING=$((OC_RUNNING + 1)) ;;
      copilot|cp)        CP_RUNNING=$((CP_RUNNING + 1)) ;;
    esac
  done
fi

[ "$ENABLED" -eq 1 ] || [ "${RUNNING:-0}" -gt 0 ] || exit 0

BADGE=$'\033[36m[CD]\033[0m'
if [ "$SCOPED" -eq 1 ]; then
  GROUP=''
  for _entry in "ds:$DS_RUNNING" "ag:$AG_RUNNING" "cx:$CX_RUNNING" "oc:$OC_RUNNING" "cp:$CP_RUNNING"; do
    _count=${_entry#*:}
    [ "$_count" -gt 0 ] || continue
    [ -z "$GROUP" ] || GROUP="$GROUP,"
    GROUP="$GROUP$_entry"
  done
  [ -n "$GROUP" ] && BADGE="$BADGE"$'\033[33m'"($GROUP)"$'\033[0m'
elif [ "${RUNNING:-0}" -gt 0 ]; then
  BADGE="$BADGE"$'\033[33m'"▶${RUNNING}"$'\033[0m'
fi
printf '%s' "$BADGE"
