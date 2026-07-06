---
description: Delegate a task to claude-ds (DeepSeek)
argument-hint: <task description>
allowed-tools: Bash, Read
---

# Delegate a task to claude-ds

Task to delegate: **$ARGUMENTS**

The task runs via `claude-ds-stream`: its output is parsed as **stream-json** and written to a
session directory → **live, observable, resumable**. Monitor progress in a **cost-conscious** way:
read only the small `status.json`, never the raw transcript.

**If it's a real repo task** (file changes needed) — use an isolated worktree:
1. Write the task to a brief file (e.g. `/tmp/ds-brief.txt`).
2. Run it (as a background task) — depending on the OS:
   - **macOS / Linux / WSL**:
     ```bash
     "${CLAUDE_PLUGIN_ROOT}/scripts/ds-worktree-run.sh" <repo-path> <branch-name> /tmp/ds-brief.txt
     ```
   - **Native Windows**:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/ds-worktree-run.ps1" <repo-path> <branch-name> <brief-file>
     ```
   (The script uses `claude-ds-stream` internally; the session directory is printed on stderr.)
3. **Monitor (cost-conscious):** capture the session id, occasionally check `status.json` via
   `/cli-dispatch:watch <id>` (`state: running→done`). Do NOT tight-loop tail.
4. When done, **review** the diff in the worktree (`git -C <worktree> diff`), verify independently (tsc/build/test).
5. If all good, **you** handle git/commit/push/PR/merge; then clean up the worktree.

**If it's pure generation** (code/text, no files) — as a background task:
```bash
claude-ds-stream -p "$ARGUMENTS"
```
The final text is printed to stdout; progress lives in `status.json`/`progress.log`. Session id on stderr.

> Note: the worker runs with bypassPermissions, so it *can* still write files even here.
> If the output must be text-only with no disk writes, add `--read-only`
> (`claude-ds-stream --read-only -p "$ARGUMENTS"`) — it denies Write/Edit/Bash.

**Reasoning effort:**
```bash
ds-agent --effort high -q "$ARGUMENTS"
```
`--effort low|medium|high` maps to a thinking-token budget via `MAX_THINKING_TOKENS`
(low=1024, medium=8192, high=31999), applied through the CLI wrapper's `--effort` flag.
Best-effort — only honored if the DeepSeek Anthropic-compatible API respects the thinking budget.

**Follow-up / fix** (continue the same DeepSeek session):
```bash
claude-ds-stream --resume <session-id> -p "<follow-up>"
```

To see all sessions, use `/cli-dispatch:sessions`.

claude-ds = worker, you = reviewer/merge owner. Don't trust the output until verified.
