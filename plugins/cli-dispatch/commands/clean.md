---
description: Clean up stale worker session dirs (running-but-dead), leftover worktree artifacts, and optionally old finished sessions
allowed-tools: Bash
---

# cli-dispatch clean

Worker sessions live under `~/.cache/cli-dispatch/sessions/<id>/`. A worker that was killed
before it finalized (Ctrl-C, the parent CLI closed mid-run, crash, watchdog kill, or a codex/
OpenCode/Copilot provisional `cx-<ts>-<pid>`/`oc-<ts>-<pid>`/`cp-<ts>-<pid>` dir that never relocated to its
thread-id/session-id) leaves `status.json`
stuck at `state:"running"` forever — it shows up as **stale** in `/cli-dispatch:sessions` and
the dashboard, and never gets removed. This command finds and (with `--remove`) deletes them.

It also sweeps **leftover worktree artifacts**: real-repo-changing delegations (via
`/cli-dispatch:run` — the deterministic runner — or a plain `*-agent` CLI) are isolated in a
git worktree named `<backend>-wt-*` (`ds-wt-*`, `ag-wt-*`, `cx-wt-*`, `oc-wt-*`, `cp-wt-*`)
under `/tmp` / `$TMPDIR` (`$env:TEMP` on Windows). A delegation that crashes or is killed
before its own cleanup leaves that worktree behind forever; this sweep finds and (with
`--remove`) deletes those too.

**Detection** = `status.json` mtime: `state:"running"` with no write for longer than the
stale window ⇒ dead. **Default is a dry-run** (lists only); pass `--remove` to delete.

- `--remove` — actually delete (default: dry-run, just list). Applies to both the session
  cleanup and the worktree sweep.
- `--stale-secs N` — idle window before a `running` session dir counts as stale (default
  `600` = 10 min; deliberately larger than the dashboard's 90 s so a live-but-quiet turn is
  never deleted).
- `--older-than DAYS` — ALSO prune finished (`done`/`error`) session dirs whose
  `meta.startedAt` is older than DAYS. Omit to leave all finished sessions alone.
- `--preserve-verdicts` — archive `verdict.json` and `verdict-diff.patch` into
  `<sessions-root>/verdict-archive/` before removal.
- `--worktree-days N` — idle window (dir mtime) before a `*-wt-*` worktree artifact counts as
  stale (default `3` days).
- `--skip-worktrees` — disable the worktree-artifact sweep entirely (session cleanup only).
- `--quiet` — suppress non-essential output for both the session cleanup and the worktree
  sweep (used by the scheduled auto-clean).

