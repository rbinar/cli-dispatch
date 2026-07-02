---
description: Delegate a task to the OpenCode (OpenRouter) worker
argument-hint: <task description>
allowed-tools: Bash, Read
---

# Delegate a task to the OpenCode worker

Task to delegate: **$ARGUMENTS**

The task runs via `oc-stream` — it pipes `opencode run --format json --auto` stdout through
`oc-stream-parse.mjs` for live progress + a rolling `status.json`, writing the same session
directory layout the other backends use → **live, observable, resumable**. Monitor progress in a
**cost-conscious** way: read only the small `status.json`, never the raw transcript. The session
id is the opencode session id (relocated into place once known, printed on stderr).

Prerequisite: `oc-agent` / `oc-stream` installed (`/cli-dispatch:setup`, OpenCode backend) and
`OPENROUTER_API_KEY` set in the config — OpenRouter has no OAuth/login flow, the key is the only
auth path.

**If it's a real repo task** (file changes needed) — isolate in a git worktree:
1. Use the bundled helper, which creates the worktree off `origin/main`, symlinks
   `node_modules`, runs `oc-stream` in it, and prints the cleanup command:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/oc-worktree-run.sh" <repo-path> oc-run-<branch-name> <brief-file>
   ```
   Or run it by hand:
   ```bash
   WORKTREE=$(mktemp -d)
   git worktree add "$WORKTREE" -b oc-run-<branch-name> origin/main
   oc-agent --cwd "$WORKTREE" --max-runtime 600 "$ARGUMENTS"
   ```
2. **Monitor (cost-conscious):** capture the session id from stderr, then check progress via
   `/cli-dispatch:watch <session-id>` (`state: running→done`). Do NOT tight-loop tail.
3. When done, **review** the diff (`git -C "$WORKTREE" diff`), verify independently (build/test).
4. If all good, **you** handle git/commit/push/PR/merge; then clean up the worktree.

**If it's pure generation** (code/text, no files) — as a background task:
```bash
oc-agent -q "$ARGUMENTS"   # stdout = final answer only; progress in status.json/progress.log
```

> **No sandbox — read this before trusting the output unattended:** `--auto` (always passed by
> oc-stream) auto-approves every permission prompt — a functional requirement for headless use,
> not a safety opt-in. OpenCode has **no OS-level or tool-level write-deny at all**, unlike
> Codex's real kernel-enforced `--read-only`. There is no `--sandbox` flag here to reach for.
> Isolation via a git worktree + your own diff review is the **ONLY** safety boundary.

**Model selection:**
```bash
oc-agent --model google/gemma-4-31b-it:free -q "$ARGUMENTS"
```
Pass the **bare OpenRouter slug** — no `openrouter/` prefix — `oc-stream` prepends it. A few
example free-tier slugs (`:free` suffix): `google/gemma-4-31b-it:free`,
`deepseek/deepseek-v4:free`, `meta-llama/llama-4.1-8b-instruct:free`. The free catalog rotates
often, so re-verify before relying on any of these. List live models OpenCode recognizes with:
```bash
OPENROUTER_API_KEY=<key> opencode models openrouter
```
Omit `--model` to use OpenCode's own default (or the `OC_MODEL` config value).

**Follow-up / fix** (continue the same OpenCode session):
```bash
oc-agent --resume <session-id> "<follow-up>"
```
This passes `--session <id> --continue` to `opencode run`. Resume semantics verified live
(3.15.1, real `OPENROUTER_API_KEY`): it targets the **named** session, not just "the last
session".

To see all sessions (all backends), use `/cli-dispatch:sessions`.

The worker = OpenCode (OpenRouter); you = reviewer/merge owner. Don't trust the output until verified.
