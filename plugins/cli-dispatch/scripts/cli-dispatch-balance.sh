#!/usr/bin/env bash
# Usage/balance for every cli-dispatch backend, side by side.
#
# Runs straight from the plugin cache via commands/balance.md's `!` pre-execution
# block — it is NOT installed into ~/.local/bin, so it never goes stale relative
# to the plugin (same arrangement as cli-dispatch-status.sh).
#
# Read-only, no third-party tools. An unconfigured/offline backend prints a short
# note instead of failing, so the script always exits 0 with a usable report.
# NEVER prints a key VALUE — only the balance/quota figures.
#
# Usage: cli-dispatch-balance.sh [--backend deepseek|antigravity|codex|opencode|copilot]

usage() {
  echo "Usage: cli-dispatch-balance.sh [--backend deepseek|antigravity|codex|opencode|copilot]" >&2
}

_BACKEND=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backend)
      if [ "$#" -lt 2 ] || [ -z "${2:-}" ]; then
        usage
        exit 2
      fi
      _BACKEND="$2"
      shift 2
      ;;
    --*)
      usage
      exit 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

case "$_BACKEND" in
  ""|deepseek|antigravity|codex|opencode|copilot) ;;
  *)
    usage
    exit 2
    ;;
esac

# Config path — same resolution order the per-backend balance commands use.
CFG="${CLI_DISPATCH_CONFIG:-${CLAUDE_DS_CONFIG:-}}"
[ -n "$CFG" ] || { CFG="$HOME/.config/cli-dispatch/config"; [ -f "$CFG" ] || [ ! -f "$HOME/.config/claude-ds/config" ] || CFG="$HOME/.config/claude-ds/config"; }

deepseek_balance() {
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:setup"; exit 1; fi
# shellcheck disable=SC1090
. "$CFG"
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "key: MISSING — add it to the config (/cli-dispatch:setup)"; exit 1; fi
curl -sS --max-time 20 https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Accept: application/json"
echo
}

antigravity_balance() {
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
}

codex_balance() {
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
}

opencode_balance() {
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:setup"; exit 1; fi
# shellcheck disable=SC1090
. "$CFG"
if [ -z "${OPENROUTER_API_KEY:-}" ]; then echo "key: MISSING — add OPENROUTER_API_KEY to the config (/cli-dispatch:setup)"; exit 1; fi
curl -sS --max-time 20 https://openrouter.ai/api/v1/credits \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Accept: application/json"
echo
}

copilot_balance() {
echo "== GitHub Copilot =="
echo "balance: not queryable from the copilot CLI"
echo "note: /usage is session-scoped and interactive-only inside a copilot REPL session; it is not scriptable."
echo "usage/limits: https://github.com/settings/billing"
echo "auth: requires an active GitHub Copilot subscription"
}

case "$_BACKEND" in
  deepseek) deepseek_balance; exit $? ;;
  antigravity) antigravity_balance; exit $? ;;
  codex) codex_balance; exit $? ;;
  opencode) opencode_balance; exit $? ;;
  copilot) copilot_balance; exit $? ;;
esac

# ── DeepSeek (account balance) ──────────────────────────────────────────
echo "== DeepSeek =="
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:setup"; else
  # shellcheck disable=SC1090
  . "$CFG"
  if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "key: not set (skip)"; else
    curl -sS --max-time 20 https://api.deepseek.com/user/balance \
      -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Accept: application/json"; echo
  fi
fi

# ── Antigravity (per-model quota, local language server) ────────────────
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

# ── Codex (rate limits, from disk) ──────────────────────────────────────
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

# ── OpenCode (OpenRouter, account-wide paid-credit balance) ─────────────
echo "== OpenCode =="
if [ ! -f "$CFG" ]; then echo "config: MISSING ($CFG) — run /cli-dispatch:setup"; else
  # shellcheck disable=SC1090
  . "$CFG"
  if [ -z "${OPENROUTER_API_KEY:-}" ]; then echo "key: not set (skip)"; else
    curl -sS --max-time 20 https://openrouter.ai/api/v1/credits \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Accept: application/json"; echo
  fi
fi

# ── GitHub Copilot (usage not queryable from the CLI) ───────────────────
echo "== GitHub Copilot =="
echo "balance: not queryable from the copilot CLI"
echo "note: /usage is session-scoped and interactive-only inside a copilot REPL session; it is not scriptable."
echo "usage/limits: https://github.com/settings/billing"
echo "auth: requires an active GitHub Copilot subscription"
