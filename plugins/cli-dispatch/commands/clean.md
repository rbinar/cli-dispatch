---
description: Clean up stale worker session dirs (running-but-dead) and optionally old finished ones
allowed-tools: Bash
---

# cli-dispatch clean

Worker sessions live under `~/.cache/cli-dispatch/sessions/<id>/`. A worker that was killed
before it finalized (Ctrl-C, the parent CLI closed mid-run, crash, watchdog kill, or a codex
provisional `cx-<ts>-<pid>` dir that never relocated to its thread-id) leaves `status.json`
stuck at `state:"running"` forever — it shows up as **stale** in `/cli-dispatch:sessions` and
the dashboard, and never gets removed. This command finds and (with `--remove`) deletes them.

**Detection** = `status.json` mtime: `state:"running"` with no write for longer than the
stale window ⇒ dead. **Default is a dry-run** (lists only); pass `--remove` to delete.

- `--remove` — actually delete (default: dry-run, just list).
- `--stale-secs N` — idle window before a `running` dir counts as stale (default `600` = 10 min;
  deliberately larger than the dashboard's 90 s so a live-but-quiet turn is never deleted).
- `--older-than DAYS` — ALSO prune finished (`done`/`error`) dirs whose `meta.startedAt` is
  older than DAYS. Omit to leave all finished sessions alone.

A genuinely-running worker (recent `status.json` write) is NEVER touched.

```bash
ARGS="$*"   # pass through the command args (e.g. --remove --older-than 7)
REMOVE=0; STALE_SECS=600; OLDER_DAYS=0
set -- $ARGS
while [ "$#" -gt 0 ]; do
  case "$1" in
    --remove) REMOVE=1; shift;;
    --stale-secs) STALE_SECS="$2"; shift 2;;
    --older-than) OLDER_DAYS="$2"; shift 2;;
    *) shift;;
  esac
done
case "$STALE_SECS" in ''|*[!0-9]*) STALE_SECS=600;; esac
case "$OLDER_DAYS"  in ''|*[!0-9]*) OLDER_DAYS=0;; esac

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
[ -n "$ROOT" ] || { ROOT="$CACHE/cli-dispatch/sessions"; [ -d "$ROOT" ] || ROOT="$CACHE/claude-ds/sessions"; }
[ -d "$ROOT" ] || { echo "(no sessions dir: $ROOT)"; exit 0; }

REMOVE=$REMOVE STALE_SECS=$STALE_SECS OLDER_DAYS=$OLDER_DAYS ROOT="$ROOT" node <<'EOF'
const fs=require('fs'), path=require('path')
const root=process.env.ROOT, remove=process.env.REMOVE==='1'
const staleSecs=+process.env.STALE_SECS, olderDays=+process.env.OLDER_DAYS
const now=Date.now()
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return{}}}
let stale=[], old=[], kept=0
for(const d of fs.readdirSync(root)){
  const dir=path.join(root,d); let s
  try{ if(!fs.statSync(dir).isDirectory()) continue }catch{ continue }
  const st=read(path.join(dir,'status.json')), m=read(path.join(dir,'meta.json'))
  const state=st.state||m.state||'?'
  let mtime=0; try{ mtime=fs.statSync(path.join(dir,'status.json')).mtimeMs }catch{}
  const idle=mtime?Math.round((now-mtime)/1000):null
  if(state==='running' && mtime && (now-mtime > staleSecs*1000)){
    stale.push({d,backend:st.backend||m.backend||'?',idle}); continue
  }
  if(olderDays>0 && (state==='done'||state==='error')){
    const started=Date.parse(m.startedAt||'')||0
    if(started && (now-started > olderDays*86400*1000)){
      old.push({d,backend:st.backend||m.backend||'?',state,started:m.startedAt}); continue
    }
  }
  kept++
}
const rm=(d)=>fs.rmSync(path.join(root,d),{recursive:true,force:true})
const days=s=>s==null?'?':(s>86400?(s/86400).toFixed(1)+'d':(s/3600).toFixed(1)+'h')
console.log(`root: ${root}`)
console.log(`stale (running but dead, idle > ${staleSecs}s): ${stale.length}`)
for(const x of stale) console.log(`  ${x.backend.padEnd(11)} ${x.d}  idle ${days(x.idle)}`)
if(olderDays>0){
  console.log(`old finished (done/error, started > ${olderDays}d ago): ${old.length}`)
  for(const x of old) console.log(`  ${x.backend.padEnd(11)} ${x.state.padEnd(6)} ${x.d}  ${x.started}`)
}
const targets=[...stale, ...old]
if(!targets.length){ console.log('nothing to clean.'); process.exit(0) }
if(remove){
  let n=0; for(const x of targets){ try{ rm(x.d); n++ }catch(e){ console.log(`  FAILED ${x.d}: ${e.message}`) } }
  console.log(`\nremoved ${n}/${targets.length} dir(s). kept ${kept} live/recent.`)
}else{
  console.log(`\nDRY-RUN — nothing deleted. Re-run with --remove to delete the ${targets.length} dir(s) above.`)
}
EOF
```

**Native Windows** (PowerShell equivalent):

```powershell
param([switch]$Remove, [int]$StaleSecs = 600, [int]$OlderThan = 0)
$cache = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME '.cache' }
$root = if ($env:CLI_DISPATCH_SESSIONS_DIR) { $env:CLI_DISPATCH_SESSIONS_DIR } elseif ($env:CLAUDE_DS_SESSIONS_DIR) { $env:CLAUDE_DS_SESSIONS_DIR } elseif (Test-Path (Join-Path $cache 'cli-dispatch/sessions')) { Join-Path $cache 'cli-dispatch/sessions' } else { Join-Path $cache 'claude-ds/sessions' }
if (-not (Test-Path $root)) { "(no sessions dir: $root)"; return }
$now = Get-Date; $stale = @(); $old = @(); $kept = 0
foreach ($dir in Get-ChildItem -Directory $root) {
  $st = @{}; $m = @{}
  try { $st = Get-Content -Raw (Join-Path $dir.FullName 'status.json') | ConvertFrom-Json } catch {}
  try { $m  = Get-Content -Raw (Join-Path $dir.FullName 'meta.json')   | ConvertFrom-Json } catch {}
  $state = if ($st.state) { $st.state } elseif ($m.state) { $m.state } else { '?' }
  $sf = Join-Path $dir.FullName 'status.json'
  $mtime = if (Test-Path $sf) { (Get-Item $sf).LastWriteTime } else { $null }
  if ($state -eq 'running' -and $mtime -and (($now - $mtime).TotalSeconds -gt $StaleSecs)) { $stale += $dir; continue }
  if ($OlderThan -gt 0 -and ($state -eq 'done' -or $state -eq 'error') -and $m.startedAt) {
    if (($now - [datetime]$m.startedAt).TotalDays -gt $OlderThan) { $old += $dir; continue }
  }
  $kept++
}
"root: $root"; "stale (running but dead): $($stale.Count)"; $stale | ForEach-Object { "  $($_.Name)" }
if ($OlderThan -gt 0) { "old finished (> $OlderThan d): $($old.Count)"; $old | ForEach-Object { "  $($_.Name)" } }
$targets = $stale + $old
if (-not $targets) { 'nothing to clean.'; return }
if ($Remove) { $targets | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }; "removed $($targets.Count) dir(s). kept $kept." }
else { "DRY-RUN — re-run with -Remove to delete the $($targets.Count) dir(s) above." }
```

Run the dry-run first, show the user the list, and only re-run with `--remove` once they
confirm. After removal, `/cli-dispatch:sessions` and the dashboard will no longer show the
stale "running" entries.
