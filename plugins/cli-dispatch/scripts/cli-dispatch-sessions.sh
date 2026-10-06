#!/usr/bin/env bash
# List cli-dispatch worker sessions.
#
# Runs straight from the plugin cache via commands/sessions.md's `!` pre-execution
# block — it is NOT installed into ~/.local/bin, so it never goes stale relative
# to the plugin (same arrangement as cli-dispatch-doctor.sh).
#
# Read-only. Reads only meta.json + status.json; transcript.jsonl is NEVER read.
#
# Usage: cli-dispatch-sessions.sh [ds|ag|cx|oc|cp|deepseek|antigravity|codex|opencode|copilot]

if [ "$#" -gt 1 ]; then
  echo "Usage: cli-dispatch-sessions.sh [ds|ag|cx|oc|cp|deepseek|antigravity|codex|opencode|copilot]" >&2
  exit 2
fi

case "${1:-}" in
  "") _BACKEND="" ;;
  ds|deepseek) _BACKEND="deepseek" ;;
  ag|antigravity) _BACKEND="antigravity" ;;
  cx|codex) _BACKEND="codex" ;;
  oc|opencode) _BACKEND="opencode" ;;
  cp|copilot) _BACKEND="copilot" ;;
  *) echo "Usage: cli-dispatch-sessions.sh [ds|ag|cx|oc|cp|deepseek|antigravity|codex|opencode|copilot]" >&2; exit 2 ;;
esac

node - "$_BACKEND" <<'EOF'
const fs = require('fs'), path = require('path')
const want = process.argv[2] || ''
const cache = process.env.XDG_CACHE_HOME || path.join(process.env.HOME, '.cache')
const root = process.env.CLI_DISPATCH_SESSIONS_DIR || process.env.CLAUDE_DS_SESSIONS_DIR ||
  (fs.existsSync(path.join(cache, 'cli-dispatch', 'sessions')) || !fs.existsSync(path.join(cache, 'claude-ds', 'sessions'))
    ? path.join(cache, 'cli-dispatch', 'sessions') : path.join(cache, 'claude-ds', 'sessions'))
if (!fs.existsSync(root)) { console.log(`(no sessions yet — start one with /cli-dispatch:run or /cli-dispatch:ask)`); process.exit(0) }
const dirs = fs.readdirSync(root).filter(d => { try { return fs.statSync(path.join(root, d)).isDirectory() } catch { return false } })
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} } }
let rows = dirs.map(d => {
  const m = read(path.join(root, d, 'meta.json'))
  const s = read(path.join(root, d, 'status.json'))
  return {
    id: d,
    state: s.state || m.state || '?',
    backend: s.backend || m.backend || 'deepseek',
    started: m.startedAt || '',
    cwd: m.cwd || '',
    prompt: (m.promptPreview || '').replace(/\s+/g, ' ').slice(0, 60),
  }
})
if (want) rows = rows.filter(r => r.backend === want)
rows = rows.sort((a, b) => (b.started || '').localeCompare(a.started || ''))
if (!rows.length) { console.log(want ? `(no ${want} sessions yet)` : '(no sessions yet)'); process.exit(0) }
for (const r of rows) {
  if (want) {
    console.log(`${(r.state).padEnd(8)} ${r.id}  ${r.started}`)
  } else {
    console.log(`${(r.state).padEnd(8)} ${(r.backend).padEnd(11)} ${r.id}  ${r.started}`)
  }
  console.log(`         cwd: ${r.cwd}`)
  if (r.prompt) console.log(`         "${r.prompt}"`)
}
EOF
