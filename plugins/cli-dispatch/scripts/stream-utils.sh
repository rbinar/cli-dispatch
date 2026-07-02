# stream-utils.sh — shared helpers for worker stream wrappers.
#
# Source this file from the stream scripts (ag-stream, cx-stream, claude-ds-stream)
# to avoid duplicating process-tree management, config resolution, and session-root
# resolution across backends.
#
# Usage:
#   . "$(dirname "${BASH_SOURCE[0]}")/stream-utils.sh"

# ---- cross-platform mtime ----
mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }

# ---- process-tree helpers ----

# Recursive kill by PID (leaves-first).
kill_tree() {
  local pid="$1" sig="${2:--TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child" "$sig"; done
  kill "$sig" "$pid" 2>/dev/null || true
}

# Snapshot a pid + all descendants (newline-separated, numeric → safe to word-split).
proc_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do proc_tree "$child"; done
  printf '%s\n' "$pid"
}

# Hard-kill the worker subtree. CRITICAL: some workers (e.g. agy) ignore SIGTERM and
# reparent to init once their parent dies, so a naive "TERM then KILL" misses them.
# Snapshot the whole subtree FIRST, TERM it (graceful for well-behaved children), then
# KILL the SAME captured pids — so reparented processes are not missed.
# (bash-3.2 safe: no mapfile.)
kill_worker() {
  local root="$1" tree p
  tree="$(proc_tree "$root")"
  for p in $tree; do kill -TERM "$p" 2>/dev/null || true; done
  sleep 3
  for p in $tree; do kill -KILL "$p" 2>/dev/null || true; done
}

# ---- config resolution ----

# Resolve and source the cli-dispatch config file (env wins; legacy claude-ds fallback).
# Sets variables from the config into the caller's scope.
source_config() {
  local config="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"
  if [ -z "$config" ]; then
    config="$HOME/.config/cli-dispatch/config"
    [ -f "$config" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || config="$HOME/.config/claude-ds/config"
  fi
  if [ -f "$config" ]; then
    # shellcheck disable=SC1090
    . "$config"
  fi
}

# ---- sessions-root resolution ----

# Resolve the sessions root directory (env wins; legacy claude-ds fallback).
# Prints the resolved path to stdout.
resolve_sessions_root() {
  local root="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
  if [ -z "$root" ]; then
    local _c="${XDG_CACHE_HOME:-$HOME/.cache}"
    root="$_c/cli-dispatch/sessions"
    [ -d "$root" ] || [ ! -d "$_c/claude-ds/sessions" ] || root="$_c/claude-ds/sessions"
  fi
  printf '%s' "$root"
}

# ---- JSON helpers ----

# json_field <file> <key> — print the top-level string field <key> from the JSON in <file>,
# or empty on ANY error (missing file, bad JSON, absent/non-string key). <key> is looked up
# via bracket access (s[key]), so it works for both fixed field names ("state", "error",
# "threadId") and dynamic keys (e.g. an absolute-path key in last_conversations.json).
# NOTE: top-level access only — this cannot express nested paths (s.a.b); leave those inline.
json_field() {
  node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(s[process.argv[2]]||"")}catch{}' "$1" "$2" 2>/dev/null
}

# ---- turn-error surfacing ----

# surface_status_error <session_dir> <fail_message>
# Read state+error from <session_dir>/status.json. If state == "error", print
#   "<fail_message>: <error>"   (when an error string is present)
#   "<fail_message>."           (otherwise)
# to stderr and return 1 — the signal for the caller to force its OWN exit code non-zero
# (the caller keeps that forcing, since it knows the name of its exit-code variable).
# Returns 0 (no surfacing) when status.json is missing or state is not "error".
surface_status_error() {
  local dir="$1" msg="$2" state="" err=""
  if [ -f "$dir/status.json" ]; then
    state="$(json_field "$dir/status.json" state || true)"
    err="$(json_field "$dir/status.json" error || true)"
  fi
  [ "$state" = "error" ] || return 0
  [ -n "$err" ] && echo "$msg: $err" >&2 || echo "$msg." >&2
  return 1
}

# ---- provisional → real session-dir relocation ----

# relocate_session_dir <sessions_root> <session_dir> <provisional_id> <real_id> \
#                      <prog> <exists_noun> <found_line_prefix>
# Best-effort relocation of a provisional session dir to its real backend id. When <real_id>
# is non-empty and differs from <provisional_id>:
#   - if <sessions_root>/<real_id> does NOT exist → mv <session_dir> there (updating the dir);
#   - if it already exists → do NOT clobber; warn "<prog>: <exists_noun> <final> exists;
#     session left at <session_dir>" on stderr;
#   - then echo "<found_line_prefix><real_id>" on stderr (the aligned discovered-id line;
#     the caller passes the exact prefix incl. its column spacing, e.g. "  thread:  ").
# Prints the resulting session dir to stdout (the new dir if moved, else the original) so the
# caller can capture it: SESSION_DIR="$(relocate_session_dir ...)". Callers guard the meta.json
# read with their own RESUME check, so <real_id> is empty on a resumed run → this is a no-op.
relocate_session_dir() {
  local root="$1" dir="$2" prov="$3" real="$4" prog="$5" noun="$6" prefix="$7"
  if [ -n "$real" ] && [ "$real" != "$prov" ]; then
    local final="$root/$real"
    if [ ! -e "$final" ]; then
      mv "$dir" "$final" 2>/dev/null && dir="$final"
    else
      echo "$prog: $noun $final exists; session left at $dir" >&2
    fi
    echo "$prefix$real" >&2
  fi
  printf '%s' "$dir"
}
