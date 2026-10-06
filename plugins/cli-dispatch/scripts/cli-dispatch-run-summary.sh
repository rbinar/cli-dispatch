#!/usr/bin/env bash
# cli-dispatch-run-summary.sh — print the compact verdict summary of a cli-dispatch-run.
#   cli-dispatch-run-summary.sh <verdict.json> <runner-exit-code>
# Shared by /cli-dispatch:run and the detached runner's summary.txt. Runs from the plugin
# cache (not installed to ~/.local), like the other pre-execution scripts.
RC="${2:-0}"
if [ ! -f "${1:-}" ]; then
  echo "exit: $RC  (no verdict.json found)"
  exit 0
fi
NODE_BIN="${CLI_DISPATCH_NODE:-node}"
"$NODE_BIN" -e '
  const {readFileSync} = require("fs");
  const exit = process.argv[2];
  let v;
  try { v = JSON.parse(readFileSync(process.argv[1], "utf8")) }
  catch (e) { console.log("exit: " + exit + "  (verdict.json unreadable: " + e.message + ")"); process.exit(0) }
  if (v.error) { console.log("exit: " + exit + "  verdict error: " + v.error); process.exit(0) }
  const verify = v.verify ? (v.verify.exitCode === 0 ? "pass" : "FAIL (exit " + v.verify.exitCode + ")") : "n/a";
  const diff = v.diffstat || (v.changedFiles ? v.changedFiles.length + " file(s)" : "n/a");
  console.log("exit: " + exit + "  session: " + (v.sessionId || "?") + "  state: " + (v.state || "?") + "  verify: " + verify);
  console.log("diff: " + String(diff).trim());
  if (v.leak) console.log("LEAK: the worker wrote outside its worktree — see the runner log");
  if (v.workerExit) console.log("worker exit: " + v.workerExit);
  if (v.fixAttempts) console.log("fix attempts: " + v.fixAttempts.used + "/" + v.fixAttempts.max);
  if (v.stranded) console.log("STRANDED changes in worktree: " + v.worktree);
  console.log("patch: " + (v.diffPatchPath || "n/a"));
' "$1" "$RC"
