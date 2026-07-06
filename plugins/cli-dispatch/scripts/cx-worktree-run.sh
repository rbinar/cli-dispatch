#!/usr/bin/env bash
# cx-worktree-run.sh — run the Codex (OpenAI Codex CLI) worker on a brief inside an isolated
# git worktree off origin/main. Mirrors ds-worktree-run.sh; the worker is cx-stream (Codex).
# Default sandbox is workspace-write so edits land in the worktree. YOU review the diff and
# handle git/PR/merge afterwards.
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: cx-worktree-run.sh <repo-path> <branch> <brief-file>" >&2
  exit 1
fi
REPO="$1"; BRANCH="$2"; BRIEF="$3"
[ -d "$REPO/.git" ] || { echo "Not a git repo: $REPO" >&2; exit 1; }
[ -f "$BRIEF" ] || { echo "Brief file not found: $BRIEF" >&2; exit 1; }
# Atomically claim a unique worktree path. mktemp -d claims the dir (O_EXCL),
# rmdir releases it, then git worktree add re-creates it. If a race occurs
# (another process created $WT between rmdir and git worktree add), retry once.
WT="$(mktemp -d /tmp/cx-wt-XXXXXX)" && rmdir "$WT"
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
  WT="$(mktemp -d /tmp/cx-wt-XXXXXX)" && rmdir "$WT"
  git -C "$REPO" worktree add -b "$BRANCH" "$WT" "$BASE_REF"
}
_cleanup() { rm -f "$WT/node_modules" 2>/dev/null; echo ">>> Worktree: $WT  (branch: $BRANCH)"; echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"; echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"; }
trap _cleanup ERR INT TERM
if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  ln -s "$REPO/node_modules" "$WT/node_modules"
fi
echo ">>> Running cx-stream (Codex/OpenAI, session-tracked) in $WT ..."
# Default sandbox workspace-write → edits land in $WT. Pass --read-only for an analysis run.
cx-stream --cwd "$WT" -p "$(cat "$BRIEF")"
echo ">>> Worktree: $WT  (branch: $BRANCH)"
echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"
git -C "$WT" status --short
