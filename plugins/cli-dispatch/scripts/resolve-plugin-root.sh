#!/usr/bin/env bash
# resolve-plugin-root.sh — print the plugin root that setup/run should actually use.
#
# Issue #150: `${CLAUDE_PLUGIN_ROOT}` is the version the RUNNING session loaded, which is not
# necessarily the newest version on disk — a plugin upgrade lands a new cache dir but the live
# session keeps executing the old one. A command that interpolates CLAUDE_PLUGIN_ROOT into an
# install path therefore tells the user to run an INSTALLER FROM AN OLD VERSION, and prints a
# hardcoded-looking stale version number while doing it (the reporter saw `3.30.1` while 4.16.0
# was active, and concluded 3.30.1 was what they had installed).
#
# Resolution: the newest of (the session's plugin root, the newest versioned cache dir that
# carries scripts/install.sh). Ties and unparseable versions keep the session's root, so a
# local dev checkout — whose path has no version dir at all — is never silently swapped for a
# cache copy.
#
# usage: resolve-plugin-root.sh [<session-plugin-root>]
#   stdout: the resolved plugin root (nothing if none could be resolved)
#   stderr: a one-line note when the resolved root differs from the session's
#   exit 0 on success, 1 when no usable root exists
set -euo pipefail

SESSION_ROOT="${1:-${CLAUDE_PLUGIN_ROOT:-}}"
CACHE_DIR="${CLI_DISPATCH_PLUGIN_CACHE_DIR:-$HOME/.claude/plugins/cache/cli-dispatch/cli-dispatch}"

plugin_version() {
  # Reads "version" out of <root>/.claude-plugin/plugin.json without needing node — this runs
  # from a slash command's pre-exec context where node may not have been probed yet.
  local root="$1"
  [ -n "$root" ] && [ -f "$root/.claude-plugin/plugin.json" ] || return 0
  grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$root/.claude-plugin/plugin.json" 2>/dev/null |
    head -1 | sed 's/.*"\([^"]*\)"[^"]*$/\1/'
}

# Returns 0 when $1 is strictly older than $2. Non-semver on either side -> not older, so an
# unparseable version can never trigger a swap.
semver_is_older() {
  local a="$1" b="$2"
  case "$a" in [0-9]*.[0-9]*.[0-9]*) ;; *) return 1 ;; esac
  case "$b" in [0-9]*.[0-9]*.[0-9]*) ;; *) return 1 ;; esac
  [ "$a" != "$b" ] && [ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -1)" = "$a" ]
}

NEWEST_VER=""
if [ -d "$CACHE_DIR" ]; then
  for d in "$CACHE_DIR"/*/; do
    [ -d "$d" ] || continue
    [ -f "$d/scripts/install.sh" ] || continue
    v="$(basename "$d")"
    case "$v" in [0-9]*.[0-9]*.[0-9]*) ;; *) continue ;; esac
    if [ -z "$NEWEST_VER" ] || semver_is_older "$NEWEST_VER" "$v"; then NEWEST_VER="$v"; fi
  done
fi

SESSION_VER="$(plugin_version "$SESSION_ROOT")"

RESOLVED="$SESSION_ROOT"
if [ -n "$NEWEST_VER" ]; then
  if [ -z "$RESOLVED" ] || [ ! -d "$RESOLVED" ]; then
    RESOLVED="$CACHE_DIR/$NEWEST_VER"
  elif semver_is_older "$SESSION_VER" "$NEWEST_VER"; then
    RESOLVED="$CACHE_DIR/$NEWEST_VER"
    echo "resolve-plugin-root: session plugin is $SESSION_VER but $NEWEST_VER is installed — using the newer copy at $RESOLVED (restart Claude Code to load it for slash commands)." >&2
  fi
fi

[ -n "$RESOLVED" ] && [ -d "$RESOLVED" ] || { echo "resolve-plugin-root: no usable plugin root found." >&2; exit 1; }
printf '%s\n' "$RESOLVED"
