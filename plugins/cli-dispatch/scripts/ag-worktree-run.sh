#!/usr/bin/env bash
# ag-worktree-run.sh — run the Antigravity (agy / Gemini) worker on a brief inside an isolated
# git worktree off origin/main. Mirrors ds-worktree-run.sh; the worker is ag-stream (Gemini).
# YOU review the diff and handle git/PR/merge afterwards.
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: ag-worktree-run.sh <repo-path> <branch> <brief-file>" >&2
  exit 1
fi
REPO="$1"; BRANCH="$2"; BRIEF="$3"
[ -d "$REPO/.git" ] || { echo "Not a git repo: $REPO" >&2; exit 1; }
[ -f "$BRIEF" ] || { echo "Brief file not found: $BRIEF" >&2; exit 1; }
WT="$(mktemp -d /tmp/ag-wt-XXXXXX)"
rmdir "$WT"
git -C "$REPO" fetch origin main >/dev/null 2>&1 || true
git -C "$REPO" worktree add -b "$BRANCH" "$WT" origin/main
if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  ln -s "$REPO/node_modules" "$WT/node_modules"
fi
echo ">>> Running ag-stream (Antigravity/Gemini, session-tracked) in $WT ..."
# --cwd is registered as agy's active workspace (via --add-dir) so files land here.
ag-stream --cwd "$WT" -p "$(cat "$BRIEF")" || true
echo ">>> Worktree: $WT  (branch: $BRANCH)"
echo ">>> Review the diff, then YOU handle git/PR/merge. Cleanup:"
echo "    rm -f \"$WT/node_modules\"; git -C \"$REPO\" worktree remove \"$WT\" --force; git -C \"$REPO\" worktree prune"
git -C "$WT" status --short
