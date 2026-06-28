---
description: Delegate a task to the Antigravity (agy / Gemini) worker
argument-hint: <task description>
allowed-tools: Bash, Read
---

# Delegate a task to the Antigravity worker

Task to delegate: **$ARGUMENTS**

The task runs via `ag-stream` — it launches `agy` under a pseudo-TTY (agy has no reliable
stdout stream) and **tails agy's on-disk JSONL transcript**, writing the same session
directory layout the DeepSeek backend uses → **live, observable, resumable**. Monitor
progress in a **cost-conscious** way: read only the small `status.json`, never the raw
transcript. The session id is the agy **conversation-id** (printed on stderr).

Prerequisite: `ag-agent` / `ag-stream` installed (`/cli-dispatch:setup`, Antigravity
backend) and `agy` signed in (run `agy` once) or `GEMINI_API_KEY` set.

**If it's a real repo task** (file changes needed) — isolate in a git worktree (this also
avoids agy's per-workspace conversation-id race):
1. Open a worktree off `origin/main` — either `git worktree add` by hand, or the bundled
   helper (creates the worktree, runs `ag-stream` in it, prints the cleanup command):
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/ag-worktree-run.sh" <repo-path> ag-run-<branch-name> <brief-file>
   ```
2. Run it (as a background task), pointing the worker at the worktree:
   ```bash
   ag-agent --cwd <worktree> --max-runtime 600 "$ARGUMENTS"
   ```
   `--cwd` is registered as agy's active workspace (via `--add-dir`) so files land there,
   not in agy's own scratch dir.

   > Timeout caveat: agy spawns detached workers, so `--max-runtime` is enforced via agy's
   > own `--print-timeout` (a per-model-wait cap; total wall-time can exceed it) with only a
   > best-effort watchdog backstop — it is NOT a hard wall-clock kill like the DeepSeek
   > backend. For a strict bound, wrap the call in `timeout(1)` yourself.
3. **Monitor (cost-conscious):** occasionally check `status.json` via
   `/cli-dispatch:watch <conv-id>` (`state: running→done`). Do NOT tight-loop tail.
4. When done, **review** the diff in the worktree (`git -C <worktree> diff`), verify
   independently (build/test).
5. If all good, **you** handle git/commit/push/PR/merge; then clean up the worktree.

**If it's pure generation** (code/text, no files) — as a background task:
```bash
ag-agent -q "$ARGUMENTS"        # stdout = final answer only; progress in status.json/progress.log
```

> No read-only mode: unlike DeepSeek (which hard-restricts tools to Read/Grep/Glob), agy
> has no tool-level write-deny (`--sandbox` restricts the terminal, not file writes — tested),
> so `--read-only` is rejected. For a no-writes guarantee, isolate in a throwaway/worktree
> `--cwd` and review the diff (the review step is your real safety boundary anyway).

**Follow-up / fix** (continue the same agy conversation):
```bash
ag-agent --resume <conv-id> "<follow-up>"
```

To see all sessions (all backends), use `/cli-dispatch:sessions`.

The worker = Antigravity (Gemini); you = reviewer/merge owner. Don't trust the output until verified.
