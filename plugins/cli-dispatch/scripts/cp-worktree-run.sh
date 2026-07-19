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
if [ "$#" -lt 3 ]; then
  echo "usage: cp-worktree-run.sh <repo-path> <branch> <brief-file>" >&2
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
