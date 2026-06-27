---
description: Show Antigravity (agy / Gemini) usage / quota (% left per model)
allowed-tools: Bash
---

# Antigravity usage / quota

agy has no scriptable usage command, but its **local language server** (the same one the
Antigravity IDE and `agy` use) exposes a Connect-RPC `GetUserStatus` endpoint. This queries
it directly — no third-party tool, no Google token handling: discover the running
`language_server` process, read its `--csrf_token` arg + listening port, then POST
`GetUserStatus`. Output is the plan + **remaining quota fraction per model** + reset time.

> **Requires the Antigravity language server to be running** — i.e. the Antigravity IDE is
> open, or an `agy` session is active. If it isn't, this prints a hint instead.

```bash
PID=$(ps aux | grep -i 'language_server' | grep -i antigravity | grep -v grep | awk '{print $2}' | head -1)
if [ -z "$PID" ]; then
  echo "Antigravity language server not running. Open the Antigravity IDE (or start an agy session), then retry."
  exit 0
fi
CMD=$(ps -ww -o command= -p "$PID")
CSRF=$(printf '%s' "$CMD" | sed -E 's/.*--csrf_token[ =]([^ ]+).*/\1/')
# language_server binds a random port; enumerate the ones it actually listens on, probe each.
RESP=""
while IFS= read -r p; do
  [ -z "$p" ] && continue
  out=$(curl -sk --max-time 6 -X POST "https://127.0.0.1:$p/exa.language_server_pb.LanguageServerService/GetUserStatus" \
    -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' -H "X-Codeium-Csrf-Token: $CSRF" --data '{}' 2>/dev/null)
  case "$out" in *userStatus*) RESP="$out"; break;; esac
done <<EOF
$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$PID" 2>/dev/null | awk 'NR>1{print $9}' | sed -E 's/.*:([0-9]+)$/\1/' | sort -u)
EOF
if [ -z "$RESP" ]; then
  echo "Reached the language server but GetUserStatus returned nothing (csrf/port mismatch or signed out)."
  exit 0
fi
printf '%s' "$RESP" | node -e '
let b=""; process.stdin.on("data",d=>b+=d); process.stdin.on("end",()=>{
  const us=(JSON.parse(b).userStatus)||{};
  console.log("Antigravity usage  (plan: "+((us.userTier&&us.userTier.name)||"?")+")");
  const cfgs=(us.cascadeModelConfigData&&us.cascadeModelConfigData.clientModelConfigs)||[];
  const seen=new Set();
  for(const c of cfgs){const q=c.quotaInfo; if(!q||seen.has(c.label))continue; seen.add(c.label);
    const left=(q.remainingFraction!=null)?(q.remainingFraction*100).toFixed(0)+"% left":"?";
    console.log("  "+String(c.label).padEnd(30)+left+"   resets "+(q.resetTime||"?"));}
})'
```

Summarize the per-model **% left** + reset for the user (lower = more used). `remainingFraction`
is the live quota share remaining; `userTier.name` is the plan (e.g. *Google AI Pro*). This is
Antigravity-specific — there is no equivalent native endpoint for the Codex backend (use
`/cli-dispatch:cx-balance`) or a DeepSeek per-model quota.
