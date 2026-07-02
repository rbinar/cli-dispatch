#!/usr/bin/env bash
# oc-worktree-run.sh — run the OpenCode (via OpenRouter) worker on a brief inside an isolated
# git worktree off origin/main. Mirrors ds-worktree-run.sh / cx-worktree-run.sh; the worker is
# oc-stream (OpenCode). No sandbox-mode concept to pass — worktree isolation is the ONLY
# safety boundary (same posture as ag-worktree-run.sh). YOU review the diff and handle
# git/PR/merge afterwards.
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: oc-worktree-run.sh <repo-path> <branch> <brief-file>" >&2
  exit 1
fi
REPO="$1"; BRANCH="$2"; BRIEF="$3"
[ -d "$REPO/.git" ] || { echo "Not a git repo: $REPO" >&2; exit 1; }
[ -f "$BRIEF" ] || { echo "Brief file not found: $BRIEF" >&2; exit 1; }
# Atomically claim a unique worktree path. mktemp -d claims the dir (O_EXCL),
# rmdir releases it, then git worktree add re-creates it. If a race occurs
# (another process created $WT between rmdir and git worktree add), retry once.
WT="$(mktemp -d /tmp/oc-wt-XXXXXX)" && rmdir "$WT"
git -C "$REPO" fetch origin main >/dev/null 2>&1 || true
git -C "$REPO" worktree add -b "$BRANCH" "$WT" origin/main || {
  WT="$(mktemp -d /tmp/oc-wt-XXXXXX)" && rmdir "$WT"
  git -C "$REPO" worktree add -b "$BRANCH" "$WT" origin/main
}
_cleanup() { rm -f "$WT/node_modules" 2>/dev/null; git -C "$REPO" worktree remove "$WT" --force 2>/dev/null; git -C "$REPO" worktree prune 2>/dev/null; }
trap _cleanup ERR INT TERM
if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  ln -s "$REPO/node_modules" "$WT/node_modules"
fi
echo ">>> Running oc-stream (OpenCode/OpenRouter, session-tracked) in $WT ..."
# No sandbox mode: --auto (always passed by oc-stream) approves everything. Worktree
# isolation is the safety boundary — review the diff before merging.
oc-stream --cwd "$WT" -p "$(cat "$BRIEF")"
echo ">>> Worktree: $WT  (branch: $BRANCH)"
echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"
git -C "$WT" status --short
