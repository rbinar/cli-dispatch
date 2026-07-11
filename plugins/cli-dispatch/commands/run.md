---
description: Delegate a task to a worker via the deterministic runner (no LLM babysitter) and print the verdict summary
argument-hint: <backend> "<prompt>" [--verify '<cmd>'] [--cleanup-if-clean] [more cli-dispatch-run flags]
allowed-tools: Bash
---

# Run cli-dispatch worker: $ARGUMENTS

Launch a worker via `cli-dispatch-run` (the deterministic no-LLM runner from 3.34.0)
and print a compact verdict summary — no babysitter, zero LLM tokens spent on orchestration.
Best for mechanical delegations with a machine-checkable `--verify` command.

```bash
set -- $ARGUMENTS
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
if ! command -v cli-dispatch-run >/dev/null 2>&1; then
  echo "cli-dispatch-run not found on PATH — re-run /cli-dispatch:setup (or scripts/install.sh)."
  echo "Fallback: delegate via the ${BACKEND}-runner subagent or /cli-dispatch:${BACKEND}-run."
  exit 1
fi
RC=0
cli-dispatch-run --backend "$BACKEND" --cwd "$PWD" --prompt "$PROMPT" "$@" || RC=$?
SESSIONS_ROOT="${CLI_DISPATCH_SESSIONS_DIR:-}"
[ -z "$SESSIONS_ROOT" ] && [ -d "$HOME/.cache/cli-dispatch/sessions" ] && SESSIONS_ROOT="$HOME/.cache/cli-dispatch/sessions"
[ -z "$SESSIONS_ROOT" ] && SESSIONS_ROOT="$HOME/.cache/claude-ds/sessions"
# Newest session dir that actually carries a verdict.json (this run's, unless none was written).
SESSION_DIR=""
for d in $(ls -dt "$SESSIONS_ROOT"/*/ 2>/dev/null | head -5); do
  [ -f "$d/verdict.json" ] && { SESSION_DIR="${d%/}"; break; }
done
if [ -n "$SESSION_DIR" ]; then
  node -e '
    const {readFileSync} = require("fs");
    const v = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const exit = process.argv[2];
    const verify = v.verify ? (v.verify.exitCode === 0 ? "pass" : "FAIL (exit " + v.verify.exitCode + ")") : "n/a";
    const diff = v.diffstat || (v.changedFiles ? v.changedFiles.length + " file(s)" : "n/a");
    console.log("exit: " + exit + "  session: " + (v.sessionId || "?") + "  state: " + (v.state || "?") + "  verify: " + verify);
    console.log("diff: " + String(diff).trim());
    if (v.stranded) console.log("STRANDED changes in worktree: " + v.worktree);
    console.log("patch: " + (v.diffPatchPath || "n/a"));
  ' "$SESSION_DIR/verdict.json" "$RC"
else
  echo "exit: $RC  (no verdict.json found)"
fi
exit $RC
```

Exit codes: `0` success (verify passed or no verify requested); non-zero (`2`–`5`) = launch /
timeout / verify / worker failure — `verdict.json` carries details.

- Deterministic runner — zero LLM babysitter tokens; use for mechanical delegations with a
  machine-checkable verify command.
- Continue afterwards: `/cli-dispatch:resume <session-id> "<follow-up>"` (auto-detects backend).
