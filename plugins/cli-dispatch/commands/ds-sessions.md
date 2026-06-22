---
description: List claude-ds (DeepSeek) sessions
allowed-tools: Bash
---

# claude-ds sessions

List the record of delegations started with `claude-ds-stream` (newest first).
Cost-conscious: only the small `meta.json` + `status.json` files are read; the raw
`transcript.jsonl` is NEVER read.

```bash
node <<'EOF'
const fs = require('fs'), path = require('path')
const root = process.env.CLAUDE_DS_SESSIONS_DIR ||
  path.join(process.env.XDG_CACHE_HOME || path.join(process.env.HOME, '.cache'), 'claude-ds', 'sessions')
if (!fs.existsSync(root)) { console.log('(no sessions yet — start one with /cli-dispatch:ds-run)'); process.exit(0) }
const dirs = fs.readdirSync(root).filter(d => { try { return fs.statSync(path.join(root, d)).isDirectory() } catch { return false } })
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} } }
const rows = dirs.map(d => {
  const m = read(path.join(root, d, 'meta.json'))
  const s = read(path.join(root, d, 'status.json'))
  return {
    id: d,
    state: s.state || m.state || '?',
    started: m.startedAt || '',
    cwd: m.cwd || '',
    prompt: (m.promptPreview || '').replace(/\s+/g, ' ').slice(0, 60),
  }
}).sort((a, b) => (b.started || '').localeCompare(a.started || ''))
if (!rows.length) { console.log('(no sessions yet)'); process.exit(0) }
for (const r of rows) {
  console.log(`${(r.state).padEnd(8)} ${r.id}  ${r.started}`)
  console.log(`         cwd: ${r.cwd}`)
  if (r.prompt) console.log(`         "${r.prompt}"`)
}
EOF
```

To see a session's detail/live status: `/cli-dispatch:ds-watch <id>`.
To send a follow-up (continue the same session): `claude-ds-stream --resume <id> -p "<follow-up>"`.
