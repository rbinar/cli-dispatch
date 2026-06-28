---
description: Delegate a task to the Codex (OpenAI Codex CLI) worker
argument-hint: <task description>
allowed-tools: Bash, Read
---

# Delegate a task to the Codex worker

Task to delegate: **$ARGUMENTS**

The task runs via `cx-stream` — it pipes `codex exec --json` stdout through `cx-stream-parse.mjs`
for live progress + a rolling `status.json`, writing the same session directory layout the
DeepSeek and Antigravity backends use → **live, observable, resumable**. Monitor progress in a
**cost-conscious** way: read only the small `status.json`, never the raw transcript. The session
id is the codex **thread-id** (printed on stderr after the run completes).

Prerequisite: `cx-agent` / `cx-stream` installed (`/cli-dispatch:setup`, Codex backend) and
`codex` signed in (`codex login`) or `CODEX_API_KEY` set.

**If it's a real repo task** (file changes needed) — isolate in a git worktree:
1. Open a worktree off `origin/main` (or the base stated in the task):
   ```bash
   WORKTREE=$(mktemp -d)
   git worktree add "$WORKTREE" -b cx-run-<branch-name> origin/main
   ```
2. Run the worker (as a background task) inside the worktree:
   ```bash
   cx-agent --cwd "$WORKTREE" --max-runtime 600 "$ARGUMENTS"
   ```
   The sandbox defaults to `workspace-write` so file edits land in the worktree. Add
   `--sandbox read-only` or `--sandbox danger-full-access` (valid values: `read-only` |
   `workspace-write` | `danger-full-access`) as needed.
   Or use the bundled helper, which creates the worktree off `origin/main`, symlinks
   `node_modules`, runs `cx-stream` in it, and prints the cleanup command:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/cx-worktree-run.sh" <repo-path> cx-run-<branch-name> <brief-file>
   # Windows: powershell -File "${CLAUDE_PLUGIN_ROOT}/scripts/cx-worktree-run.ps1" <repo> <branch> <brief>
   ```
3. **Monitor (cost-conscious):** capture the thread-id from stderr, then check progress via
   `/cli-dispatch:watch <thread-id>` (`state: running→done`). Do NOT tight-loop tail.
4. When done, **review** the diff (`git -C "$WORKTREE" diff`), verify independently (build/test).
5. If all good, **you** handle git/commit/push/PR/merge; then clean up the worktree.

**If it's pure generation** (code/text, no files) — the Codex backend's headline feature:
```bash
cx-agent --read-only -q "$ARGUMENTS"   # stdout = final answer; progress in status.json/progress.log
```

> **Real OS-level read-only sandbox:** unlike DeepSeek (tool-layer restriction) and Antigravity
> (no write-deny at all), `--read-only` passes `-s read-only` to codex, which activates macOS
> Seatbelt / Linux bwrap+seccomp — a kernel-enforced hard-block on all file writes. Use it
> freely for analysis tasks; no worktree needed for a genuine no-writes guarantee.

**Model selection:**
```bash
cx-agent --model gpt-5.4-mini --read-only -q "$ARGUMENTS"
```
Omit `--model` to use codex's own default (or the `CX_MODEL` config value). Current Codex
models (`--model <name>`): `gpt-5.5` (default, frontier coding), `gpt-5.4` (flagship),
`gpt-5.4-mini` (fast/cheap — lighter tasks & subagents), `gpt-5.3-codex-spark` (ChatGPT Pro
research preview). `gpt-5.2` / `gpt-5.3-codex` are deprecated. List live with `/model`
inside codex; names move fast, so trust codex's picker over this list.

**Follow-up / fix** (continue the same Codex thread):
```bash
cx-agent --resume <thread-id> "<follow-up>"
```
Resume reuses the thread's stored context — do NOT pass `--cwd` on resume (the `resume`
subcommand does not support it). Also: never pass `--ephemeral` to a session you intend to
resume — it disables session persistence so no thread-id is saved (nothing to resume).

To see all sessions (all backends), use `/cli-dispatch:sessions`.

The worker = Codex (OpenAI); you = reviewer/merge owner. Don't trust the output until verified.
