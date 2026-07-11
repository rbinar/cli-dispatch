#!/usr/bin/env bash
set -euo pipefail

# ---- shared repo-dirty check (used by both --post-check and normal-run guard) ----
# Returns 0 (clean) or 1 (dirty). On dirty: saves a patch of the changes and prints
# the FAIL message + status output to stderr (caller decides what to do with exit code).
_check_repo_clean() {
  local repo="$1"
  git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Not a git repo: $repo" >&2; return 1; }
  local status_out
  status_out="$(git -C "$repo" status --short)"
  if [ -z "$status_out" ]; then
    echo ">>> post-check OK: $repo is clean"
    return 0
  fi
  local ts patch_file
  ts="$(date +%s)"
  patch_file="${repo}/../leaked-changes-${ts}.patch"
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
    echo "usage: ds-worktree-run.sh --post-check <repo-path>" >&2
    exit 1
  fi
  _check_repo_clean "$2"
  exit
fi

if [ "$#" -lt 3 ]; then
  echo "usage: ds-worktree-run.sh [--post-check <repo-path>] | <repo-path> <branch> <brief-file>" >&2
  exit 1
fi
REPO="$1"; BRANCH="$2"; BRIEF="$3"
# A worktree's .git is a FILE (not a dir); main-repo .git is a DIR. Both are valid.
# Use -e to accept either.
[ -e "$REPO/.git" ] || { echo "Not a git repo: $REPO" >&2; exit 1; }
[ -f "$BRIEF" ] || { echo "Brief file not found: $BRIEF" >&2; exit 1; }
# NOTE (optional): if REPO itself is already a worktree (.git is a FILE, not a DIR),
# nesting a worktree-of-a-worktree via the normal mode below is redundant. The
# script still works correctly (git worktree add succeeds from a worktree), but
# consider passing the main repo path instead for cleaner isolation.
# Atomically claim a unique worktree path. mktemp -d claims the dir (O_EXCL),
# rmdir releases it, then git worktree add re-creates it. If a race occurs
# (another process created $WT between rmdir and git worktree add), retry once.
WT="$(mktemp -d /tmp/ds-wt-XXXXXX)" && rmdir "$WT"
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
  WT="$(mktemp -d /tmp/ds-wt-XXXXXX)" && rmdir "$WT"
  git -C "$REPO" worktree add -b "$BRANCH" "$WT" "$BASE_REF"
}
_cleanup() { rm -f "$WT/node_modules" 2>/dev/null; echo ">>> Worktree: $WT  (branch: $BRANCH)"; echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"; echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"; }
trap _cleanup ERR INT TERM
if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  ln -s "$REPO/node_modules" "$WT/node_modules"
fi
# Snapshot the main repo's dirt BEFORE the worker runs: the post-check below must fail
# only on NEW entries, or any pre-existing untracked file (a stray CLAUDE.md, editor
# droppings) fails every perfectly good run — this false-positived in production.
PRE_STATUS="$(git -C "$REPO" status --short 2>/dev/null || true)"
echo ">>> Running claude-ds-stream (agentic, session-tracked) in $WT ..."
# Stream variant: progress/status/transcript are written to a session dir (path on stderr).
claude-ds-stream --cwd "$WT" --dangerously-skip-permissions -p "$(cat "$BRIEF")"
echo ">>> Worktree: $WT  (branch: $BRANCH)"
echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"
git -C "$WT" status --short
# Post-run: verify the MAIN repo gained no NEW dirt from the worker (issue #68).
# The worker should only write inside $WT; new entries in $REPO's status mean it resolved
# an absolute path back into the main checkout.
POST_STATUS="$(git -C "$REPO" status --short 2>/dev/null || true)"
NEW_DIRT="$(comm -13 <(printf '%s\n' "$PRE_STATUS" | sort) <(printf '%s\n' "$POST_STATUS" | sort) | grep -v '^$' || true)"
if [ -z "$NEW_DIRT" ]; then
  echo ">>> post-check OK: no new changes in $REPO"
  exit 0
fi
TS="$(date +%s)"
PATCH_FILE="${REPO}/../leaked-changes-${TS}.patch"
git -C "$REPO" diff > "$PATCH_FILE" 2>/dev/null || true
echo ">>> post-check FAIL: worker leaked NEW changes outside the worktree into $REPO" >&2
echo ">>> patch saved: $PATCH_FILE" >&2
printf '%s\n' "$NEW_DIRT" >&2
exit 1
