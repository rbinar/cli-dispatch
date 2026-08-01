#!/usr/bin/env bash
# cp-worktree-run.sh — run the GitHub Copilot worker on a brief inside an isolated
# git worktree off origin/main. Mirrors ds-worktree-run.sh / cx-worktree-run.sh; the worker is
# cp-stream (GitHub Copilot). No sandbox-mode concept to pass — worktree isolation is the ONLY
# safety boundary (same posture as ag-worktree-run.sh). YOU review the diff and handle
# git/PR/merge afterwards.
set -euo pipefail

# An inherited GIT_DIR/GIT_WORK_TREE (git hooks, `git rebase --exec`, any parent git
# process) overrides `git -C "$REPO"` — every repo probe below would then describe the
# INHERITED repo, not $REPO, and in-place detection could hand the worker the user's main
# checkout with zero isolation. Drop them before the first git call.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_NAMESPACE
# ---- shared repo-dirty check (used by both --post-check and normal-run guard) ----
# Returns 0 (clean) or 1 (dirty). On dirty: saves a patch of the changes and prints
# the FAIL message + status output to stderr (caller decides what to do with exit code).
_check_repo_clean() {
  local repo="$1"
  # Same gate as the normal run below: rev-parse exits 0 while PRINTING "false" inside a
  # bare repo or a .git admin dir, so compare the output, not the exit status.
  [ "$(git -C "$repo" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ] || { echo "Not a git repo (or not a work tree): $repo" >&2; return 1; }
  local status_out
  status_out="$(git -C "$repo" status --short)"
  if [ -z "$status_out" ]; then
    echo ">>> post-check OK: $repo is clean"
    return 0
  fi
  local ts patch_file
  ts="$(date +%s)"
  # Temp dir, not "$repo/.." — that parent is a directory the runner does not own.
  patch_file="${TMPDIR:-/tmp}/cli-dispatch-leaked-changes-${ts}.patch"
  git -C "$repo" diff > "$patch_file"
  # Note: git diff does not cover untracked files; status --short above does list them.
  echo ">>> post-check FAIL: $repo is dirty — worker leaked changes outside worktree" >&2
  echo ">>> patch saved: $patch_file" >&2
  echo "$status_out" >&2
  return 1
}

# --post-check mode: verify main repo wasn't dirtied by a worker
if [ "${1:-}" = "--post-check" ]; then
  if [ "$#" -ne 2 ]; then
    echo "usage: cp-worktree-run.sh --post-check <repo-path>" >&2
    exit 1
  fi
  _check_repo_clean "$2"
  exit
fi

if [ "$#" -lt 3 ]; then
  echo "usage: cp-worktree-run.sh [--post-check <repo-path>] | <repo-path> <branch> <brief-file>" >&2
  exit 1
fi
REPO="$1"; BRANCH="$2"; BRIEF="$3"
# Repo detection must accept main checkouts, linked worktrees (.git is a FILE, not a dir)
# and submodules — a bare `test -d "$REPO/.git"` rejects the last two (issue #107).
[ "$(git -C "$REPO" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ] || { echo "Not a git repo (or not a work tree): $REPO" >&2; exit 1; }
[ -f "$BRIEF" ] || { echo "Brief file not found: $BRIEF" >&2; exit 1; }

# Locate cp-stream (PATH, else next to this script) — mirrors cp-agent's fallback so this
# script doesn't hard-fail with exit 127 in an environment where /cli-dispatch:setup hasn't
# put cp-stream on PATH.
STREAM="$(command -v cp-stream 2>/dev/null || true)"
[ -z "$STREAM" ] && STREAM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cp-stream"
[ -x "$STREAM" ] || { echo "cp-worktree-run.sh: cp-stream not found (run /cli-dispatch:setup)." >&2; exit 1; }
# --- in-place mode (issues #108 / #109) ----------------------------------------------
# If $REPO is ALREADY a linked worktree, the caller opened it for this job on purpose.
# Nesting a second worktree there puts the worker's cwd in /tmp while the brief's absolute
# paths point at $REPO: the writes land in $REPO, the leak post-check calls that a leak and
# exits 1 on a perfectly good run (#108), and the worker's own lint/test self-checks run in
# the untouched tmp tree (#109). Run in place instead — no nested worktree, no cleanup.
# Detection: a linked worktree's git-dir differs from its git-common-dir.
# Escape hatch: CLI_DISPATCH_NO_IN_PLACE=1 forces the legacy nested-worktree behaviour.
IN_PLACE=0
GUARD_REPO="$REPO"
GIT_DIR_ABS="$(git -C "$REPO" rev-parse --absolute-git-dir 2>/dev/null || true)"
GIT_COMMON_ABS="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -z "$GIT_COMMON_ABS" ]; then
  # git < 2.31 has no --path-format; resolve the (possibly relative) path by hand.
  _GCD="$(git -C "$REPO" rev-parse --git-common-dir 2>/dev/null || true)"
  [ -n "$_GCD" ] && GIT_COMMON_ABS="$( (cd "$REPO" && cd "$_GCD" && pwd -P) 2>/dev/null || true)"
fi
[ -n "$GIT_DIR_ABS" ] && GIT_DIR_ABS="$( (cd "$GIT_DIR_ABS" && pwd -P) 2>/dev/null || true)"
[ -n "$GIT_COMMON_ABS" ] && GIT_COMMON_ABS="$( (cd "$GIT_COMMON_ABS" && pwd -P) 2>/dev/null || true)"
if [ "${CLI_DISPATCH_NO_IN_PLACE:-0}" != "1" ] && [ -n "$GIT_DIR_ABS" ] && [ -n "$GIT_COMMON_ABS" ] && [ "$GIT_DIR_ABS" != "$GIT_COMMON_ABS" ]; then
  IN_PLACE=1
  # Leak-guard the MAIN checkout instead of $REPO — writes into $REPO are the point now.
  # `worktree list --porcelain` lists the main worktree first; dirname(git-common-dir) is
  # wrong for --separate-git-dir layouts and for worktrees of a bare repo.
  _MAIN="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
  if [ -n "$_MAIN" ] && [ "$(git -C "$_MAIN" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ]; then
    GUARD_REPO="$_MAIN"
  else
    GUARD_REPO=""
  fi
fi

if [ "$IN_PLACE" -eq 1 ]; then
  WT="$REPO"
  echo ">>> cli-dispatch: in-place=1" >&2
  # cli-dispatch-run builds verdict-diff.patch from this tree's status+diff, so any work
  # the caller already had here is reported as the worker's. Say so rather than silently
  # mis-attributing it.
  _TARGET_DIRT="$(git -C "$WT" status --short 2>/dev/null | grep -c . || true)"
  if [ "${_TARGET_DIRT:-0}" -gt 0 ]; then
    echo ">>> Note: target worktree already had $_TARGET_DIRT uncommitted change(s) before the run — the verdict diff will include them." >&2
  fi
  echo ">>> In-place mode: $REPO is already a linked worktree — running there (no nested worktree, no cleanup)."
  if [ -n "$BRANCH" ]; then
    echo ">>> Note: --branch \"$BRANCH\" is ignored in in-place mode; HEAD stays $(git -C "$WT" symbolic-ref --short HEAD 2>/dev/null || echo detached)."
  fi
else
  # Atomically claim a unique worktree path. mktemp -d claims the dir (O_EXCL),
  # rmdir releases it, then git worktree add re-creates it. If a race occurs
  # (another process created $WT between rmdir and git worktree add), retry once.
  WT="$(mktemp -d /tmp/cp-wt-XXXXXX)" && rmdir "$WT"
  # Resolve base ref
  BASE_REF=""
  LOCAL_BRANCH="$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || true)"
  if [ -n "$LOCAL_BRANCH" ]; then
    BASE_REF="$LOCAL_BRANCH"
  else
    REMOTE_HEAD="$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
    if [ -n "$REMOTE_HEAD" ]; then
      BASE_REF="$REMOTE_HEAD"
    else
      BASE_REF="origin/main"
    fi
  fi

  # Fetch remote ref if applicable
  if [[ "$BASE_REF" == origin/* ]]; then
    git -C "$REPO" fetch origin "${BASE_REF#origin/}" >/dev/null 2>&1 || true
  fi

  git -C "$REPO" worktree add -b "$BRANCH" "$WT" "$BASE_REF" || {
    WT="$(mktemp -d /tmp/cp-wt-XXXXXX)" && rmdir "$WT"
    git -C "$REPO" worktree add -b "$BRANCH" "$WT" "$BASE_REF"
  }
  _cleanup() { rm -f "$WT/node_modules" 2>/dev/null; echo ">>> Worktree: $WT  (branch: $BRANCH)"; echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"; echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"; }
  trap _cleanup ERR INT TERM
  if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
    ln -s "$REPO/node_modules" "$WT/node_modules"
  fi
fi
# Snapshot the guarded repo's dirt BEFORE the worker runs: the post-check below must fail
# only on NEW entries, or any pre-existing untracked file (a stray CLAUDE.md, editor
# droppings) fails every perfectly good run — this false-positived in production.
PRE_STATUS=""
[ -n "$GUARD_REPO" ] && PRE_STATUS="$(git -C "$GUARD_REPO" status --short 2>/dev/null || true)"
echo ">>> Running cp-stream (GitHub Copilot, session-tracked) in $WT ..."
# No sandbox mode: --allow-all-tools --no-ask-user (always passed by cp-stream) enables
# headless use. Worktree isolation is the safety boundary — review the diff before merging.
"$STREAM" --cwd "$WT" -p "$(cat "$BRIEF")"
if [ "$IN_PLACE" -eq 1 ]; then
  echo ">>> In-place worktree: $WT  (branch: $(git -C "$WT" symbolic-ref --short HEAD 2>/dev/null || echo detached))"
  echo ">>> This worktree belongs to YOU — the runner created nothing and removed nothing."
else
  echo ">>> Worktree: $WT  (branch: $BRANCH)"
  echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
  echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"
fi
git -C "$WT" status --short

# Post-run: verify the guarded repo gained no NEW dirt from the worker (issue #68).
# The worker should only write inside $WT; new entries in $GUARD_REPO's status mean it
# resolved an absolute path back out of the tree it was given. In in-place mode $GUARD_REPO
# is the MAIN checkout, never the target worktree the caller asked us to write to (#108).
if [ -z "$GUARD_REPO" ]; then
  echo ">>> post-check skipped: no main checkout to guard"
  exit 0
fi
POST_STATUS="$(git -C "$GUARD_REPO" status --short 2>/dev/null || true)"
NEW_DIRT="$(comm -13 <(printf '%s\n' "$PRE_STATUS" | sort) <(printf '%s\n' "$POST_STATUS" | sort) | grep -v '^$' || true)"
if [ -z "$NEW_DIRT" ]; then
  echo ">>> post-check OK: no new changes in $GUARD_REPO"
  exit 0
fi
# The snapshot cannot attribute authorship — it only knows the entry is NEW. A worker that
# resolved a path out of its worktree looks exactly like an orchestrator, an editor, or a
# second agent writing to the repo while the run was in flight. When the caller knows the
# concurrent writes are theirs, downgrade to a warning so --verify still gets to run: a
# good run should not be thrown away over edits the caller made themselves.
if [ -n "${CLI_DISPATCH_ALLOW_CONCURRENT_EDITS:-}" ]; then
  echo ">>> post-check WARNING: NEW changes in $GUARD_REPO, allowed by CLI_DISPATCH_ALLOW_CONCURRENT_EDITS" >&2
  printf '%s\n' "$NEW_DIRT" >&2
  exit 0
fi
TS="$(date +%s)"
PATCH_FILE="${TMPDIR:-/tmp}/cli-dispatch-leaked-changes-${TS}.patch"
git -C "$GUARD_REPO" diff > "$PATCH_FILE" 2>/dev/null || true
echo ">>> post-check FAIL: NEW changes appeared in $GUARD_REPO, outside the worktree" >&2
echo ">>>   Either the worker resolved a path outside the tree it was given, or something" >&2
echo ">>>   else wrote to the repo while the run was in flight (you, an editor, an agent)." >&2
echo ">>>   If those changes are yours, re-run with CLI_DISPATCH_ALLOW_CONCURRENT_EDITS=1" >&2
echo ">>> patch saved: $PATCH_FILE" >&2
echo ">>> the worker's own output is UNAFFECTED and still in the worktree: $WT" >&2
printf '%s\n' "$NEW_DIRT" >&2
exit 1
