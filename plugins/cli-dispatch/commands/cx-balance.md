---
description: Show Codex (OpenAI) usage / rate limits (5h + weekly, % left)
allowed-tools: Bash
---

# Codex usage / rate limits

Codex has no scriptable usage command — but the CLI **persists** the rate-limit payload it
gets from the backend into its on-disk session records. This reads the newest one (no network,
no third-party tool, no token handling): the `5h` (primary) and weekly `7d` (secondary)
windows, each as **% left** + reset time. Same numbers as `/status` inside the codex TUI.

```bash
node <<'EOF'
const fs = require('fs'), path = require('path'), os = require('os')
const root = path.join(os.homedir(), '.codex', 'sessions')
if (!fs.existsSync(root)) { console.log('no codex sessions found (~/.codex/sessions). Run codex once.'); process.exit(0) }
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
if (!best) { console.log('No rate-limit data on disk yet. Run an interactive codex turn (exec mode reports rate_limits:null), then retry.'); process.exit(0) }
const fmt = (w) => {
  if (!w) return 'n/a'
  const left = 100 - (w.used_percent || 0)
  const win = w.window_minutes >= 10080 ? (w.window_minutes/1440)+'d' : (w.window_minutes/60)+'h'
  const reset = w.resets_at ? new Date(w.resets_at*1000).toLocaleString() : (w.resets_in_seconds ? '+'+Math.round(w.resets_in_seconds/3600)+'h' : '?')
  return `${left}% left  (${win} window, resets ${reset})`
}
console.log('Codex usage  (plan: ' + (best.rl.plan_type || '?') + ')')
console.log('  5h limit: ' + fmt(best.rl.primary))
console.log('  7d limit: ' + fmt(best.rl.secondary))
console.log('  (snapshot from ' + best.ts + ')')
EOF
```

Summarize the % left per window for the user. Note: the snapshot is as fresh as the last
codex turn — exec/`-q` runs report `rate_limits:null`, so the figure comes from the most
recent interactive turn. There is no native scriptable usage for the legacy `/cli-dispatch:ds-balance`
DeepSeek backend equivalent here — this is Codex-specific.