A genuinely-running worker (recent `status.json` write) is NEVER touched. A worktree with
uncommitted changes (`git status --porcelain` non-empty) is NEVER touched either — it is
reported as `DIRTY (skipped, uncommitted changes)` so you can rescue it by hand. A `*-wt-*`
dir that isn't a valid git worktree (broken/missing `.git`) is also left alone and reported as
`SKIP (git status failed — not a valid worktree?)`. After deleting a worktree, if its source
repo can be resolved from the worktree's `.git` gitdir pointer, `git worktree prune` is run
against that source repo (best-effort — silently skipped if the source repo no longer exists
or can't be resolved) so the source repo's own `git worktree list` doesn't keep a dangling
administrative entry.

```bash
ARGS="$*"   # pass through the command args (e.g. --remove --older-than 7)
REMOVE=0; STALE_SECS=600; OLDER_DAYS=0; PRESERVE_VERDICTS=0; WT_DAYS=3; SKIP_WORKTREES=0; QUIET=0
set -- $ARGS
while [ "$#" -gt 0 ]; do
  case "$1" in
    --remove) REMOVE=1; shift;;
    --stale-secs) STALE_SECS="$2"; shift 2;;
    --older-than) OLDER_DAYS="$2"; shift 2;;
    --preserve-verdicts) PRESERVE_VERDICTS=1; shift;;
    --worktree-days) WT_DAYS="$2"; shift 2;;
    --skip-worktrees) SKIP_WORKTREES=1; shift;;
    --quiet) QUIET=1; shift;;
    *) shift;;
  esac
done
case "$STALE_SECS" in ''|*[!0-9]*) STALE_SECS=600;; esac
case "$OLDER_DAYS"  in ''|*[!0-9]*) OLDER_DAYS=0;; esac
case "$WT_DAYS"     in ''|*[!0-9]*) WT_DAYS=3;; esac

# ---- worktree artifact sweep -------------------------------------------------------------
# Real-repo-changing delegations (via /cli-dispatch:run or a plain *-agent CLI) are isolated
# in a git worktree named <backend>-wt-* under /tmp / $TMPDIR; one that crashes or is killed
# before its own cleanup leaves that worktree behind forever. Dirty worktrees (uncommitted
# changes) are never touched.
wtlog() { [ "$QUIET" -eq 1 ] || echo "$@"; }
if [ "$SKIP_WORKTREES" -ne 1 ]; then
  GIT_BIN="$(command -v git 2>/dev/null || true)"
  if [ -z "$GIT_BIN" ]; then
    for cand in /usr/bin/git /opt/homebrew/bin/git /usr/local/bin/git; do
      [ -x "$cand" ] && { GIT_BIN="$cand"; break; }
    done
  fi
  WT_FOUND=0; WT_DIRTY=0; WT_REMOVED=0; WT_SKIPPED=0
  PRUNED_REPOS=""
  sweep_wt_dir() {
    local base="$1" wt gitdir_line src_repo git_out git_rc
    [ -d "$base" ] || return 0
    while IFS= read -r -d '' wt; do
      [ -d "$wt" ] || continue
      WT_FOUND=$((WT_FOUND + 1))
      if [ -z "$GIT_BIN" ]; then
        wtlog "  SKIP (git unavailable) $wt"; WT_SKIPPED=$((WT_SKIPPED + 1)); continue
      fi
      git_rc=0
      git_out="$("$GIT_BIN" -C "$wt" status --porcelain 2>/dev/null)" || git_rc=$?
      if [ "$git_rc" -ne 0 ]; then
        wtlog "  SKIP (git status failed — not a valid worktree?) $wt"; WT_SKIPPED=$((WT_SKIPPED + 1)); continue
      fi
      if [ -n "$git_out" ]; then
        wtlog "  DIRTY (skipped, uncommitted changes) $wt"; WT_DIRTY=$((WT_DIRTY + 1)); continue
      fi
      wtlog "  worktree stale (clean, idle > ${WT_DAYS}d): $wt"
      if [ "$REMOVE" -eq 1 ]; then
        src_repo=""
        if [ -f "$wt/.git" ]; then
          gitdir_line="$(sed -n 's/^gitdir: //p' "$wt/.git" 2>/dev/null | head -1)"
          case "$gitdir_line" in
            */.git/worktrees/*) src_repo="${gitdir_line%/.git/worktrees/*}";;
          esac
        fi
        rm -rf "$wt"
        WT_REMOVED=$((WT_REMOVED + 1))
        if [ -n "$src_repo" ] && [ -d "$src_repo" ]; then
          case " $PRUNED_REPOS " in
            *" $src_repo "*) ;;
            *) "$GIT_BIN" -C "$src_repo" worktree prune >/dev/null 2>&1 || true; PRUNED_REPOS="$PRUNED_REPOS $src_repo";;
          esac
        fi
      fi
    done < <(find "$base" -mindepth 1 -maxdepth 1 -type d -name '*-wt-*' -mtime +"$WT_DAYS" -print0 2>/dev/null)
  }
  wtlog "worktree artifact sweep (pattern *-wt-*, older than ${WT_DAYS}d):"
  sweep_wt_dir "/tmp"
  if [ -n "${TMPDIR:-}" ] && [ "${TMPDIR%/}" != "/tmp" ]; then sweep_wt_dir "${TMPDIR%/}"; fi
  WT_ELIGIBLE=$((WT_FOUND - WT_DIRTY - WT_SKIPPED))
  if [ "$WT_FOUND" -eq 0 ]; then
    wtlog "  none found."
  elif [ "$REMOVE" -eq 1 ]; then
    wtlog "  removed $WT_REMOVED worktree(s), skipped $WT_DIRTY dirty, $WT_SKIPPED unreadable."
  else
    wtlog "  DRY-RUN — $WT_ELIGIBLE of $WT_FOUND candidate(s) would be deleted ($WT_DIRTY dirty, $WT_SKIPPED unreadable — both kept). Re-run with --remove to delete."
  fi
fi

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
[ -n "$ROOT" ] || { ROOT="$CACHE/cli-dispatch/sessions"; [ -d "$ROOT" ] || ROOT="$CACHE/claude-ds/sessions"; }
[ -d "$ROOT" ] || { echo "(no sessions dir: $ROOT)"; exit 0; }

REMOVE=$REMOVE STALE_SECS=$STALE_SECS OLDER_DAYS=$OLDER_DAYS PRESERVE_VERDICTS=$PRESERVE_VERDICTS ROOT="$ROOT" node <<'EOF'
const fs=require('fs'), path=require('path')
const root=process.env.ROOT, remove=process.env.REMOVE==='1', preserveVerdicts=process.env.PRESERVE_VERDICTS==='1'
const staleSecs=+process.env.STALE_SECS, olderDays=+process.env.OLDER_DAYS
const now=Date.now()
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return{}}}
const hasVerdictPatch = (dir)=>{try{return fs.statSync(path.join(dir,'verdict-diff.patch')).size>0}catch{return false}}
const hasVerdictJson = (dir)=>{try{return fs.statSync(path.join(dir,'verdict.json')).isFile()}catch{return false}}
let stale=[], old=[], kept=0, patchCandidates=0
for(const d of fs.readdirSync(root)){
  if (d==='verdict-archive') continue
  const dir=path.join(root,d); let s
  try{ if(!fs.statSync(dir).isDirectory()) continue }catch{ continue }
  const st=read(path.join(dir,'status.json')), m=read(path.join(dir,'meta.json'))
  const state=st.state||m.state||'?'
  const verdictPatch=hasVerdictPatch(dir), verdictJson=hasVerdictJson(dir)
  const verdictMarker = verdictPatch ? '  ⚠ has verdict patch' : ''
  let mtime=0; try{ mtime=fs.statSync(path.join(dir,'status.json')).mtimeMs }catch{}
  const idle=mtime?Math.round((now-mtime)/1000):null
  if(state==='running' && mtime && (now-mtime > staleSecs*1000)){
    if(verdictPatch) patchCandidates++
    stale.push({d,backend:st.backend||m.backend||'?',idle,verdictPatch,verdictJson,verdictMarker}); continue
  }
  if(olderDays>0 && (state==='done'||state==='error')){
    const started=Date.parse(m.startedAt||'')||0
    if(started && (now-started > olderDays*86400*1000)){
      if(verdictPatch) patchCandidates++
      old.push({d,backend:st.backend||m.backend||'?',state,started:m.startedAt,verdictPatch,verdictJson,verdictMarker}); continue
    }
  }
  kept++
}
const archiveRoot=path.join(root,'verdict-archive')
const rm=(d)=>fs.rmSync(path.join(root,d),{recursive:true,force:true})
const days=s=>s==null?'?':(s>86400?(s/86400).toFixed(1)+'d':(s/3600).toFixed(1)+'h')
console.log(`root: ${root}`)
console.log(`stale (running but dead, idle > ${staleSecs}s): ${stale.length}`)
for(const x of stale) console.log(`  ${x.backend.padEnd(11)} ${x.d}  idle ${days(x.idle)}${x.verdictMarker}`)
if(olderDays>0){
  console.log(`old finished (done/error, started > ${olderDays}d ago): ${old.length}`)
  for(const x of old) console.log(`  ${x.backend.padEnd(11)} ${x.state.padEnd(6)} ${x.d}  ${x.started}${x.verdictMarker}`)
}
const targets=[...stale, ...old]
if(!targets.length){ console.log('nothing to clean.'); process.exit(0) }
if(remove){
  let n=0, archived=0
  for(const x of targets){
    if(preserveVerdicts && (x.verdictPatch||x.verdictJson)){
      let copied=false
      try{
        fs.mkdirSync(archiveRoot,{recursive:true})
        if(x.verdictPatch){ fs.copyFileSync(path.join(root,x.d,'verdict-diff.patch'),path.join(archiveRoot,`${x.d}.patch`)); copied=true }
        if(x.verdictJson){ fs.copyFileSync(path.join(root,x.d,'verdict.json'),path.join(archiveRoot,`${x.d}.json`)); copied=true }
      }catch(e){ console.log(`  note: archive failed for ${x.d}: ${e.message}`) }
      if(copied) archived++
    }
    try{ rm(x.d); n++ }catch(e){ console.log(`  FAILED ${x.d}: ${e.message}`) }
  }
  console.log(`\nremoved ${n}/${targets.length} dir(s). kept ${kept} live/recent. archived verdicts for ${archived} session(s).`)
}else{
  console.log(`\nDRY-RUN — nothing deleted. Re-run with --remove to delete the ${targets.length} dir(s) above.`)
  if (patchCandidates) console.log(`note: ${patchCandidates} candidate(s) carry a verdict-diff.patch (possible unapplied recovery diff) — use --preserve-verdicts to archive them on removal.`)
}
EOF
```

**Native Windows** (PowerShell equivalent):

```powershell
param([switch]$Remove, [switch]$PreserveVerdicts, [int]$StaleSecs = 600, [int]$OlderThan = 0, [int]$WorktreeDays = 3, [switch]$SkipWorktrees, [switch]$Quiet)

# ---- worktree artifact sweep -------------------------------------------------------------
# Real-repo-changing runs are isolated in a git worktree named <backend>-wt-* under
# $env:TEMP; a delegation that crashes or is killed before its own cleanup leaves that
# worktree behind forever. Dirty worktrees (uncommitted changes) are never touched.
function Write-WtLog($msg) { if (-not $Quiet) { Write-Host $msg } }
if (-not $SkipWorktrees) {
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCmd) {
    $gitCandidates = @(
      (Join-Path $env:ProgramFiles "Git\bin\git.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Git\bin\git.exe"),
      (Join-Path $env:LOCALAPPDATA "Programs\Git\bin\git.exe")
    )
    foreach ($cand in $gitCandidates) { if ($cand -and (Test-Path $cand)) { $gitCmd = $cand; break } }
  }
  $gitBin = if ($gitCmd -is [System.Management.Automation.CommandInfo]) { $gitCmd.Source } else { $gitCmd }
  $tmpRoot = $env:TEMP
  Write-WtLog "worktree artifact sweep (pattern *-wt-*, older than ${WorktreeDays}d):"
  $wtFound = 0; $wtDirty = 0; $wtRemoved = 0; $wtSkipped = 0; $prunedRepos = @()
  if ($tmpRoot -and (Test-Path $tmpRoot)) {
    $cutoff = (Get-Date).AddDays(-$WorktreeDays)
    $candidates = Get-ChildItem -Path $tmpRoot -Directory -Filter "*-wt-*" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff }
    foreach ($wt in $candidates) {
      $wtFound++
      if (-not $gitBin) { Write-WtLog "  SKIP (git unavailable) $($wt.FullName)"; $wtSkipped++; continue }
      $statusOut = & $gitBin -C $wt.FullName status --porcelain 2>$null
      if ($LASTEXITCODE -ne 0) { Write-WtLog "  SKIP (git status failed - not a valid worktree?) $($wt.FullName)"; $wtSkipped++; continue }
      if ($statusOut) { Write-WtLog "  DIRTY (skipped, uncommitted changes) $($wt.FullName)"; $wtDirty++; continue }
      Write-WtLog "  worktree stale (clean, idle > ${WorktreeDays}d): $($wt.FullName)"
      if ($Remove) {
        $srcRepo = $null
        $gitFile = Join-Path $wt.FullName ".git"
        if (Test-Path $gitFile -PathType Leaf) {
          try {
            $gitdirLine = (Get-Content -Raw $gitFile) -split "`r?`n" | Where-Object { $_ -match '^gitdir:\s*(.+)$' } | Select-Object -First 1
            if ($gitdirLine -match '^gitdir:\s*(.+)$') {
              $gitdirPath = $Matches[1].Trim()
              $marker = [regex]::Escape("$([System.IO.Path]::DirectorySeparatorChar).git$([System.IO.Path]::DirectorySeparatorChar)worktrees$([System.IO.Path]::DirectorySeparatorChar)")
              if ($gitdirPath -match "(.+?)$marker") { $srcRepo = $Matches[1] }
              elseif ($gitdirPath -match "(.+?)/\.git/worktrees/") { $srcRepo = $Matches[1] }
            }
          } catch {}
        }
        Remove-Item -Recurse -Force $wt.FullName
        $wtRemoved++
        if ($srcRepo -and (Test-Path $srcRepo) -and ($prunedRepos -notcontains $srcRepo)) {
          try { & $gitBin -C $srcRepo worktree prune 2>$null | Out-Null } catch {}
          $prunedRepos += $srcRepo
        }
      }
    }
  }
  $wtEligible = $wtFound - $wtDirty - $wtSkipped
  if ($wtFound -eq 0) { Write-WtLog "  none found." }
  elseif ($Remove) { Write-WtLog "  removed $wtRemoved worktree(s), skipped $wtDirty dirty, $wtSkipped unreadable." }
  else { Write-WtLog "  DRY-RUN - $wtEligible of $wtFound candidate(s) would be deleted ($wtDirty dirty, $wtSkipped unreadable - both kept). Re-run with -Remove to delete." }
}

$cache = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME '.cache' }
$root = if ($env:CLI_DISPATCH_SESSIONS_DIR) { $env:CLI_DISPATCH_SESSIONS_DIR } elseif ($env:CLAUDE_DS_SESSIONS_DIR) { $env:CLAUDE_DS_SESSIONS_DIR } elseif (Test-Path (Join-Path $cache 'cli-dispatch/sessions')) { Join-Path $cache 'cli-dispatch/sessions' } else { Join-Path $cache 'claude-ds/sessions' }
if (-not (Test-Path $root)) { "(no sessions dir: $root)"; return }
$now = Get-Date; $stale = @(); $old = @(); $kept = 0; $patchCandidates=0
foreach ($dir in Get-ChildItem -Directory $root) {
  if ($dir.Name -eq 'verdict-archive') { continue }
  $verdictDiffPath = Join-Path $dir.FullName 'verdict-diff.patch'
  $verdictJsonPath = Join-Path $dir.FullName 'verdict.json'
  $hasVerdictPatch = (Test-Path $verdictDiffPath) -and ((Get-Item $verdictDiffPath).Length -gt 0)
  $hasVerdictJson = Test-Path $verdictJsonPath
  $st = @{}; $m = @{}
  try { $st = Get-Content -Raw (Join-Path $dir.FullName 'status.json') | ConvertFrom-Json } catch {}
  try { $m  = Get-Content -Raw (Join-Path $dir.FullName 'meta.json')   | ConvertFrom-Json } catch {}
  $state = if ($st.state) { $st.state } elseif ($m.state) { $m.state } else { '?' }
  $sf = Join-Path $dir.FullName 'status.json'
  $mtime = if (Test-Path $sf) { (Get-Item $sf).LastWriteTime } else { $null }
  $backend = if ($st.backend) { $st.backend } elseif ($m.backend) { $m.backend } else { '?' }
  $marker = if ($hasVerdictPatch) { '  ⚠ has verdict patch' } else { '' }
  if ($state -eq 'running' -and $mtime -and (($now - $mtime).TotalSeconds -gt $StaleSecs)) {
    if ($hasVerdictPatch) { $patchCandidates += 1 }
    $stale += [PSCustomObject]@{ d=$dir.Name; backend=$backend; idle=[math]::Round(($now - $mtime).TotalSeconds); marker=$marker; verdictPatch=$hasVerdictPatch; verdictJson=$hasVerdictJson }
    continue
  }
  if ($OlderThan -gt 0 -and ($state -eq 'done' -or $state -eq 'error') -and $m.startedAt) {
    if (($now - [datetime]$m.startedAt).TotalDays -gt $OlderThan) {
      if ($hasVerdictPatch) { $patchCandidates += 1 }
      $old += [PSCustomObject]@{ d=$dir.Name; backend=$backend; state=$state; started=$m.startedAt; marker=$marker; verdictPatch=$hasVerdictPatch; verdictJson=$hasVerdictJson }
      continue
    }
  }
  $kept++
}
"root: $root"
"stale (running but dead): $($stale.Count)"
$stale | ForEach-Object { "  $($_.backend.PadRight(11)) $($_.d)  idle $([math]::Round($_.idle / 3600, 1))h$($_.marker)" }
if ($OlderThan -gt 0) {
  "old finished (> $OlderThan d): $($old.Count)"
  $old | ForEach-Object { "  $($_.backend.PadRight(11))  $($_.state.PadRight(6)) $($_.d)  $($_.started)$($_.marker)" }
}
$targets = $stale + $old
if (-not $targets) { 'nothing to clean.'; return }
if ($Remove) {
  $archiveRoot = Join-Path $root 'verdict-archive'
  $archived = 0
  foreach ($x in $targets) {
    $sessionDir = Join-Path $root $x.d
    $didArchive = $false
    if ($PreserveVerdicts -and ($x.verdictPatch -or $x.verdictJson)) {
      try {
        New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
        if ($x.verdictPatch) { Copy-Item -LiteralPath (Join-Path $sessionDir 'verdict-diff.patch') -Destination (Join-Path $archiveRoot "$($x.d).patch") -Force; $didArchive = $true }
        if ($x.verdictJson) { Copy-Item -LiteralPath (Join-Path $sessionDir 'verdict.json') -Destination (Join-Path $archiveRoot "$($x.d).json") -Force; $didArchive = $true }
      } catch { "  note: archive failed for $($x.d): $($_.Exception.Message)" }
    }
    if ($didArchive) { $archived += 1 }
    Remove-Item -Recurse -Force $sessionDir
  }
  "removed $($targets.Count) dir(s). kept $kept. archived verdicts for $archived session(s)."
} else {
  "DRY-RUN — re-run with -Remove to delete the $($targets.Count) dir(s) above."
  if ($patchCandidates) { "note: $patchCandidates candidate(s) carry a verdict-diff.patch (possible unapplied recovery diff) — use -PreserveVerdicts to archive them on removal." }
}
```

Run the dry-run first, show the user the list, and only re-run with `--remove` once they
confirm. After removal, `/cli-dispatch:sessions` and the dashboard will no longer show the
stale "running" entries.
