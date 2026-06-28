---
description: Show usage/balance for all backends at once (DeepSeek + Antigravity + Codex)
allowed-tools: Bash
---

# cli-dispatch balance (all backends)

The aggregate view: DeepSeek account balance + Antigravity per-model quota + Codex rate
limits, side by side. Mirrors the per-backend `/cli-dispatch:ds-balance`,
`/cli-dispatch:ag-balance`, and `/cli-dispatch:cx-balance`. All read-only, no third-party
tools; an unconfigured/offline backend prints a short note instead of failing.
**Never print any key VALUE** — only the balance/quota figures.

Run the three sections below and summarize each backend's headline number for the user.

## DeepSeek (account balance)

```bash
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"; [ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }
echo "== DeepSeek =="
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:setup"; else
  # shellcheck disable=SC1090
  . "$CFG"
  if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "key: not set (skip)"; else
    curl -sS --max-time 20 https://api.deepseek.com/user/balance \
      -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Accept: application/json"; echo
  fi
fi
```

## Antigravity (per-model quota, local language server)

```bash
echo "== Antigravity =="
PID=$(ps aux | grep -i 'language_server' | grep -i antigravity | grep -v grep | awk '{print $2}' | head -1)
if [ -z "$PID" ]; then
  echo "language server not running (open Antigravity IDE or start an agy session). Skip."
else
  CMD=$(ps -ww -o command= -p "$PID")
  CSRF=$(printf '%s' "$CMD" | sed -E 's/.*--csrf_token[ =]([^ ]+).*/\1/')
  RESP=""
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    out=$(curl -sk --max-time 6 -X POST "https://127.0.0.1:$p/exa.language_server_pb.LanguageServerService/GetUserStatus" \
      -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' -H "X-Codeium-Csrf-Token: $CSRF" --data '{}' 2>/dev/null)
    case "$out" in *userStatus*) RESP="$out"; break;; esac
  done <<EOF
$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$PID" 2>/dev/null | awk 'NR>1{print $9}' | sed -E 's/.*:([0-9]+)$/\1/' | sort -u)
EOF
  if [ -z "$RESP" ]; then echo "reached server but GetUserStatus empty (csrf/port mismatch or signed out)."; else
    printf '%s' "$RESP" | node -e '
let b=""; process.stdin.on("data",d=>b+=d); process.stdin.on("end",()=>{
  const us=(JSON.parse(b).userStatus)||{};
  console.log("plan: "+((us.userTier&&us.userTier.name)||"?"));
  const cfgs=(us.cascadeModelConfigData&&us.cascadeModelConfigData.clientModelConfigs)||[];
  const seen=new Set();
  for(const c of cfgs){const q=c.quotaInfo; if(!q||seen.has(c.label))continue; seen.add(c.label);
    const left=(q.remainingFraction!=null)?(q.remainingFraction*100).toFixed(0)+"% left":"?";
    console.log("  "+String(c.label).padEnd(30)+left+"   resets "+(q.resetTime||"?"));}
})'
  fi
fi
```

## Codex (rate limits, from disk)

```bash
echo "== Codex =="
node <<'EOF'
const fs = require('fs'), path = require('path'), os = require('os')
const root = path.join(os.homedir(), '.codex', 'sessions')
if (!fs.existsSync(root)) { console.log('no codex sessions (~/.codex/sessions). Run codex once. Skip.'); process.exit(0) }
function* walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) yield* walk(p); else if(e.name.endsWith('.jsonl')) yield p } }
let best = null
for (const f of walk(root)) {
  let t; try { t = fs.readFileSync(f,'utf8') } catch { continue }
  for (const line of t.split('\n')) {
    if (!line.includes('"rate_limits"') || line.includes('"rate_limits":null')) continue
    try { const j = JSON.parse(line); const rl = j.payload && j.payload.rate_limits
      if (rl && (rl.primary || rl.secondary) && (!best || j.timestamp > best.ts)) best = { ts: j.timestamp, rl } } catch {}
  }
}
if (!best) { console.log('no rate-limit data yet — run an interactive codex turn, then retry.'); process.exit(0) }
const fmt = (w) => { if (!w) return 'n/a'
  const left = 100 - (w.used_percent || 0)
  const win = w.window_minutes >= 10080 ? (w.window_minutes/1440)+'d' : (w.window_minutes/60)+'h'
  const reset = w.resets_at ? new Date(w.resets_at*1000).toLocaleString() : (w.resets_in_seconds ? '+'+Math.round(w.resets_in_seconds/3600)+'h' : '?')
  return `${left}% left  (${win} window, resets ${reset})` }
console.log('plan: ' + (best.rl.plan_type || '?'))
console.log('  5h limit: ' + fmt(best.rl.primary))
console.log('  7d limit: ' + fmt(best.rl.secondary))
EOF
```

Summarize: DeepSeek `total_balance` per currency, Antigravity per-model `% left`, Codex 5h/7d
`% left`. Note the Codex figure is as fresh as the last interactive codex turn (exec/`-q`
runs report `rate_limits:null`).
