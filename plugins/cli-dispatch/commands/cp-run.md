---
description: Delegate a task to the GitHub Copilot worker
argument-hint: <task description>
allowed-tools: Bash, Read
---

# Delegate a task to the GitHub Copilot worker

Task to delegate: **$ARGUMENTS**

The task runs via `cp-stream` — it pipes `copilot -p ... --output-format json` stdout through
`cp-stream-parse.mjs` for live progress + a rolling `status.json`, writing the same session
directory layout the other backends use → **live, observable, resumable**. Monitor progress in a
**cost-conscious** way: read only the small `status.json`, never the raw transcript. The session
id is the copilot session id (relocated into place once known, printed on stderr).

Prerequisite: `cp-agent` / `cp-stream` installed (`/cli-dispatch:setup`, GitHub Copilot backend),
the `copilot` CLI installed/authenticated, and an active GitHub Copilot subscription. Auth is
`COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`; cli-dispatch automatically reuses the
host `gh auth token` as `GH_TOKEN` when available.

**If it's a real repo task** (file changes needed) — isolate in a git worktree:
1. Use the bundled helper, which creates the worktree off `origin/main`, symlinks
   `node_modules`, runs `cp-stream` in it, and prints the cleanup command:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/cp-worktree-run.sh" <repo-path> cp-run-<branch-name> <brief-file>
   ```
   Or run it by hand:
   ```bash
   WORKTREE=$(mktemp -d)
   git worktree add "$WORKTREE" -b cp-run-<branch-name> origin/main
   cp-agent --cwd "$WORKTREE" --max-runtime 600 "$ARGUMENTS"
   ```
2. **Monitor (cost-conscious):** capture the session id from stderr, then check progress via
   `/cli-dispatch:watch <session-id>` (`state: running→done`). Do NOT tight-loop tail.
3. When done, **review** the diff (`git -C "$WORKTREE" diff`), verify independently (build/test).
4. If all good, **you** handle git/commit/push/PR/merge; then clean up the worktree.

**If it's pure generation** (code/text, no files) — as a background task:
```bash
cp-agent -q "$ARGUMENTS"   # stdout = final answer only; progress in status.json/progress.log
```

> **No sandbox — read this before trusting the output unattended:** `--allow-all-tools
> --no-ask-user` (always passed by cp-stream) auto-approves tools and prevents interactive
> questions — a functional requirement for headless use, not a safety opt-in. GitHub Copilot
> has **no OS-level or tool-level write-deny at all**, unlike Codex's real kernel-enforced
> `--read-only`. There is no `--sandbox` flag here to reach for.
> Isolation via a git worktree + your own diff review is the **ONLY** safety boundary.

**Model selection:**
```bash
cp-agent --model gpt-5.4 -q "$ARGUMENTS"
```
Pass the Copilot model slug directly (examples: `gpt-5.4`, `auto`).
Omit `--model` to use GitHub Copilot's own default (or the `CP_MODEL` config value).
Current model list is only visible interactively via `/model` in the copilot TUI (auth
required) or GitHub Copilot docs — slugs change over time.

**Reasoning effort:**
```bash
cp-agent --effort high -q "$ARGUMENTS"
```
`--effort low|medium|high` maps to Copilot's `--reasoning-effort=<level>` flag.

**Follow-up / fix** (continue the same GitHub Copilot session):
```bash
cp-agent --resume <session-id> "<follow-up>"
```
This passes `--resume <id>` to `copilot`.

To see all sessions (all backends), use `/cli-dispatch:sessions`.

The worker = GitHub Copilot; you = reviewer/merge owner. Don't trust the output until verified.
