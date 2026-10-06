#!/usr/bin/env bash
# Turkish-prompt captures for the TR demo (ask + delegate-by-asking). Same layout as capture.sh.
R=$(ls -d ~/.claude/plugins/cache/cli-dispatch/cli-dispatch/*/ | sort -V | tail -1); R=${R%/}
CAP=/tmp/cap-tr; rm -rf $CAP; mkdir -p $CAP
cmdfile() { local name="$1" args="$2" out="$CAP/.$name.$RANDOM.sh"
  awk '/^```bash/{f=1;next} /^```/{if(f)exit} f' "$R/commands/$name.md" > "$out"
  A="$args" P="$R" perl -0pi -e 's/\$ARGUMENTS/$ENV{A}/g; s/\$\{CLAUDE_PLUGIN_ROOT\}/$ENV{P}/g' "$out"; echo "$out"; }
step() { local n="$1" typed="$2"; shift 2; printf '%s' "$typed" > "$CAP/$n.cmd"; "$@" > "$CAP/$n.out" 2>&1; echo "rc=$?" > "$CAP/$n.rc"; }
D=/tmp/demo-app-tr; rm -rf $D; mkdir -p $D; cd $D; git init -q
printf 'export function add(a, b) {\n  return a - b\n}\n' > math.mjs
printf 'import assert from "node:assert/strict"\nimport test from "node:test"\nimport { add } from "./math.mjs"\n\ntest("add", () => assert.equal(add(2, 3), 5))\n' > math.test.mjs
git add -A; git -c user.email=d@d -c user.name=demo commit -qm base
Q='Tek cümleyle: git worktree add ne yapar?'
step 05-ask "/cli-dispatch:ask cx \"$Q\"" bash -c "cd /tmp && bash '$(cmdfile ask "cx \"$Q\"")'"
P='math.mjs içindeki add() bozuk. Düzeltmeyi DeepSeek'"'"'e devret, node --test ile doğrula, sonra yamayı uygula.'
step 06-agent "$P" bash -c "cd $D && timeout 900 claude -p --dangerously-skip-permissions \"\$0 Testi kendin de çalıştır. Türkçe ve en fazla 6 kısa satırla yanıt ver.\"" "$P"
step 07-test "node --test" bash -c "cd $D && node --test 2>&1 | grep -E '^# (tests|pass|fail)'"
grep -H . $CAP/*.rc
