# Session tracking (live watch + resume)

[← README](../README.md)

Delegated work is **not an opaque background process**: every backend's output is parsed and each task is written to a **session directory** (same layout for DeepSeek, Antigravity, Codex, OpenCode, and Copilot). You track what the worker is doing in a **live, structured, resumable** way via `/cli-dispatch:sessions` and `/cli-dispatch:watch <id>` (or `/cli-dispatch:watch <id> --wait` to block for the result in one call).

Session directory: `${XDG_CACHE_HOME:-$HOME/.cache}/cli-dispatch/sessions/<id>/` (legacy `claude-ds` path still read as a fallback)

| File | Contents |
|------|----------|
| `status.json` | Compact summary (state, last tool, tool counts, result preview) — **the only file read to watch** |
| `progress.log` | Terse human-readable stream (`▸ Edit foo.ts`, `✓ / ✗`, truncated text) |
| `transcript.jsonl` | Raw stream-json (resume/audit; not read while watching) |
| `meta.json` | Prompt preview, cwd, branch, model, start/end |
| `prompt.txt` | The **full** task prompt (untruncated) |
| `changed-files.json` | `{files, diffstat, preexistingDirty}` — files the run changed, written after a repo-changing run finishes |
| `verdict.json` | Written only for runs through `cli-dispatch-run`: verify result, branch, diffstat, exit code |
| `worker-report.json` | The worker's self-report (claims, notDone, assumptions), written by the worker in its worktree when asked; a self-report, not evidence |

**Cost-aware watching:** progress is tracked only from the small `status.json` (`/cli-dispatch:watch <id>` or `/cli-dispatch:watch <id> --wait`); the raw transcript is not read, not tailed in a tight loop — because every read by the orchestrator spends tokens.

> Requirement: `node` is needed for session tracking/parsing (claude-code already runs in a node environment).
