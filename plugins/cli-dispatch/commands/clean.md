---
description: Clean up stale worker session dirs and leftover worktrees; --schedule installs a daily OS-level auto-clean
argument-hint: "[--remove] [--older-than DAYS] [--schedule [install|status|uninstall] [--time HH:MM]]"
allowed-tools: Bash
---

# cli-dispatch clean

Worker sessions live under `~/.cache/cli-dispatch/sessions/<id>/`. A worker that was killed
before it finalized (Ctrl-C, the parent CLI closed mid-run, crash, watchdog kill, or a codex/
OpenCode/Copilot provisional `cx-<ts>-<pid>`/`oc-<ts>-<pid>`/`cp-<ts>-<pid>` dir that never relocated to its
thread-id/session-id) leaves `status.json` stuck at `state:"running"` forever — it shows up as
**stale** in `/cli-dispatch:sessions`, and never gets removed. This command finds and (with `--remove`) deletes them.

It also sweeps **leftover worktree artifacts**: real-repo-changing delegations (via
`/cli-dispatch:run` — the deterministic runner — or a plain `*-agent` CLI) are isolated in a git worktree named `<backend>-wt-*` (`ds-wt-*`, `ag-wt-*`, `cx-wt-*`, `oc-wt-*`, `cp-wt-*`)
under `/tmp` / `$TMPDIR` (`$env:TEMP` on Windows). A delegation that crashes or is killed before
its own cleanup leaves that worktree behind forever; this sweep finds and (with `--remove`) deletes those too.

**Detection** = `status.json` mtime: `state:"running"` with no write for longer than the
stale window ⇒ dead. **Default is a dry-run** (lists only); pass `--remove` to delete.

- `--remove` — actually delete (default: dry-run, just list). Applies to both the session
  cleanup and the worktree sweep.
- `--stale-secs N` — idle window before a `running` session dir counts as stale (default
  `600` = 10 min; deliberately larger than the statusline's 90 s so a live-but-quiet turn is
  never deleted).
- `--older-than DAYS` — ALSO prune finished (`done`/`error`) session dirs whose
  `meta.startedAt` is older than DAYS. Omit to leave all finished sessions alone.
- `--preserve-verdicts` — archive `verdict.json` and `verdict-diff.patch` into
  `<sessions-root>/verdict-archive/` before removal (default; accepted for compatibility).
- `--no-preserve-verdicts` — remove session dirs without archiving verdict files.
- `--worktree-days N` — idle window (dir mtime) before a `*-wt-*` worktree artifact counts as
  stale (default `3` days).
- `--skip-worktrees` — disable the worktree-artifact sweep entirely (session cleanup only).
- `--quiet` — suppress non-essential output for both the session cleanup and the worktree
  sweep (used by the scheduled auto-clean).

A genuinely-running worker (recent `status.json` write) is NEVER touched. A worktree with
uncommitted changes is NEVER touched either — it is reported as `DIRTY (skipped, uncommitted
changes)` so you can rescue it by hand. Only `<backend>-wt-*` dirs whose `.git` is a file pointing
into a repo's `.git/worktrees/` are considered; any other dir is left alone and reported as
`SKIP (git status failed — not a valid worktree?)`. After deleting a worktree, `git worktree
prune` is run (best-effort) against its source repo so it keeps no dangling administrative entry.

## `--schedule` — daily auto-clean

`--schedule [install|status|uninstall] [--time HH:MM] [--older-than DAYS]` registers (or removes)
a **daily, OS-level** `cli-dispatch-clean --remove` run, so stale dirs are pruned even when
Claude Code is closed. launchd on macOS, cron on Linux/WSL; no cloud agent, no tokens. `--time`
defaults to `03:00`; `--older-than DAYS` also prunes old finished sessions (default off: stale
only). The job logs to `~/.cache/cli-dispatch/clean.log`. `--schedule` alone is a read-only
`status`; `install`/`uninstall` change the OS scheduler, so pass them only when the user asked.
On native Windows the PowerShell block below registers a Scheduled Task instead.

```bash
# The user's text is pasted in before bash parses it: quoted heredoc + a tokenizer that expands nothing.
IFS= read -r -d '' ARGS_RAW <<'CLI_DISPATCH_ARGS_EOF_9f2c' || true
$ARGUMENTS
CLI_DISPATCH_ARGS_EOF_9f2c
_AF="$(mktemp)"; printf '%s' "$ARGS_RAW" | node "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-args.mjs" > "$_AF" || { rm -f "$_AF"; exit 2; }
set --; while IFS= read -r -d '' a; do set -- "$@" "$a"; done < "$_AF"; rm -f "$_AF"
SCHED=0; REST=()
for a in "$@"; do [ "$SCHED" = 1 ] && REST+=("$a"); [ "$a" = "--schedule" ] && SCHED=1; done
if [ "$SCHED" = 1 ]; then
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-clean-schedule.sh" ${REST[@]+"${REST[@]}"}
else
  if command -v cli-dispatch-clean >/dev/null 2>&1; then
    cli-dispatch-clean "$@"
  else
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-clean" "$@"
  fi
fi
```

**Native Windows only** (`--schedule` → Scheduled Task; otherwise the `cli-dispatch-clean.ps1` that `install.ps1` installs):

```powershell
$raw = @'
$ARGUMENTS
'@
$a = @($raw.Trim() -split '\s+' | Where-Object { $_ })
$i = [array]::IndexOf($a, '--schedule')
if ($i -ge 0) { $rest = @($a | Select-Object -Skip ($i + 1))
  & "$env:CLAUDE_PLUGIN_ROOT/scripts/cli-dispatch-clean-schedule.ps1" @rest }
else { $bin = (Get-Command cli-dispatch-clean.ps1 -ErrorAction SilentlyContinue).Source
  if (-not $bin) { $bin = Join-Path $HOME '.local/bin/cli-dispatch-clean.ps1' }; & $bin @a }
```
