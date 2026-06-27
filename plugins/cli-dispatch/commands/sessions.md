---
description: List cli-dispatch worker sessions (all backends: DeepSeek + Antigravity + Codex)
allowed-tools: Bash
---

# cli-dispatch sessions

List the record of delegations started with `claude-ds-stream` (DeepSeek), `ag-stream`
(Antigravity), or `cx-stream` (Codex) — all three write to the same session root — newest
first. The `backend` column shows which worker ran each.
Cost-conscious: only the small `meta.json` + `status.json` files are read; the raw
`transcript.jsonl` is NEVER read.

```bash
node <<'EOF'
const fs = require('fs'), path = require('path')
const cache = process.env.XDG_CACHE_HOME || path.join(process.env.HOME, '.cache')
const root = process.env.CLI_DISPATCH_SESSIONS_DIR || process.env.CLAUDE_DS_SESSIONS_DIR ||
  (fs.existsSync(path.join(cache, 'cli-dispatch', 'sessions')) || !fs.existsSync(path.join(cache, 'claude-ds', 'sessions'))
    ? path.join(cache, 'cli-dispatch', 'sessions') : path.join(cache, 'claude-ds', 'sessions'))
if (!fs.existsSync(root)) { console.log('(no sessions yet — start one with /cli-dispatch:ds-run)'); process.exit(0) }
const dirs = fs.readdirSync(root).filter(d => { try { return fs.statSync(path.join(root, d)).isDirectory() } catch { return false } })
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} } }
const rows = dirs.map(d => {
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
}).sort((a, b) => (b.started || '').localeCompare(a.started || ''))
if (!rows.length) { console.log('(no sessions yet)'); process.exit(0) }
for (const r of rows) {
  console.log(`${(r.state).padEnd(8)} ${(r.backend).padEnd(11)} ${r.id}  ${r.started}`)
  console.log(`         cwd: ${r.cwd}`)
  if (r.prompt) console.log(`         "${r.prompt}"`)
}
EOF
```

To see a session's detail/live status: `/cli-dispatch:watch <id>`.
To send a follow-up (continue the same session): `claude-ds-stream --resume <id> -p "<follow-up>"`.
