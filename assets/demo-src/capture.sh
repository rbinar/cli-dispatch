#!/usr/bin/env bash
# Captures real outputs for the demo video inside sandbox-harness (dev user).
# Each step writes /tmp/cap/<n>-<name>.cmd (what the user types) and .out (real output).
R=$(ls -d ~/.claude/plugins/cache/cli-dispatch/cli-dispatch/*/ | sort -V | tail -1); R=${R%/}
C=$R/commands
CAP=/tmp/cap; rm -rf $CAP; mkdir -p $CAP
cmdfile() { # build runnable script from a command's ! line / bash fence, $ARGUMENTS substituted
  local name="$1" args="$2" out="$CAP/.$name.$RANDOM.sh"
  local pre; pre=$(sed -n 's/^!`\(.*\)`$/\1/p' "$C/$name.md" | head -1)
  if [ -n "$pre" ]; then printf '%s\n' "$pre" > "$out"; else awk '/^```bash/{f=1;next} /^```/{if(f)exit} f' "$C/$name.md" > "$out"; fi
  A="$args" P="$R" perl -0pi -e 's/\$ARGUMENTS/$ENV{A}/g; s/\$\{CLAUDE_PLUGIN_ROOT\}/$ENV{P}/g' "$out"; echo "$out"
}
step() { local n="$1" typed="$2"; shift 2; printf '%s' "$typed" > "$CAP/$n.cmd"; "$@" > "$CAP/$n.out" 2>&1; echo "rc=$?" > "$CAP/$n.rc"; }

# 1. install (fresh HOME: real marketplace add / install output)
FH=/tmp/demohome; rm -rf $FH; mkdir -p $FH
step 01-market "/plugin marketplace add rbinar/cli-dispatch" env HOME=$FH claude plugin marketplace add rbinar/cli-dispatch
step 02-install "/plugin install cli-dispatch@cli-dispatch" env HOME=$FH claude plugin install cli-dispatch@cli-dispatch
step 03-setup "/cli-dispatch:setup" env HOME=$FH bash -c "bash $R/scripts/install.sh --backends all --non-interactive"

# demo repo with a real bug
D=/tmp/demo-app; rm -rf $D; mkdir -p $D; cd $D; git init -q
printf 'export function add(a, b) {\n  return a - b\n}\n' > math.mjs
printf 'import assert from "node:assert/strict"\nimport test from "node:test"\nimport { add } from "./math.mjs"\n\ntest("add", () => assert.equal(add(2, 3), 5))\n' > math.test.mjs
git add -A; git -c user.email=d@d -c user.name=demo commit -qm base

# 2. health
step 04-doctor "/cli-dispatch:doctor cx" bash "$(cmdfile doctor cx)"
# 3. one-shot ask
step 05-ask "/cli-dispatch:ask cx \"In one sentence: what does git worktree add do?\"" bash -c "cd /tmp && bash '$(cmdfile ask 'cx "In one sentence: what does git worktree add do?"')'"
# 4. natural prompt -> runner agent (real Claude Code session)
cd $D
step 06-agent "add() in math.mjs is broken. Delegate the fix to DeepSeek, verify with node --test, then apply the patch." bash -c "timeout 900 claude -p --dangerously-skip-permissions 'add() in math.mjs is broken. Delegate the fix to DeepSeek, verify with node --test, then apply the patch and run the test yourself. Reply in at most 6 short lines.'"
step 07-test "node --test" bash -c "cd $D && node --test 2>&1 | grep -E '^# (tests|pass|fail)'"
git -C $D stash -q 2>/dev/null; git -C $D checkout -q -- . 2>/dev/null
# 5. direct runner
step 08-run "/cli-dispatch:run cx \"Fix add() in math.mjs\" --verify 'node --test'" bash -c "cd $D && bash '$(cmdfile run "cx \"Fix add() in math.mjs so it returns the sum. Change nothing else.\" --cwd $D --verify 'node --test'")'"
SID=$(sed -n 's/.*session: \([^ ]*\).*/\1/p' $CAP/08-run.out | head -1)
# 6. sessions / watch
step 09-sessions "/cli-dispatch:sessions" bash -c "bash '$(cmdfile sessions '')' | head -9"
step 10-watch "/cli-dispatch:watch ${SID:0:8}… --wait" bash "$(cmdfile watch "$SID --wait --timeout 30")"
# 7. resume
step 11-resume "/cli-dispatch:resume ${SID:0:8}… \"Which file did you change? One line.\"" bash -c "cd /tmp && bash '$(cmdfile resume "$SID Which file did you change? Answer in one line.")'"
# 8. gain / clean / help
step 12-gain "/cli-dispatch:gain" bash -c "bash '$(cmdfile gain '')' | head -14"
step 13-clean "/cli-dispatch:clean" bash "$(cmdfile clean '')"
step 14-help "/cli-dispatch:help" bash "$(cmdfile help '')"
echo "SID=$SID"; ls $CAP; grep -H . $CAP/*.rc
