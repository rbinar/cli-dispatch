---
description: Delegate a task to a worker via the deterministic runner (direct, zero LLM tokens) and print the verdict summary
argument-hint: <backend> "<prompt>" [--verify '<cmd>'] [--cleanup-if-clean] [more cli-dispatch-run flags]
allowed-tools: Bash
---

# Run cli-dispatch worker: $ARGUMENTS

Launch a worker via `cli-dispatch-run` (the deterministic no-LLM runner from 3.34.0)
and print a compact verdict summary — zero LLM tokens spent on orchestration. This is the
direct path; the default path from an orchestrator is the thin `cli-dispatch:runner` agent,
which wraps the same runner (detached + blocking wait) so a long run survives the Bash tool's
10-minute ceiling. Best for mechanical delegations with a machine-checkable `--verify` command.

```bash
# The user's text is pasted in before bash parses it, so it is kept in a quoted heredoc and split
# by a tokenizer that expands nothing. (`read`, not $(cat): bash 3.2 mis-parses a lone quote in $( ).)
IFS= read -r -d '' ARGS_RAW <<'CLI_DISPATCH_ARGS_EOF_9f2c' || true
$ARGUMENTS
CLI_DISPATCH_ARGS_EOF_9f2c
_AF="$(mktemp)"; printf '%s' "$ARGS_RAW" | node "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-args.mjs" > "$_AF" || { rm -f "$_AF"; exit 2; }
set --; while IFS= read -r -d '' a; do set -- "$@" "$a"; done < "$_AF"; rm -f "$_AF"
BACKEND="${1:-}"; PROMPT="${2:-}"; shift 2 2>/dev/null || true
case "$BACKEND" in ds|ag|cx|oc|cp) ;; *)
  echo "usage: /cli-dispatch:run <backend> \"<prompt>\" [--verify '<cmd>'] [--cleanup-if-clean] [more flags]"
  echo "backend: ds | ag | cx | oc | cp     tip: /cli-dispatch:setup to install backends"
  exit 1 ;; esac
if [ -z "$PROMPT" ]; then
  echo "usage: /cli-dispatch:run <backend> \"<prompt>\" [flags]"
  echo "tip: prompt is required"
  exit 1
fi
RUNNER=(cli-dispatch-run)
if ! command -v cli-dispatch-run >/dev/null 2>&1; then
  # Issue #150: a plugin upgrade refreshes the versioned cache dir ONLY — it never re-runs
  # install.sh, so ~/.local/bin keeps whatever the last /cli-dispatch:setup installed and any
  # binary introduced since (cli-dispatch-run itself, originally) is absent from PATH with
  # nothing on screen explaining why. Fall back to the plugin's own copy so the documented
  # zero-token flow still runs, but name the cause so the install gets fixed once.
  PLUGIN_ROOT="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-plugin-root.sh" "${CLAUDE_PLUGIN_ROOT}" 2>/dev/null || true)"
  if [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/scripts/cli-dispatch-run" ]; then
    RUNNER=(bash "$PLUGIN_ROOT/scripts/cli-dispatch-run")
    echo "cli-dispatch-run is not on PATH — using the plugin's own copy: $PLUGIN_ROOT/scripts/cli-dispatch-run"
    echo "Cause: upgrading the plugin refreshes the plugin cache only; ~/.local/bin still has the wrappers your last setup installed."
    echo "Fix it once with /cli-dispatch:setup — this fallback also uses whatever is in ~/.local/share, which may be stale."
  else
    echo "cli-dispatch-run not found on PATH, and no plugin copy is usable."
    echo "If you just upgraded the plugin this is expected: the upgrade never re-runs install.sh."
    echo "Fix: re-run /cli-dispatch:setup (or scripts/install.sh) to reinstall the wrappers."
    echo "Fallback: call ${BACKEND}-agent directly (or /cli-dispatch:ask for a read-only one-shot)."
    exit 1
  fi
fi
RC=0
"${RUNNER[@]}" --backend "$BACKEND" --cwd "$PWD" --prompt "$PROMPT" "$@" || RC=$?
SESSIONS_ROOT="${CLI_DISPATCH_SESSIONS_DIR:-}"
[ -z "$SESSIONS_ROOT" ] && [ -d "$HOME/.cache/cli-dispatch/sessions" ] && SESSIONS_ROOT="$HOME/.cache/cli-dispatch/sessions"
[ -z "$SESSIONS_ROOT" ] && SESSIONS_ROOT="$HOME/.cache/claude-ds/sessions"
# Newest session dir that actually carries a verdict.json (this run's, unless none was written).
SESSION_DIR=""
for d in $(ls -dt "$SESSIONS_ROOT"/*/ 2>/dev/null | head -5); do
  [ -f "$d/verdict.json" ] && { SESSION_DIR="${d%/}"; break; }
done
# The summary script ships in the plugin (not installed to ~/.local), so it matches this command.
bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-run-summary.sh" "${SESSION_DIR:+$SESSION_DIR/verdict.json}" "$RC"
exit $RC
```

Exit codes: `0` success (verify passed or no verify requested); non-zero (`2`–`5`) = launch /
timeout / verify / worker failure — `verdict.json` carries details.

- Deterministic runner — zero LLM tokens; use for mechanical delegations with a
  machine-checkable verify command.
- Continue afterwards: `/cli-dispatch:resume <session-id> "<follow-up>"` (auto-detects backend).

## Working directory

`--cwd` is normally a main checkout, and the runner isolates the work in a fresh
`/tmp/<backend>-wt-*` worktree. **If `--cwd` is itself a linked git worktree, the runner
runs the worker in it directly** (in-place mode, 3.44.0) — no nested worktree, no cleanup,
and nothing in that directory is ever removed by the runner. The leak post-check then
guards the *main* checkout instead. Force the legacy nested behaviour with
`CLI_DISPATCH_NO_IN_PLACE=1`.

## Writing a good `--verify`

The worker's own "tests passed / lint clean" claims are **not** a gate — only the
`--verify` chain's exit code is (every brief now carries a working-directory contract
saying so). Pick commands that fail loudly on the failure mode you actually fear:

- Python move/refactor: add `ruff check --select F821 <target>` — moving function bodies
  and pruning module imports fail *independently*, and F821 catches the pruned-import
  class in a second even when the full test run is slow.
- JS/TS: a type-check (`tsc --noEmit`) alongside the test command, for the same reason.
- Anything: make the last verify step an import/collection smoke test — a package that
  does not import cannot be "green".
