export const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cli-dispatch dashboard</title>
<link rel="stylesheet" href="/vendor/xterm.css">
<script src="/vendor/xterm.js"></script>
<script src="/vendor/xterm-addon-fit.js"></script>
<script>(function(){var t=localStorage.getItem("cli-dispatch-theme");t=t||(window.matchMedia("(prefers-color-scheme:light)").matches?"light":"dark");document.documentElement.setAttribute("data-theme",t);var rs=localStorage.getItem("cli-dispatch-rail-w");if(rs!==null){var rw=Number(rs);if(!isNaN(rw)&&rw>0){rw=Math.max(260,Math.min(400,rw));document.documentElement.style.setProperty("--rail-w",rw+"px")}}})()</script><style>
:root{--rail-w:320px;--side-w:320px}
html[data-theme="dark"]{--bg:#0a0a0a;--panel:#111111;--bd:#2e2e2e;--fg:#ededed;--dim:#8f8f8f;--accent:#52a9ff;--success:#3dd68c;--warning:#ffb224;--error:#ff6369;--hover:#1a1a1a;--code-bg:#161616;--err-bg:rgba(255,99,105,.08);--ok-bg:rgba(61,214,140,.07);--wk-panel:#0a1628;--human:#a371f7;--term-bg:#000000}html[data-theme="light"]{--bg:#fafafa;--panel:#ffffff;--bd:#eaeaea;--fg:#171717;--dim:#666666;--accent:#0070f3;--success:#0f9d58;--warning:#a35200;--error:#e5484d;--hover:#f2f2f2;--code-bg:#f5f5f5;--err-bg:rgba(229,72,77,.06);--ok-bg:rgba(15,157,88,.06);--wk-panel:#f0f6ff;--human:#a371f7;--term-bg:#000000}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}.step,.term-wrap,.term-flow,.md-code,.md-pre,#tkTerm{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
header{padding:8px 14px;border-bottom:1px solid var(--bd);display:flex;gap:10px;align-items:center}
header b{color:var(--accent)} .grow{flex:1}
.layout{display:grid;grid-template-columns:var(--rail-w) 5px 1fr var(--side-w);height:calc(100vh - 41px)}
.drag-handle{width:5px;cursor:col-resize;background:transparent;display:flex;align-items:center;justify-content:center;transition:background-color .15s;grid-column:2;grid-row:1}
.drag-handle::before{content:"";width:1px;height:24px;background:var(--bd)}
.drag-handle:hover{background:var(--hover)}
.rail{border-right:1px solid var(--bd);overflow:auto;grid-column:1;grid-row:1}
.side-panel{border-left:1px solid var(--bd);overflow:auto;padding:14px;grid-column:4;grid-row:1}
.side-panel:empty{display:none}
.tabs{display:flex;border-bottom:1px solid var(--bd)} .tab{flex:1;padding:8px;text-align:center;cursor:pointer;color:var(--dim)}
.tab.on{color:var(--fg);border-bottom:2px solid var(--fg)}
.filter{display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
.fchip{padding:2px 9px;border:1px solid var(--bd);border-radius:8px;cursor:pointer;color:var(--dim);font-size:11px;user-select:none}
.fchip:hover{background:var(--hover)}.fchip.on{color:var(--fg);border-color:var(--accent)}
.fchip .c{color:var(--dim);margin-left:3px}
.item{padding:8px 12px;border-bottom:1px solid var(--bd);cursor:pointer}
.item:hover{background:var(--hover)}.item.sel{background:var(--hover)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.busy{background:var(--success)}.idle{background:var(--warning)}.closed{background:var(--bd)}
.dead{background:var(--error)}
.muted{color:var(--dim)}.small{font-size:11px}
.main{overflow:auto;padding:14px;grid-column:3;grid-row:1}
.crumb{margin-bottom:10px;color:var(--dim)}.crumb a{color:var(--accent);cursor:pointer;text-decoration:none}
.badge{border:1px solid var(--bd);border-radius:6px;padding:1px 7px;font-size:11px;color:var(--dim);margin-left:6px;white-space:nowrap}
.step{padding:6px 10px;border-left:2px solid var(--bd);margin:4px 0}
.step.tool{border-color:var(--accent)}.step.prompt{border-color:var(--accent)}.step.message{border-color:var(--accent)}
.step.thinking{border-color:var(--bd);color:var(--accent);font-style:italic}.step.log{border-color:var(--bd)}
.step.errline{border-color:var(--error);color:var(--error);background:var(--err-bg)}
.step.result{border-color:var(--bd);margin:2px 0 2px 14px;padding:2px 8px;font-size:11px;color:var(--dim)}
.step.result.ok{color:var(--success);background:var(--ok-bg)}.step.result.err{color:var(--error);background:var(--err-bg)}
.k{color:var(--accent)}.ok{color:var(--success)}.err{color:var(--error)}
.md{display:inline}.md>div{margin:1px 0}.md-h{font-weight:700;color:var(--fg);margin:6px 0 2px}
.md-ul{margin:2px 0;padding-left:18px}.md-ul li{margin:1px 0}
.md-code{background:var(--hover);border:1px solid var(--bd);border-radius:4px;padding:0 4px;font-size:12px}
.md-pre{background:var(--code-bg);border:1px solid var(--bd);border-radius:6px;padding:8px 10px;margin:4px 0;overflow:auto;white-space:pre-wrap;color:var(--fg)}
.md a{color:var(--accent)}.md strong{color:var(--fg)}
.panel.task .md,.scrollbox{max-height:38vh;overflow:auto}.panel.task .sabody{padding-top:4px}
.sa{display:inline-block;margin:3px 6px 3px 0;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;cursor:pointer;color:var(--accent)}
.sa:hover{background:var(--hover)}.empty{color:var(--dim);padding:20px}
.panel{border:1px solid var(--bd);border-radius:8px;margin-bottom:10px;background:var(--panel)}
.panel>summary{cursor:pointer;padding:8px 12px;color:var(--fg);list-style:none;user-select:none}
.panel>summary::-webkit-details-marker{display:none}
.panel>summary::before{content:'▸ ';color:var(--dim)}
.panel[open]>summary::before{content:'▾ ';color:var(--dim)}
.panel>summary:hover{background:var(--hover)}
.sabody{padding:2px 8px 8px}
.panel.act{border-color:var(--success);background:var(--ok-bg)}
.panel.act>summary{color:var(--success)}
.panel.bad{border-color:var(--error);background:var(--err-bg)}
.panel.bad>summary{color:var(--error)}
.panel.wk{border-color:var(--accent);background:var(--wk-panel)}
.panel.wk>summary{color:var(--accent)}
.sa.act{border-color:var(--success);color:var(--success)}
.live{color:var(--success)}
a.agentlink{color:var(--accent);cursor:pointer}
.human{background:var(--human)}
.badge.human{border-color:var(--human);color:var(--human)}
.badge.warn{border-color:var(--warning);color:var(--warning)}
.badge.err{border-color:var(--error);color:var(--error)}
.badge.pass{border-color:var(--success);color:var(--success)}
.badge.fail{border-color:var(--error);color:var(--error)}
.badge.run{border-color:var(--accent);color:var(--accent)}
.item .l1{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.item .l1 .badge{margin-left:0}
.item .l1 .c{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vrow{display:flex;gap:6px;align-items:flex-start}.vrow>pre{flex:1;min-width:0;margin:4px 0}
.item .ell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Worker row, metadata line: left tokens take the space that is left, the start time sits at the
   right edge. nowrap on .when so a 260px rail truncates the repo name, never the timestamp. */
.item .l4{display:flex;align-items:baseline;gap:6px}
.item .l4 .lt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .l4 .when{margin-left:auto;white-space:nowrap}
.pathline{word-break:break-all}
.warnt{color:var(--warning)}
#takeover{display:none;margin-bottom:10px}
.tkbar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tkbtn{background:var(--hover);border:1px solid var(--bd);color:var(--fg);border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
.tkbtn:hover{background:var(--hover);border-color:var(--accent)}
.tkbtn-off{border-color:var(--human);color:var(--human)}
.term-wrap{border:1px solid var(--bd);border-radius:8px;padding:6px;background:var(--term-bg);height:380px}
.term-flow{border:1px solid var(--bd);border-radius:8px;padding:8px 12px;background:var(--term-bg);margin:10px 0}
.term-flow .step.prompt{font-weight:600}
#tkTerm{height:100%}
input.cfg-input{background:var(--bg);border:1px solid var(--bd);color:var(--fg);border-radius:6px;padding:6px 10px;font:inherit;width:100%;max-width:420px;margin-right:8px}
input.cfg-input:focus{border-color:var(--accent);outline:none}
.cfg-row{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--bd)}
.cfg-row:last-child{border-bottom:none}
.cfg-label{font-weight:bold;display:flex;align-items:center;gap:8px}
.cfg-field{display:flex;align-items:center;margin-top:4px}
#cleanPanel{margin:8px 14px;padding:10px;border:1px solid var(--bd);border-radius:8px;background:var(--panel);max-width:600px}
#cleanPanel .clean-item{padding:4px 0;border-bottom:1px solid var(--bd);font-size:12px}
#cleanPanel .clean-item:last-child{border-bottom:none}
.worker-overview{padding:4px}
.worker-overview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.worker-overview-card{background:var(--panel);border:1px solid var(--bd);border-radius:8px;padding:8px}
.worker-overview-card .worker-overview-name{font-weight:700;margin-bottom:4px}
body.dragging-rail,body.dragging-rail *{user-select:none}
@media (max-width:1100px){.layout{grid-template-columns:min(var(--rail-w),260px) 1fr}.drag-handle{display:none}.main{grid-column:2}.rail{grid-column:1}.side-panel{display:none}}
</style></head><body>
<header><b>cli-dispatch</b> <span class="muted">dashboard</span><span class="grow"></span>
<span class="small muted" id="meta"></span><button class="tkbtn" id="themeBtn" onclick="var h=document.documentElement;var n=h.getAttribute('data-theme')==='light'?'dark':'light';h.setAttribute('data-theme',n);localStorage.setItem('cli-dispatch-theme',n);this.textContent=n==='dark'?'☀':'☾'" title="Toggle theme" style="font-size:13px;padding:2px 8px">☀</button><button class="tkbtn" id="configBtn" onclick="openConfigView()" title="Configuration" style="font-size:13px;padding:2px 8px;margin-left:6px">⚙</button><script>document.getElementById("themeBtn").textContent=document.documentElement.getAttribute("data-theme")==="dark"?"☀":"☾"</script></header>
<div id="cleanPanel" style="display:none"></div>
<div class="layout">
 <div class="rail">
   <div class="tabs"><div class="tab on" id="tabCC">Sessions</div><div class="tab" id="tabW">Workers</div></div>
   <div id="filter" class="filter"></div>
   <div id="list"></div>
 </div>
 <div class="drag-handle" id="railDrag" title="Resize rail"></div>
 <div class="main"><div class="crumb" id="crumb">Select a session…</div><div id="takeover"></div><div id="view" class="empty">Select a session from the list</div></div>
 <div class="side-panel" id="sidePanel"></div>
</div>
<script>
let mode='cc', sel=null, flt='busy', wFlt='all', loadListGen=0
function setFilter(k){ flt=k; loadList() }
function setWFilter(k){ wFlt=k; loadList() }
const RAIL_MIN=260, RAIL_MAX=400
let railDragState={active:false,pointerId:-1,startX:0,startW:0}
function clampRailW(n){ n=Number(n); if(isNaN(n)) return 320; if(n<RAIL_MIN) return RAIL_MIN; if(n>RAIL_MAX) return RAIL_MAX; return n}
function updateRailHandle(e){
  if(!railDragState.active) return
  const w=clampRailW(railDragState.startW + e.clientX - railDragState.startX)
  document.documentElement.style.setProperty('--rail-w',w+'px')
}
function finalizeRailDrag(e){
  if(!railDragState.active) return
  if(railDragState.pointerId===e.pointerId){
    try{ document.getElementById('railDrag').releasePointerCapture(e.pointerId) }catch(ex){}
  }
  railDragState.active=false
  railDragState.pointerId=-1
  document.removeEventListener('pointermove',updateRailHandle)
  document.removeEventListener('pointerup',finalizeRailDrag)
  document.removeEventListener('pointercancel',finalizeRailDrag)
  document.body.classList.remove('dragging-rail')
  localStorage.setItem('cli-dispatch-rail-w',clampRailW(document.documentElement.style.getPropertyValue('--rail-w')?Number(document.documentElement.style.getPropertyValue('--rail-w').replace('px','')):320))
}
function initRailDrag(){
  const h=document.getElementById('railDrag')
  if(!h) return
  h.addEventListener('pointerdown', (e)=>{
    e.preventDefault()
    const rw=clampRailW(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-w')))
    railDragState={active:true,pointerId:e.pointerId,startX:e.clientX,startW:rw}
    h.setPointerCapture(e.pointerId)
    document.body.classList.add('dragging-rail')
    document.addEventListener('pointermove',updateRailHandle)
    document.addEventListener('pointerup',finalizeRailDrag)
    document.addEventListener('pointercancel',finalizeRailDrag)
  })
}
function hasOpenDetailView(){ return !!(window._cur && (window._cur.type==='session' || window._cur.type==='sub' || window._cur.type==='worker' || window._cur.type==='config')) }
function setEmptyMainState(){
  const text=mode==='w'?'Select a worker from the list':'Select a session from the list'
  const v=document.getElementById('view')
  if(v._k==='empty:'+mode && v._h===text) return
  v._k='empty:'+mode; v._h=text; v.className='empty'; v.innerHTML=text
}
// Summarises the deterministic runner across all rows. Computed client-side from the array
// loadList already has in hand — no new endpoint, and guaranteed consistent with the chip counts.
function runsSummaryHtml(rows){
  if(!rows||!rows.length) return ''
  const runs=rows.filter(w=>w.hasVerdict)
  if(!runs.length) return ''
  let pass=0,fail=0,harness=0,none=0
  runs.forEach(w=>{
    const v=w.verdict&&w.verdict.verify
    if(v==='pass') pass++
    else if(v==='fail') fail++
    else if(v==='harness') harness++
    else none++
  })
  const bits=['runs '+runs.length]
  if(pass) bits.push('<span class="ok">verify ✓ '+pass+'</span>')
  if(fail) bits.push('<span class="err">✗ '+fail+'</span>')
  if(harness) bits.push('<span class="warnt">⚠ '+harness+'</span>')
  if(none) bits.push('<span class="muted">none '+none+'</span>')
  // Only the detail route resolves whether a worktree still exists, so this counts what was
  // RECORDED as stranded and points at the surface that can actually check.
  const stranded=runs.filter(w=>w.verdict&&w.verdict.stranded).length
  const tail=stranded?'<div class="small muted">'+stranded+' run'+(stranded===1?'':'s')+' recorded uncommitted changes in a worktree — see ⚙ Maintenance</div>':''
  return '<div class="small" style="margin-bottom:10px">'+bits.join(' · ')+'</div>'+tail
}
// Worker tokens that went to a NON-Anthropic backend. Deliberately worded "offloaded from
// Anthropic", not "saved": what is measured is which tokens did not hit the Anthropic account.
// Claiming a saving would be a counterfactual — an inline Claude would have used some different,
// unknown number of tokens for the same task — and this dashboard does not get to guess it.
//
// Both caveats ride along with the number instead of being left implicit, because without them a
// reader takes an under-reported total at face value:
//   - backends that expose no usage at all (agy exposes none) make the total a FLOOR, not a total;
//   - a killed worker leaves a mid-run snapshot, which is counted but flagged.
// The legacy babysitter cost that partially offsets this needs a walk of ~/.claude/projects, which
// is exactly the scan 4.3.0 removed from this route — so it stays in /cli-dispatch:gain.
function offloadSummaryHtml(agg){
  const keys=Object.keys(agg||{})
  if(!keys.length) return ''
  let inTok=0,outTok=0,sessions=0,noData=0,partial=0,runSessions=0,runIn=0,runOut=0
  keys.forEach(k=>{
    const a=agg[k]||{}
    inTok+=Number(a.inputTokens)||0
    outTok+=Number(a.outputTokens)||0
    sessions+=Number(a.sessions)||0
    noData+=Number(a.noDataSessions)||0
    partial+=Number(a.partialSessions)||0
    runSessions+=Number(a.runSessions)||0
    runIn+=Number(a.runInputTokens)||0
    runOut+=Number(a.runOutputTokens)||0
  })
  if(!inTok&&!outTok) return ''
  let h='<div class="small"><b>Offloaded from Anthropic</b> '
    + '<span class="ok">' + esc(fmtTok(inTok)) + ' in / ' + esc(fmtTok(outTok)) + ' out</span>'
    + ' <span class="muted">across ' + sessions + ' worker session' + (sessions===1?'':'s') + '</span></div>'
  if(runSessions>0){
    // The deterministic-runner subset is the cleanest evidence available: zero Anthropic babysitter
    // tokens by construction, because the runner is plain shell.
    h+='<div class="small muted">of which ' + runSessions + ' deterministic run'
      + (runSessions===1?'':'s') + ': ' + esc(fmtTok(runIn)) + ' in / ' + esc(fmtTok(runOut))
      + ' out, with no Anthropic supervision at all</div>'
  }
  const caveats=[]
  if(noData>0) caveats.push(noData + ' session' + (noData===1?'':'s') + ' report no usage, so this is a floor rather than a total')
  if(partial>0) caveats.push(partial + ' counted from a mid-run snapshot')
  if(caveats.length) h+='<div class="small warnt">' + esc(caveats.join(' · ')) + '</div>'
  h+='<div class="small muted">/cli-dispatch:gain adds the legacy babysitter cost that offsets this</div>'
  return '<div style="margin-bottom:10px">' + h + '</div>'
}

function workersOverviewHtml(agg, rows){
  const summary=offloadSummaryHtml(agg)+runsSummaryHtml(rows)
  const keys=Object.keys(agg||{}).sort()
  if(!keys.length) return summary+'<div class="empty">No usage data yet.</div>'
  const cards=keys.map(k=>{
    const a=agg[k]||{}
    const nd=Number(a.noDataSessions)||0
    return '<div class="worker-overview-card"><div class="worker-overview-name">'+esc(k)+'</div><div class="small muted">'+esc(fmtTok(a.inputTokens))+' in / '+esc(fmtTok(a.outputTokens))+' out</div>'+(nd?'<div class="small muted">'+nd+' sessions no data</div>':'')+'</div>'
  }).join('')
  return summary+'<div class="worker-overview"><div class="worker-overview-grid">'+cards+'</div></div>'
}
// Live updates via Server-Sent Events. One detail stream for the open item; it
// pushes a 'change' event whenever the watched file/dir changes (fs.watch).
let detailES=null, detailSpec=null, detailTimer=null
function watchDetail(spec, fn){
  if(spec===detailSpec) return
  if(detailES){ detailES.close(); detailES=null }
  if(detailTimer){ clearTimeout(detailTimer); detailTimer=null }
  detailSpec=spec||null
  if(!spec) return
  detailES=new EventSource('/api/stream?watch='+encodeURIComponent(spec))
  // Coalesce change bursts: at most one detail refresh per 600ms.
  detailES.addEventListener('change', ()=>{ if(detailTimer) return; detailTimer=setTimeout(()=>{ detailTimer=null; fn() },600) })
}
// Flicker-free view swap: skip the DOM write entirely when the rendered HTML is unchanged
// (fs.watch fires for plenty of writes that don't alter what we show), otherwise replace
// and restore the scroll position so a live refresh doesn't jump the reader to the top.
function setView(key,h){
  const v=document.getElementById('view'); v.className=''
  if(v._k===key&&v._h===h) return
  const sc=v.parentElement.scrollTop
  v._k=key; v._h=h; v.innerHTML=h
  v.parentElement.scrollTop=sc
}
const E=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstChild}
const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
const escAttr=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
// Minimal, XSS-safe Markdown renderer (escape-FIRST, then a whitelist of transforms; never
// passes raw HTML through). Used only for message/prompt/result text. BT avoids literal
// backticks (this whole page is a backtick template on the server side).
const BT=String.fromCharCode(96)
function mdInline(x){
  const cs=[]; const ps=x.split(BT); let r=''
  for(let i=0;i<ps.length;i++){ if(i%2===1){cs.push(ps[i]); r+=' C'+(cs.length-1)+' '} else r+=ps[i] }
  r=r.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
  r=r.replace(/\\*([^*]+)\\*/g,'<em>$1</em>')
  r=r.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,(m,tt,u)=>{const safe=/^(https?:\\/\\/|\\/)/.test(u)?u:'#';return '<a href="'+safe.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener">'+tt+'</a>'})
  r=r.replace(/ C(\\d+) /g,(m,i)=>'<code class="md-code">'+cs[+i]+'</code>')
  return r
}
function md(t){
  if(!t) return ''
  let s=esc(t)
  const blocks=[]; const parts=s.split(BT+BT+BT); s=''
  for(let i=0;i<parts.length;i++){ if(i%2===1){blocks.push(parts[i]); s+=' B'+(blocks.length-1)+' '} else s+=parts[i] }
  const lines=s.split('\\n'); const out=[]; let inList=false
  for(let ln of lines){
    if(/^ B\\d+ \\s*$/.test(ln)){ if(inList){out.push('</ul>');inList=false} out.push(ln); continue }
    let mh=ln.match(/^(#{1,4})\\s+(.*)$/)
    if(mh){ if(inList){out.push('</ul>');inList=false} out.push('<div class="md-h">'+mdInline(mh[2])+'</div>'); continue }
    let ml=ln.match(/^\\s*[-*]\\s+(.*)$/)
    if(ml){ if(!inList){out.push('<ul class="md-ul">');inList=true} out.push('<li>'+mdInline(ml[1])+'</li>'); continue }
    if(inList){out.push('</ul>');inList=false}
    if(ln.trim()==='') out.push('<br>'); else out.push('<div>'+mdInline(ln)+'</div>')
  }
  if(inList) out.push('</ul>')
  s=out.join('')
  s=s.replace(/ B(\\d+) /g,(m,i)=>'<pre class="md-pre">'+blocks[+i]+'</pre>')
  return s
}
// Times come from disk as UTC ISO; render in the viewer's local timezone.
const fmtTime=(iso)=>{const d=iso?new Date(iso):null;return d&&!isNaN(d)?d.toLocaleTimeString([],{hour12:false}):''}
const fmtDT=(iso)=>{const d=iso?new Date(iso):null;return d&&!isNaN(d)?d.toLocaleString([],{hour12:false}).replace(',',''):''}
// Worker cwd is a real filesystem path (often a throwaway worktree, e.g. /tmp/wt-603) rather
// than the CC tab's ~/.claude/projects/ dash-encoded name — last two path segments is the
// closest equivalent short label ("parent/leaf") without guessing at the origin repo.
const shortProj=(cwd)=>{if(!cwd) return '';const parts=cwd.split('/').filter(Boolean);return parts.slice(-2).join('/')}
const shortSessionProj=(project)=>project.replace(/^-/,'').split('-').slice(-2).join('/')
const fmtTok=(num)=>{num=Number(num)||0;if(num>=1000000)return (num/1000000).toFixed(1).replace(/\\.0$/,'')+'M';if(num>=1000)return (num/1000).toFixed(1).replace(/\\.0$/,'')+'K';return String(Math.round(num))}
const fmtUsage=(u,detailed)=>{
  if(!u) return null
  const inTok=u.inTok, outTok=u.outTok, costUsd=u.costUsd
  const abbreviate=(num)=>{
    if(num===undefined||num===null||isNaN(num)) return ''
    if(detailed) return String(num).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')
    if(num>=1000) return (num/1000).toFixed(1).replace(/\\.0$/,'')+'k'
    return String(num)
  }
  const inStr=abbreviate(inTok)
  const outStr=abbreviate(outTok)
  let tokStr=''
  if(inStr&&outStr) tokStr=inStr+' in / '+outStr+' out'
  else if(inStr) tokStr=inStr+' in'
  else if(outStr) tokStr=outStr+' out'
  
  let costStr=''
  if(costUsd!==undefined&&costUsd!==null&&!isNaN(costUsd)&&costUsd!==0){
    costStr='$'+Number(costUsd.toFixed(3))
  }
  return { tokStr, costStr }
}
async function j(u){const r=await fetch(u);return r.json()}
// Single source of truth for how a worker's raw {state, stale} maps to a filter-chip/badge
// bucket. 'human-controlled' gets its own bucket (previously fell through the catch-all
// into 'error', which is wrong — a human quietly watching a session is not a failure).
//
// 'killed' got the same treatment for the same reason: the 5-value enum is
// running|done|error|killed|human-controlled (parse-utils.mjs), and 'killed' used to hit the
// catch-all and be reported as an error. A human stopping a worker is an interruption, not a
// failure. 'stale' likewise left the 'error' bucket — "we lost track of it" is not "it failed",
// and merging them made a stale worker unfindable except by hunting the error list.
//
// The catch-all is now an explicit 'unknown' bucket rather than 'error', so a 6th state added
// later surfaces as unknown instead of being libelled a failure — i.e. it cannot reintroduce
// the exact bug this function has now been patched for twice.
// NB: the server only sets w.stale for state==='running' (dashboard-server.mjs), so the stale
// check must stay above the running check. (No backticks anywhere in this file — including in
// comments — because the whole page is a single backtick template on the server side.)
function workerBucket(w){
  if(w.state==='human-controlled') return 'human'
  if(w.state==='error') return 'error'
  if(w.stale) return 'stale'
  if(w.state==='running') return 'running'
  if(w.state==='done') return 'done'
  if(w.state==='killed') return 'killed'
  return 'unknown'
}
// Bucket -> presentation. Table rather than nested ternaries so adding a bucket cannot silently
// fall through to whatever the last ternary happened to be.
const WORKER_DOT={running:'busy',stale:'idle',human:'human',done:'closed',error:'dead',killed:'idle',unknown:'closed'}
const WORKER_BADGE_CLS={stale:'badge warn',human:'badge human',error:'badge err',killed:'badge warn'}
// Order the chips render in; every bucket workerBucket can return must appear here (pinned by test).
const WORKER_BUCKETS=['running','stale','human','done','error','killed','unknown']

// ---- deterministic-runner presentation ----
//
// Two independent axes, deliberately never merged into one badge:
//   the dot + state badge = the WORKER's lifecycle (did the process finish?)
//   the verify token       = did the WORK pass its check?
// That is why "done" next to a red "verify" reads correctly rather than as a contradiction.

// 'none'/'unknown' get NO badge: a run nobody asked to check must never look green.
const VERIFY_BADGE={pass:['pass','verify ✓'],fail:['fail','verify ✗'],harness:['warn','verify ⚠']}
function verifyBadgeHtml(w){
  const v=w.verdict; if(!v) return ''
  const spec=VERIFY_BADGE[v.verify]; if(!spec) return ''
  const ex=Number(v.verifyExit)
  const suffix=(v.verify!=='pass'&&Number.isFinite(ex))?' e'+ex:''
  return ' <span class="badge '+spec[0]+'">'+spec[1]+suffix+'</span>'
}

// Exit 126/127 mean the verify command itself was unusable and 124 that it timed out — the check
// never ran, so calling it a FAIL would blame the worker for the operator's typo.
function verifyPhrase(v){
  if(!v) return ''
  const ex=Number(v.verifyExit)
  if(v.verify==='pass') return '<span class="ok">✓ verify</span>'
  if(v.verify==='harness'){
    const why=(ex===127||ex===126)?'command not found':(ex===124?'timed out':'did not run')
    return '<span class="warnt">⚠ verify '+why+'</span>'
  }
  if(v.verify==='fail') return '<span class="err">✗ verify'+(Number.isFinite(ex)?' exit '+ex:'')+'</span>'
  if(v.verify==='none') return '<span class="muted">no verify requested</span>'
  return ''
}

// ' 3 files changed, 42 insertions(+), 7 deletions(-)' -> '3 files +42/-7'. Falls back to a bare
// file count, because a real on-disk shape has changed files with an empty diffstat.
function changeSize(w){
  const ds=String(w.diffstat||'')
  const f=ds.match(/(\\d+) files? changed/)
  if(f){
    const ins=ds.match(/(\\d+) insertion/), del=ds.match(/(\\d+) deletion/)
    let out=f[1]+' file'+(f[1]==='1'?'':'s')
    if(ins) out+=' +'+ins[1]
    if(del) out+=(ins?'/':' ')+'-'+del[1]
    return out
  }
  const n=Number(w.changedFileCount)
  return Number.isFinite(n)&&n>0?(n+' file'+(n===1?'':'s')):''
}

// The row's second line. Every token is omitted when unknown, and the whole line is omitted when
// nothing is known — so a plain worker session looks complete rather than empty.
//
// Deliberately NOT here: the stranded/worktree state. Only the detail route resolves whether the
// worktree still exists (a stat per row would put worker-supplied absolute paths on the
// SSE-refreshed path), and 'stranded' alone is the EXPECTED outcome of a successful run
// (.specs/dev/sdd/deterministic-runner.md) — so on its own it is not row-worthy news.
// A mid-run snapshot is not a total. Every partial session on a real machine has
// output_tokens:0 alongside 51.7k-190k input, which fmtUsage renders as "51.7k in / 0 out" — a
// specific wrong number, in a product whose selling point is token accounting.
function usageTokenStr(w){
  const u=fmtUsage(w.usage)
  if(!u||!u.tokStr) return ''
  if(!w.usagePartial) return u.tokStr
  const outTok=w.usage&&w.usage.outTok
  // Plain string surgery, not a regex: a '/' inside a regex literal has to be written '\\/' to
  // survive this file's outer template literal, and getting that wrong breaks the whole page.
  const zeroOut=' / 0 out'
  if(!outTok){
    const base=u.tokStr.endsWith(zeroOut)?u.tokStr.slice(0,-zeroOut.length):u.tokStr
    return base+' · out not captured'
  }
  return u.tokStr+'~'
}

// Lifecycle buckets are mutually exclusive with each other, but "failed its check" is a different
// axis: all verify-failures sit in the 'done' bucket, so the chip row cannot express them.
function matchesWorkerFilter(w,flt){
  if(flt==='all') return true
  if(flt==='verify-fail') return !!(w.verdict&&w.verdict.verify==='fail')
  return workerBucket(w)===flt
}

// The metadata line of a worker row: scan tokens on the left, start time pinned to the RIGHT edge.
// The time used to LEAD this line, which pushed the three tokens actually scanned down the rail
// (repo, live tool, token usage) right by a variable amount — a locale timestamp is not
// fixed-width, so nothing lined up. Pinned right it forms its own column and the left group gets
// the whole remaining width to ellipsis into.
//
// Extracted from loadList's inline row template so the layout is testable at all: everything else
// in that template is asserted through a real function, and a grep for a CSS class is not an
// assertion about order.
function workerMetaLineHtml(w,live,usageBits){
  const parts=[]
  const origin=shortProj(w.cwd)
  if(origin) parts.push(esc(origin))
  // lastTool only while the row is live — a fossil once the worker is dead (3.40.2).
  if(live&&w.lastTool) parts.push(esc(w.lastTool))
  // usageBits arrives pre-escaped: it is assembled from usageTokenStr/fmtUsage, both of which
  // esc() their own inputs.
  if(usageBits) parts.push(usageBits)
  return '<div class="small muted l4"><span class="lt">'+parts.join(' · ')+'</span>'
    +'<span class="when">'+esc(fmtDT(w.started))+'</span></div>'
}

function runLineHtml(w){
  // An auth failure is not a task failure: the worker never started, so there is no run to report.
  if(w.errorKind==='auth'){
    return '<span class="warnt">authentication failed — the worker never ran</span>'+(w.error?' · '+esc(w.error):'')
  }
  const parts=[]
  if(w.verdictPending) parts.push('<span class="live">⚙ verify in progress…</span>')
  else { const ph=verifyPhrase(w.verdict); if(ph) parts.push(ph) }
  const cs=changeSize(w); if(cs) parts.push(esc(cs))
  return parts.join(' · ')
}

async function loadList(){
  const el=document.getElementById('list')
  const fb=document.getElementById('filter')
  // Build first, swap once at the end — never blank the rail while the fetch is in flight.
  // Generation guard: a tab switch mid-fetch must not let the stale response win the rail.
  const gen=++loadListGen
  const frag=document.createDocumentFragment(); const sig=[]
  let agg=null, wRows=null
  if(mode==='cc'){
    const ss=await j('/api/sessions')
    if(gen!==loadListGen) return
    const counts={busy:0,idle:0,closed:0}; ss.forEach(s=>counts[s.status]=(counts[s.status]||0)+1)
    fb.style.display='flex'
    fb.innerHTML=[['all',ss.length],['busy',counts.busy],['idle',counts.idle],['closed',counts.closed]].map(([k,n])=>'<span class="fchip'+(flt===k?' on':'')+'" onclick="setFilter(\\''+k+'\\')">'+k+'<span class="c">'+n+'</span></span>').join('')
    document.getElementById('meta').textContent=ss.length+' sessions'
    const shown=flt==='all'?ss:ss.filter(s=>s.status===flt)
    shown.forEach(s=>{
      const h='<div class="item'+(sel===s.id?' sel':'')+'"><div><span class="dot '+s.status+'"></span>'+esc(shortSessionProj(s.project))+'<span class="badge">'+s.status+'</span>'+(s.model?' <span class="badge">'+esc(s.model)+'</span>':'')+(s.subagentCount?'<span class="badge">'+s.subagentCount+' sub</span>':'')+'</div><div class="small muted">'+esc(s.firstPrompt||s.id.slice(0,8))+'</div><div class="small muted">'+esc(fmtDT(s.lastActivityAt))+' · '+s.sizeKB+'KB</div></div>'
      const it=E(h); it.onclick=()=>openSession(s); frag.appendChild(it); sig.push(h)
    })
  }else if(mode==='w'){
    const pair=await Promise.all([j('/api/workers'),j('/api/workers/aggregate')])
    if(gen!==loadListGen) return
    const ws=pair[0], a=pair[1]||{}
    agg=a; wRows=ws
    const wCounts={all:ws.length}
    WORKER_BUCKETS.forEach(k=>{wCounts[k]=0})
    ws.forEach(w=>{ const k=workerBucket(w); wCounts[k]=(wCounts[k]||0)+1 })
    fb.style.display='flex'
    // Chips are derived from WORKER_BUCKETS so a new bucket can never be filterable-but-hidden.
    // 'unknown' is a should-never-happen bucket, so it only earns a chip once something is in it.
    // Second group: an outcome chip, not a lifecycle one. Worth its own slot because every
    // verify-failure has state 'done' and is therefore invisible in the lifecycle chips.
    const verifyFails=ws.filter(w=>w.verdict&&w.verdict.verify==='fail').length
    const anyVerdict=ws.some(w=>w.hasVerdict)
    const wChips=[['all',wCounts.all]]
      .concat(WORKER_BUCKETS.filter(k=>k!=='unknown'||wCounts.unknown>0).map(k=>[k,wCounts[k]]))
      .concat(anyVerdict?[['verify-fail',verifyFails]]:[])
    fb.innerHTML=wChips.map(([k,n])=>'<span class="fchip'+(wFlt===k?' on':'')+'" onclick="setWFilter(\\''+k+'\\')">'+k+'<span class="c">'+n+'</span></span>').join('')
    document.getElementById('meta').textContent=ws.length+' workers'
    const shown=ws.filter(w=>matchesWorkerFilter(w,wFlt))
    shown.forEach(w=>{
      const bucket=workerBucket(w)
      const live=bucket==='running'
      const dot=WORKER_DOT[bucket]||'closed'
      // An auth failure never ran the task, so amber "auth" is truer than a red "error".
      const isAuth=w.errorKind==='auth'
      const badge=isAuth?'auth':(bucket==='stale'?'stale':(w.state||'unknown'))
      const badgeCls=isAuth?'badge warn':(WORKER_BADGE_CLS[bucket]||'badge')
      const u=fmtUsage(w.usage)
      const tokStr=usageTokenStr(w)
      // No leading separator: this is now one token among several joined below, not a suffix
      // pasted onto a line that always began with a timestamp.
      let usageBits=''
      if(tokStr||(u&&u.costStr)){
        usageBits=(tokStr?esc(tokStr):'')+(tokStr&&u&&u.costStr?' · ':'')+((u&&u.costStr)?esc(u.costStr):'')
      }
      // Dropped from the row in 4.3.0, to buy the space the outcome line needs:
      //  - "from <parent CC session>": babysitter-era provenance. The deterministic runner has no
      //    babysitter, so it is now historical trivia — and it was the single most expensive field
      //    on this route. Still shown in full in the detail view.
      //  - the standalone project line: shortProj(cwd) on a run yields "tmp/ds-wt-oUSONx", i.e. the
      //    throwaway worktree rather than the repo — noise on exactly the rows this is about. It is
      //    folded into the metadata line below, where it reads as one token among several.
      //  - the literal "default" for a missing model: absence already means default.
      //  - lastTool on a finished row: a fossil once the worker is dead, so it is kept only while
      //    the row is live (3.40.2's "only what changes moment to moment", applied to rows).
      const runLine=runLineHtml(w)
      const h='<div class="item'+(sel===w.id?' sel':'')+'">'
        +'<div class="l1"><span class="dot '+dot+'"></span>'+esc(w.backend)
        +(w.model?' <span class="c">'+esc(w.model)+'</span>':'')
        +(w.hasVerdict?' <span class="badge run">⚙RUN</span>':'')
        +' <span class="'+badgeCls+'">'+esc(badge)+'</span>'
        +verifyBadgeHtml(w)
        +'</div>'
        +(runLine?'<div class="small muted ell">'+runLine+'</div>':'')
        +'<div class="small muted ell">'+esc(w.prompt||w.id.slice(0,8))+'</div>'
        +workerMetaLineHtml(w,live,usageBits)
        +'</div>'
      const it=E(h); it.onclick=()=>openWorker(w); frag.appendChild(it); sig.push(h)
    })
  }
  // Skip the swap when nothing visible changed; otherwise keep the rail's scroll position.
  const s2=mode+'|'+sig.join('\\n')
  const sameSig=el._sig===s2
  if(!sameSig){
    el._sig=s2
    const rail=el.parentElement; const sc=rail.scrollTop
    el.replaceChildren(frag); rail.scrollTop=sc
  }
  if(sel || hasOpenDetailView()) return
  if(mode==='w'){ setView('workers-overview', workersOverviewHtml(agg, wRows)) }
  else if(mode==='cc'){ setEmptyMainState() }
}
// worker progress.log lines already carry a leading glyph per event type (written by
// {ag,cx,ds,oc,cp}-*-parse.mjs — see appendProgress() call sites); map that glyph to the
// same step classes native CC tool/message/thinking steps use, so workers get equal
// visual separation instead of one flat "log" bucket.
const LOG_GLYPH_KIND={'·':'message','✻':'thinking','$':'tool','✎':'tool','▸':'tool','🔎':'tool','☑':'tool','✗':'errline'}
function renderFlow(steps){
  if(!steps||!steps.length) return '<div class="empty">no steps</div>'
  return steps.slice().reverse().map(s=>{
    if(s.kind==='tool'){
      const st=s.ok===true?'<span class="ok">⎿ ok</span>':s.ok===false?'<span class="err">⎿ error</span>':''
      let head='⏺ <span class="k">'+esc(s.name)+'</span> '+esc(s.summary||'')
      if(s.spawnsAgent) head='⏺ <span class="k">'+esc(s.name)+'</span> <a class="agentlink" onclick="openSub(\\''+escAttr(s.spawnsAgent)+'\\')">→ '+esc(s.summary||'subagent')+'</a>'
      return '<div class="step tool">'+head+(st?'<div class="small">'+st+' '+esc(s.result||'')+'</div>':'')+'</div>'
    }
    if(s.kind==='prompt') return '<div class="step prompt">❯ <span class="md">'+md(s.text)+'</span></div>'
    if(s.kind==='message') return '<div class="step message">⏺ <span class="md">'+md(s.text)+'</span></div>'
    if(s.kind==='thinking') return '<div class="step thinking">✻ '+esc(s.text)+'</div>'
    if(s.kind==='log'){
      const raw=s.text||''
      const rm=raw.match(/^\s{2}(✓|✗)\s?(.*)$/)
      if(rm) return '<div class="step result '+(rm[1]==='✓'?'ok':'err')+'">⎿ '+esc(rm[2])+'</div>'
      const t=raw.replace(/^\s+/,'')
      const g=t.charAt(0), kind=LOG_GLYPH_KIND[g]
      if(kind){
        const rest=t.slice(1).trim()
        const body=kind==='message'?'<span class="md">'+md(rest)+'</span>':esc(rest).replace(/\(exit (\d+)\)$/,(mm,c)=>c==='0'?'<span class="ok">(exit 0)</span>':'<span class="err">(exit '+c+')</span>')
        return '<div class="step '+kind+'">'+esc(g)+' '+body+'</div>'
      }
      return '<div class="step log">'+esc(raw)+'</div>'
    }
    return '<div class="step log">'+esc(s.text)+'</div>'
  }).join('')
}
function usageHtml(usage,partial){
  const u=fmtUsage(usage,true)
  if(!u||(!u.tokStr&&!u.costStr)) return ''
  const parts=[]
  // A killed or interrupted worker leaves a mid-run snapshot. Every partial session on a real
  // machine has output_tokens 0, which would otherwise read as "the worker produced nothing".
  if(u.tokStr) parts.push(partial&&!(usage&&usage.outTok)?u.tokStr.replace(' / 0 out','')+' · out not captured':u.tokStr)
  if(u.costStr) parts.push(u.costStr)
  const note=partial?' (partial — mid-run snapshot, not a final total)':''
  return '<div class="small muted" style="margin:4px 8px 12px">Usage: '+esc(parts.join(' · '))+esc(note)+'</div>'
}
function workerPanelHtml(lw){ if(!lw||!lw.length) return ''
  return '<details class="panel wk"><summary>Worker sessions (ds/ag/cx/oc/cp) <span class="badge">'+lw.length+'</span></summary><div class="sabody">'+lw.map(w=>'<span class="sa" onclick="openWorkerById(\\''+escAttr(w.id)+'\\')">'+esc(w.backend)+' ('+(w.model?esc(w.model):'default')+'): '+esc(w.prompt||w.id.slice(0,12))+' <span class="c">'+esc(w.stale?'stale':w.state)+'</span></span>').join('')+'</div></details>' }
function openWorkerById(id){ fetch('/api/workers').then(r=>r.json()).then(ws=>{const w=ws.find(x=>x.id===id); if(!w) return; mode='w'; document.getElementById('tabW').classList.add('on'); document.getElementById('tabCC').classList.remove('on'); openWorker(w)}) }
function chipHtml(a){const t=fmtTime(a.startedAt);return '<span class="sa'+(a.active?' act':'')+'" onclick="openSub(\\''+escAttr(a.agentId)+'\\','+(a.active?'true':'false')+')">'+(a.active?'● ':'')+esc(a.agentType)+': '+esc(a.description||a.agentId.slice(0,8))+(a.spawnDepth>1?' ·d'+a.spawnDepth:'')+(a.model?' <span class="badge">'+esc(a.model)+'</span>':'')+(t?' <span class="c">'+t+'</span>':'')+'</span>'}
async function openSession(s){
  sel=s.id; mode='cc'
  takeoverTeardown(); { const tk=document.getElementById('takeover'); tk.style.display='none'; tk.innerHTML='' }
  document.getElementById('crumb').innerHTML='<a onclick="back()">sessions</a> › '+esc(s.id.slice(0,8))+' <span class="muted">('+esc(s.status)+')</span>'
  const prevPanel=document.querySelector('#sidePanel details.restpanel'); const subsOpen=prevPanel?prevPanel.open:false
  const key='session:'+s.id
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const [flow,subs]=await Promise.all([j('/api/session/'+s.id+'/flow'),j('/api/session/'+s.id+'/subagents')])
  window._cur={type:'session',id:s.id}
  let side=''
  if(subs.length){
    const act=subs.filter(a=>a.active), rest=subs.filter(a=>!a.active)
    if(act.length) side+='<details class="panel act" open><summary>Active subagents <span class="badge">'+act.length+'</span></summary><div class="sabody">'+act.map(chipHtml).join('')+'</div></details>'
    if(rest.length) side+='<details class="panel restpanel"'+(subsOpen?' open':'')+'><summary>Subagents <span class="badge">'+rest.length+'</span></summary><div class="sabody">'+rest.map(chipHtml).join('')+'</div></details>'
  }
  side+=workerPanelHtml(flow.linkedWorkers)
  document.getElementById('sidePanel').innerHTML=side
  let h=''
  h+=usageHtml(flow.usage)
  h+='<div class="term-flow">'+renderFlow(flow.steps)+'</div>'+(flow.truncated?'<div class="small muted">(showing last '+flow.steps.length+' of '+flow.total+')</div>':'')
  setView(key,h); loadList()
  watchDetail(s.status==='busy'?'session:'+s.id:null, ()=>openSession(s))
}
async function openSub(aid,active){
  const sid=window._cur&&window._cur.type==='session'?window._cur.id:(window._cur&&window._cur.sid)
  if(!sid) return;
  const key='sub:'+sid+':'+aid
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const flow=await j('/api/subagent/'+sid+'/'+aid+'/flow')
  document.getElementById('crumb').innerHTML='<a onclick="back()">sessions</a> › <a onclick="reopen(\\''+escAttr(sid)+'\\')">'+esc(sid.slice(0,8))+'</a> › <span class="k">subagent '+esc(aid.slice(0,8))+'</span>'+(flow.model?' <span class="badge">'+esc(flow.model)+'</span>':'')+(active?' <span class="live">● live</span>':'')
  window._cur={type:'sub',sid:sid,aid:aid}
  document.getElementById('sidePanel').innerHTML=workerPanelHtml(flow.linkedWorkers)
  setView(key,usageHtml(flow.usage)+'<div class="term-flow">'+renderFlow(flow.steps)+'</div>'+(flow.truncated?'<div class="small muted">(last '+flow.steps.length+' of '+flow.total+')</div>':''))
  watchDetail(active?'subagent:'+sid+':'+aid:null, ()=>openSub(aid,true))
}
// ==== human-takeover UI (codex / deepseek / antigravity / opencode / copilot) ======
// activeTakeover holds THIS tab's live view of an in-progress takeover: the open
// WebSocket + mounted xterm.js Terminal (+ its FitAddon/ResizeObserver, if the fit addon
// loaded). Never persisted anywhere — a page reload loses this tab's live terminal
// (Phase 1: no reconnect, see the SDD's non-goals). The token lives only in the WS URL
// built in takeoverMount and is never logged to the console (matches the server-side
// "never log the token" invariant).
let activeTakeover=null

function takeoverTeardown(){
  if(!activeTakeover) return
  const at=activeTakeover; activeTakeover=null
  try{ if(at.resizeObserver) at.resizeObserver.disconnect() }catch(e){}
  try{ at.ws.close() }catch(e){}
  try{ at.term.dispose() }catch(e){}
}

function takeoverStart(id,backend){
  fetch('/api/worker/'+encodeURIComponent(id)+'/takeover',{method:'POST',headers:{'X-CLI-Dispatch-Takeover':'1'}})
    .then(r=>r.json().then(body=>({ok:r.ok,body:body})))
    .then(res=>{ if(!res.ok) throw new Error((res.body&&res.body.error)||'takeover failed'); takeoverMount(id,res.body,backend) })
    .catch(e=>{ alert('Take control failed: '+e.message) })
}

// Builds the terminal DOM + opens the WS, per the SDD flow: POST takeover -> open WS
// with token -> xterm attaches. Resolved same-origin (location.protocol/host), never
// hardcoded — this server may have hopped to a different port on EADDRINUSE.
function takeoverMount(id,res,backend){
  takeoverTeardown()
  const el=document.getElementById('takeover')
  el.style.display='block'
  el.innerHTML='<div class="tkbar"><button class="tkbtn tkbtn-off" id="tkBackBtn">Hand back</button><span class="small muted">live terminal · '+esc(backend||'?')+'</span></div><div class="term-wrap"><div id="tkTerm"></div></div>'
  document.getElementById('tkBackBtn').onclick=()=>takeoverHandback(id)
  const term=new Terminal({cols:res.cols||80,rows:res.rows||24,convertEol:true,theme:{background:'#000000',foreground:'#f8f8f2'}})
  let fit=null
  if(window.FitAddon&&window.FitAddon.FitAddon){ fit=new window.FitAddon.FitAddon(); term.loadAddon(fit) }
  term.open(document.getElementById('tkTerm'))
  const proto=(location.protocol==='https:'?'wss://':'ws://')
  const ws=new WebSocket(proto+location.host+res.ws+'?token='+encodeURIComponent(res.token))
  activeTakeover={id:id,ws:ws,term:term,fit:fit,resizeObserver:null}
  // Keystrokes typed before the WS handshake completes (PTY spawn + upgrade round-trip is
  // not instant) must not be silently dropped — buffer them and flush in order on 'open'.
  let pendingInput=''
  const sendResize=()=>{
    if(!fit) return
    try{ fit.fit() }catch(e){ return }
    if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({t:'r',cols:term.cols,rows:term.rows}))
  }
  ws.addEventListener('open', ()=>{
    if(pendingInput){ ws.send(JSON.stringify({t:'i',d:pendingInput})); pendingInput='' }
    sendResize()
  })
  ws.addEventListener('message', ev=>{
    let msg=null
    try{ msg=JSON.parse(ev.data) }catch(e){ return }
    if(!msg) return
    if(msg.t==='o') term.write(msg.d)
    else if(msg.t==='exit'){ term.write('\\r\\n\\r\\n[session ended, code '+msg.code+']\\r\\n'); term.options.disableStdin=true }
  })
  ws.addEventListener('close', ()=>{ term.options.disableStdin=true })
  term.onData(d=>{ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({t:'i',d:d})); else pendingInput+=d })
  if(fit){
    const wrap=document.querySelector('#takeover .term-wrap')
    const ro=new ResizeObserver(sendResize)
    ro.observe(wrap)
    activeTakeover.resizeObserver=ro
  }
}

function takeoverHandback(id){
  fetch('/api/worker/'+encodeURIComponent(id)+'/handback',{method:'POST',headers:{'X-CLI-Dispatch-Takeover':'1'}})
    .catch(()=>{})
    .then(()=>{
      takeoverTeardown()
      const el=document.getElementById('takeover'); el.style.display='none'; el.innerHTML=''
      loadList()
    })
}

// Renders the take-control/hand-back bar for the currently open worker. Called from
// openWorker() on every render, including SSE-triggered refreshes — but if THIS tab
// already holds the live terminal for this worker id, it's a deliberate no-op (leaving
// the mounted xterm.js instance + its WebSocket alone; rebuilding the DOM here on every
// refresh would tear down a live terminal mid-session).
function renderTakeoverBar(w){
  const el=document.getElementById('takeover')
  if(activeTakeover&&activeTakeover.id===w.id){ el.style.display='block'; return }
  if(activeTakeover&&activeTakeover.id!==w.id) takeoverTeardown()
  if(w.state==='running'&&['codex','deepseek','antigravity','opencode','copilot'].includes(w.backend)){
    el.style.display='block'
    el.innerHTML='<div class="tkbar"><button class="tkbtn" id="tkStartBtn" title="Take control of this session">Take control</button></div>'
    document.getElementById('tkStartBtn').onclick=()=>takeoverStart(w.id,w.backend)
    return
  }
  if(w.state==='human-controlled'){
    el.style.display='block'
    el.innerHTML='<div class="tkbar"><span class="small muted">human-controlled (attach from the tab that started it, or hand back)</span><button class="tkbtn tkbtn-off" id="tkBackBtn2">Hand back</button></div>'
    document.getElementById('tkBackBtn2').onclick=()=>takeoverHandback(w.id)
    return
  }
  el.style.display='none'; el.innerHTML=''
}
// ==== end human-takeover UI ========================================================
// ---- verdict panels (worker detail view) ----
//
// Sentences for cli-dispatch-run's exit code, attributed to the RUNNER. A bare number next to a
// state badge ("done · exit 1") is exactly the confusion to avoid: the two measure different
// subjects, so the UI's job is to say whose code it is.
const RUNNER_EXIT_TEXT={
  0:'worker finished and verify passed',
  1:'worker finished (done), verify failed',
  2:'worker died or was killed',
  3:'timed out waiting for the worker',
  4:'a human took over; verify was never run',
  5:'setup or usage error'
}
function runnerExitSentence(v){
  const ex=Number(v.exitCode)
  if(!Number.isFinite(ex)) return ''
  const t=RUNNER_EXIT_TEXT[ex]
  return 'runner exit '+ex+(t?' — '+t:'')
}

// Always visible, never a <details>: this is the answer to "what happened".
function verdictStripHtml(flow){
  const v=flow.verdict; if(!v) return ''
  if(v.malformed){
    return '<div class="panel bad"><div class="sabody"><b>⚙ run</b> — verdict could not be built'
      +(v.error?': '+esc(v.error):'')+'</div></div>'
  }
  const cls=v.verify&&v.verify.state==='fail'?'panel bad':(v.verify&&v.verify.state==='pass'?'panel act':'panel')
  const l1='<b>⚙ deterministic run</b> · '+esc(runnerExitSentence(v))
  const bits=[]
  const ph=verifyPhrase({verify:v.verify?v.verify.state:'none',verifyExit:v.verify?v.verify.exitCode:null})
  if(ph) bits.push(ph)
  if(v.verify&&v.verify.commands.length>1&&Number.isFinite(Number(v.verify.failedAt))){
    bits.push('command '+(Number(v.verify.failedAt)+1)+' of '+v.verify.commands.length)
  }
  const cs=changeSize({diffstat:v.diffstat,changedFileCount:(flow.changedFiles?flow.changedFiles.files.length:v.changedFiles.length)})
  if(cs) bits.push(esc(cs))
  // verdict.state is a run-end snapshot; status.state is live and a --resume can legitimately
  // move it. Only mention the pair when they actually disagree.
  const liveState=flow.state||''
  const snap=v.state||''
  const drift=(snap&&liveState&&snap!==liveState)?'<div class="small muted">state now: '+esc(liveState)+' · at run end: '+esc(snap)+'</div>':''
  return '<div class="'+cls+'"><div class="sabody">'+l1
    +(bits.length?'<div class="small">'+bits.join(' · ')+'</div>':'')+drift+'</div></div>'
}

function verifyPanelHtml(flow,openMap){
  const v=flow.verdict&&flow.verdict.verify; if(!v) return ''
  const failed=v.state==='fail'||v.state==='harness'
  const cls=failed?'panel bad':(v.state==='pass'?'panel act':'panel')
  const failedAt=Number(v.failedAt)
  const rows=v.commands.map((c,i)=>{
    // runVerify breaks at the first failure, so anything after it genuinely never ran and must
    // not be shown as passed.
    let mark='<span class="ok">✓</span>', note=''
    if(Number.isFinite(failedAt)&&v.state!=='pass'){
      if(i===failedAt){ mark='<span class="err">✗</span>' }
      else if(i>failedAt){ mark='<span class="muted">·</span>'; note=' <span class="badge">not run</span>' }
    }
    // flex row: the marker must sit BESIDE the command, not above it — <pre> is a block element.
    return '<div class="vrow">'+mark+note+'<pre class="md-pre pathline">'+esc(c)+'</pre></div>'
  }).join('')
  const sum='verify '+(v.state==='pass'?'✓ passed':(v.state==='harness'?'⚠ did not run':'✗ exit '+esc(String(v.exitCode))))
  return '<details class="panel-x '+cls+'" data-pk="verify"'+(openState(openMap,'verify',failed)?' open':'')
    +'><summary>'+sum+'</summary><div class="sabody">'+rows+'</div></details>'
}

// A SIBLING of the verify panel, not nested: .panel>summary is a direct-child selector and
// .panel carries its own background, so nesting would render an inset box inside .panel.bad.
function verifyTailHtml(flow,openMap){
  const v=flow.verdict&&flow.verdict.verify; if(!v||!v.tail) return ''
  const failed=v.state==='fail'||v.state==='harness'
  return '<details class="panel" data-pk="tail"'+(openState(openMap,'tail',failed)?' open':'')
    +'><summary>output tail</summary><div class="sabody"><pre class="md-pre scrollbox">'+esc(v.tail)+'</pre></div></details>'
}

// Status -> class via a WHITELIST; the raw git status code never reaches a class attribute.
const FILE_STATUS_CLS={'M':'','A':'ok','D':'err','??':'warn'}
function changedFilesPanelHtml(flow,openMap,workerId){
  const cf=flow.changedFiles; if(!cf) return ''
  const rows=cf.files.map(f=>{
    const cls=FILE_STATUS_CLS[f.status]||''
    const badge=f.status?'<span class="badge '+cls+'">'+esc(f.status)+'</span> ':''
    return '<div class="pathline">'+badge+esc(f.path)+'</div>'
  }).join('')
  // Paths that were already dirty before the worker started, i.e. explicitly not its work. This
  // attribution cannot be reconstructed anywhere else in the product.
  const pre=cf.preexistingDirty.length
    ? '<div class="small muted" style="margin-top:8px">already dirty before this worker started — not its work:</div>'
      +cf.preexistingDirty.map(f=>'<div class="pathline small muted">'+esc(f)+'</div>').join('')
    : ''
  const trunc=cf.truncated?'<div class="small muted">(list truncated)</div>':''
  const sum='changed files <span class="badge">'+cf.files.length+'</span>'+(cf.diffstat?' <span class="small muted">'+esc(cf.diffstat)+'</span>':'')
  // The href is BUILT from the worker id rather than taken from flow.diff.url: the server already
  // validates ids with okId before serving anything, so re-deriving the URL here removes the trust
  // boundary entirely instead of escaping across it. Same construction as takeoverStart.
  const bytes=Number(flow.diff&&flow.diff.bytes)
  const link=(flow.diff&&flow.diff.available&&workerId)
    ? '<div style="margin-top:8px"><a href="/api/worker/'+escAttr(encodeURIComponent(workerId))+'/diff" target="_blank" rel="noopener">'+esc(flow.diff.source)+'</a>'
      +(Number.isFinite(bytes)?' <span class="small muted">'+bytes+' bytes'+(flow.diff.truncated?', showing the first 512 KB':'')+'</span>':'')+'</div>'
    : ''
  return '<details class="panel" data-pk="files"'+(openState(openMap,'files',false)?' open':'')
    +'><summary>'+sum+'</summary><div class="sabody">'+rows+pre+trunc+link+'</div></details>'
}

function runEnvPanelHtml(flow,openMap){
  const v=flow.verdict; if(!v||v.malformed) return ''
  const row=(k,val)=>val?'<div class="small"><span class="muted">'+k+'</span> <span class="pathline">'+esc(val)+'</span></div>':''
  let strandedBlock=''
  if(v.stranded){
    // 'stranded' is the EXPECTED outcome of a successful run — the runner never commits, so
    // uncommitted changes mean the worker did its job. Stated as a recorded fact with its
    // provenance, never as a warning.
    const when=v.recordedAt?' ('+esc(fmtDT(v.recordedAt))+')':''
    strandedBlock='<div class="small" style="margin-top:6px">recorded at run end'+when+': uncommitted changes in <span class="pathline">'+esc(v.worktree)+'</span></div>'
    if(v.worktreeExists){
      strandedBlock+='<div class="small warnt">that worktree is still on disk</div>'
      // The parent repo is recorded NOWHERE in the session dir, so it has to be resolved from the
      // worktree's own .git pointer; without it only the repo-less form is offered.
      const repo=v.sourceRepo
      const cmds=repo
        ? 'rm -f "'+v.worktree+'/node_modules"\\ngit -C "'+repo+'" worktree remove "'+v.worktree+'" --force\\ngit -C "'+repo+'" worktree prune'
        : 'git -C "'+v.worktree+'" worktree remove "'+v.worktree+'" --force'
      strandedBlock+='<pre class="md-pre pathline">'+esc(cmds)+'</pre>'
      strandedBlock+='<div class="small muted">or sweep everything older than N days with /cli-dispatch:clean --worktree-days N</div>'
    }else{
      // Telling someone to remove a directory that is not there would be the exact dishonesty
      // this view exists to avoid.
      strandedBlock+='<div class="small muted">that worktree is no longer on disk; the changes survive only in the recorded patch</div>'
    }
  }
  const via=v.completedVia==='human-takeover'?'handed to a human mid-run':v.completedVia
  return '<details class="panel" data-pk="env"'+(openState(openMap,'env',false)?' open':'')
    +'><summary>run environment</summary><div class="sabody">'
    +row('branch',v.branch)+row('base',v.baseRef)+row('worktree',v.worktree)
    +row('completed',via)+row('started',fmtDT(v.startedAt))+row('ended',fmtDT(v.recordedAt))
    +strandedBlock+'</div></details>'
}

// An auth failure means the worker never started: nothing about the prompt, model or repo is at
// fault, and the flow it would send you to read has no steps in it.
function authPanelHtml(flow){
  if(flow.errorKind!=='auth') return ''
  return '<div class="panel bad"><div class="sabody"><b>authentication failed — the worker never ran</b>'
    +(flow.error?'<div class="small">'+esc(flow.error)+'</div>':'')
    +'<div class="small muted">check the backend key with /cli-dispatch:doctor, or set it in the ⚙ configuration view</div>'
    +'</div></div>'
}

// Collapse-state preservation, generalised. :541 used to snapshot exactly one panel by CSS
// selector; with five panels a live-refreshing worker would slam them shut every 600ms, which is
// a direct regression of the flicker fix in 3.15.2.
function snapshotPanels(){
  const m={}
  const v=document.getElementById('view')
  if(!v) return m
  const nodes=v.querySelectorAll('details[data-pk]')
  for(let i=0;i<nodes.length;i++){ m[nodes[i].getAttribute('data-pk')]=nodes[i].open }
  return m
}
function openState(map,key,dflt){
  return (map&&Object.prototype.hasOwnProperty.call(map,key))?map[key]:dflt
}

async function openWorker(w){
  sel=w.id;
  document.getElementById('sidePanel').innerHTML=''
  document.getElementById('crumb').innerHTML='<a onclick="back()">workers</a> › '+esc(w.backend)+' <span class="c">'+(w.model?esc(w.model):'default')+'</span> '+esc(w.id.slice(0,12))+' <span class="muted">('+esc(w.stale?'stale':w.state)+')</span>'
  renderTakeoverBar(w)
  // Snapshot every panel's open/closed state before the re-render, not just the task panel: a
  // live-refreshing worker would otherwise slam the verify panel shut every 600ms.
  const openMap=snapshotPanels()
  const key='worker:'+w.id
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const flow=await j('/api/worker/'+w.id+'/flow')
  let h=''
  // What happened (the run's own verdict) comes before what was asked (the prompt).
  h+=authPanelHtml(flow)
  h+=verdictStripHtml(flow)
  h+=verifyPanelHtml(flow,openMap)
  h+=verifyTailHtml(flow,openMap)
  h+=changedFilesPanelHtml(flow,openMap,w.id)
  h+=runEnvPanelHtml(flow,openMap)
  if(flow.prompt) h+='<details class="panel task" data-pk="task"'+(openState(openMap,'task',false)?' open':'')+'><summary>Görev / talimat</summary><div class="sabody"><div class="md">'+md(flow.prompt)+'</div></div></details>'
  h+=usageHtml(flow.usage,flow.usagePartial)
  h+='<div class="term-flow">'+renderFlow(flow.steps)
  if(flow.finalResultPreview) h+='<div class="step message" style="margin-top:10px">⏺ <b>result:</b> '+esc(flow.finalResultPreview)+'</div>'
  h+='</div>'
  setView(key,h); loadList()
  // verdictPending keeps the stream open through the runner's verify phase. Without it the view
  // unsubscribes the moment the worker reports done — which is BEFORE cli-dispatch-run runs
  // verify (up to 600s) and writes verdict.json, so the verdict would never appear.
  const stillLive=(w.state==='running'&&!w.stale)||w.state==='human-controlled'||flow.verdictPending===true
  watchDetail(stillLive?'worker:'+w.id:null, ()=>openWorker(w))
}
async function openConfigView() {
  sel = null
  window._cur = { type: 'config' }
  takeoverTeardown()
  document.getElementById('takeover').style.display = 'none'
  document.getElementById('takeover').innerHTML = ''
  document.getElementById('crumb').innerHTML = 'Configuration'
  const v = document.getElementById('view')
  v._k='config'; v._h=null; v.className = ''
  v.innerHTML = 'loading…'
  loadList()
  await renderConfigEditor()
}
async function saveConfig(key, isSecret) {
  const input = document.getElementById('input_' + key)
  const errSpan = document.getElementById('err_' + key)
  if (!input || !errSpan) return
  errSpan.textContent = ''
  const val = input.value
  if (isSecret && val === '') return
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CLI-Dispatch-Takeover': '1'
      },
      body: JSON.stringify({ key, value: val })
    })
    const body = await res.json()
    if (!res.ok) {
      errSpan.textContent = body.error || 'Save failed'
      return
    }
    if (isSecret) input.value = ''
    await renderConfigEditor()
  } catch (e) {
    errSpan.textContent = e.message
  }
}
// ---- backend auth line (⚙ config view) ----
//
// The key badge above answers "is there a key in the config file?". That is the WRONG question for
// three of the five backends: setup.md and the generated config's own comments say Antigravity,
// Codex and Copilot normally have no key there at all, because they authenticate through a CLI
// login. So the view used to report "not set" for backends that demonstrably work.
//
// This line answers the real question by combining both sources, and it never claims more than it
// knows: a probe that could not run reads "could not check", not a red cross.
const AUTH_HINT_CMD = {ag:'run agy once to sign in',cx:'run codex login',cp:'run gh auth login',oc:'set OPENROUTER_API_KEY or run opencode auth login'}
function authLineHtml(backend, auth, keySet){
  if(!auth) return ''
  const a=(auth.backends||{})[backend]
  if(!a) return ''
  const alt=(auth.altCreds||{})[backend]||[]
  const ev=(auth.evidence||{})[backend]
  const bits=[]
  // Order matters: a key in the config takes precedence over a CLI login for every backend that
  // reads one, so it is stated first when present.
  if(keySet) bits.push('<span class="ok">✓ key in config</span>')
  if(alt.length) bits.push('<span class="ok">✓ ' + esc(alt.join(', ')) + '</span>')
  if(a.state==='logged-in') bits.push('<span class="ok">✓ logged in' + (a.method?' (' + esc(a.method) + ')':'') + '</span>')
  else if(a.state==='logged-out'&&!keySet&&!alt.length) bits.push('<span class="err">✗ not logged in</span>')
  else if(a.state==='cli-missing') bits.push('<span class="muted">CLI not installed</span>')
  else if(a.state==='unknown') bits.push('<span class="warnt">could not check</span>')
  else if(a.state==='key-only'&&!keySet) bits.push('<span class="err">✗ no key</span>')
  // 'no-probe' / 'key-only' carry their explanation in the parenthetical below, so the fallback
  // must not repeat it (that printed the note twice).
  const explained=(a.state==='no-probe'||a.state==='key-only')
  if(!bits.length) bits.push('<span class="muted">' + esc(explained?'no live check available':(a.note||'unknown')) + '</span>')
  let extra=''
  // Only nudge when there is actually nothing working.
  const nothing=!keySet&&!alt.length&&a.state!=='logged-in'
  if(nothing&&AUTH_HINT_CMD[backend]) extra=' <span class="small muted">— ' + esc(AUTH_HINT_CMD[backend]) + '</span>'
  // For the two backends with no probe, the session history is the only evidence available. It is
  // labelled as evidence, never as a live check.
  let evLine=''
  if((a.state==='no-probe'||a.state==='key-only')&&ev&&ev.lastSuccessAt){
    evLine='<div class="small muted">last run succeeded ' + esc(fmtDT(ev.lastSuccessAt))
      + (ev.authErrors?' · ' + ev.authErrors + ' auth error' + (ev.authErrors===1?'':'s'):'') + '</div>'
  }
  const note=explained&&a.note?' <span class="small muted">(' + esc(a.note) + ')</span>':''
  return '<div class="cfg-row"><div class="cfg-label">auth' + bits.join(' · ') + note + extra + '</div>' + evLine + '</div>'
}

async function renderConfigEditor() {
  const v = document.getElementById('view')
  const key = 'config'
  try {
    // Fields that get a <datalist> with model-ID suggestions (suggestions only, free text still allowed).
    // AG/CX/CP datalists are static (sourced from live CLI output or repo docs — see comments below).
    // OC_MODEL/OC_MODELS datalists are populated from a live fetch to /api/models/opencode.
    var modelFields = {AG_MODEL:1,AG_MODELS:1,CX_MODEL:1,CX_MODELS:1,CP_MODEL:1,CP_MODELS:1,OC_MODEL:1,OC_MODELS:1}
    // Two fetches in parallel: /api/backend-auth spawns child processes, so it is a separate route
    // on its own cache clock rather than extra cost inside /api/config.
    const cfgPair = await Promise.all([j('/api/config'), j('/api/backend-auth').catch(()=>null)])
    const cfg = cfgPair[0]
    const auth = cfgPair[1]
    const groups = [
      { name: 'DeepSeek', backend: 'ds', secretKey: 'DEEPSEEK_API_KEY', keys: ['DEEPSEEK_API_KEY', 'DS_MODEL', 'DS_FLASH_MODEL'] },
      { name: 'Antigravity', backend: 'ag', secretKey: 'GEMINI_API_KEY', keys: ['GEMINI_API_KEY', 'AG_MODEL', 'AG_MODELS'] },
      { name: 'Codex', backend: 'cx', secretKey: 'CODEX_API_KEY', keys: ['CODEX_API_KEY', 'CX_MODEL', 'CX_MODELS'] },
      { name: 'OpenCode', backend: 'oc', secretKey: 'OPENROUTER_API_KEY', keys: ['OPENROUTER_API_KEY', 'OC_MODEL', 'OC_MODELS'] },
      { name: 'Copilot', backend: 'cp', secretKey: 'COPILOT_GITHUB_TOKEN', keys: ['COPILOT_GITHUB_TOKEN', 'CP_MODEL', 'CP_MODELS'] }
    ]
    let html = '<div style="max-width:800px">'
    for (const g of groups) {
      html += '<div class="panel">'
      html += '<div style="padding:8px 12px;border-bottom:1px solid var(--bd);font-weight:bold;color:var(--accent)">' + esc(g.name) + ' Backend</div>'
      html += '<div class="sabody" style="padding:12px">'
      html += authLineHtml(g.backend, auth, !!(cfg[g.secretKey] && cfg[g.secretKey].set))
      for (const k of g.keys) {
        const item = cfg[k]
        if (!item) continue
        html += '<div class="cfg-row">'
        html += '<div class="cfg-label">' + esc(k)
        if (item.secret) {
          if (item.set) {
            html += '<span class="badge ok">● set</span>'
            if (item.masked) {
              html += '<span class="small muted">' + esc(item.masked) + '</span>'
            }
          } else {
            html += '<span class="badge muted">○ not set</span>'
          }
        }
        html += '</div>'
        html += '<div class="cfg-field">'
        if (item.secret) {
          html += '<input type="password" class="cfg-input" id="input_' + escAttr(k) + '" placeholder="enter new key to update, leave blank to keep current">'
          html += '<button class="tkbtn" onclick="saveConfig(\\'' + escAttr(k) + '\\', true)">Save</button>'
        } else {
          html += '<input type="text" class="cfg-input" id="input_' + escAttr(k) + '"' + (modelFields[k] ? ' list="dl_' + escAttr(k) + '"' : '') + ' value="' + escAttr(item.value) + '">'
          html += '<button class="tkbtn" onclick="saveConfig(\\'' + escAttr(k) + '\\', false)">Save</button>'
        }
        html += '<span id="err_' + escAttr(k) + '" class="err" style="margin-left:8px"></span>'
        html += '</div>'
        if (!item.secret && k.endsWith('_MODELS')) {
          html += '<div class="small muted" style="margin-top:2px">Comma-separated candidate model list (optional). When the delegation prompt names no explicit model, the delegating agent checks this list first and picks the best fit itself — same reasoning as an orchestrator-provided list, just persisted here instead of retyped each time. Leave empty to keep using the single default above.</div>'
        } else if (!item.secret && k.endsWith('_MODEL')) {
          html += '<div class="small muted" style="margin-top:2px">Single default model, used only when no --model is passed and no candidate list applies. For multi-candidate selection (the delegating agent picks one), either list candidates in the task prompt, or set the matching ' + esc(k.replace(/_MODEL$/, '') + '_MODELS') + ' field below for a standing default list.</div>'
        }
        html += '</div>'
      }
      html += '</div></div>'
    }
    html += '<div class="panel">'
    html += '<div style="padding:8px 12px;border-bottom:1px solid var(--bd);font-weight:bold;color:var(--accent)">Maintenance</div>'
    html += '<div class="sabody" style="padding:12px">'
    html += '<button class="tkbtn" id="cleanBtn" onclick="openCleanPanel()" style="font-size:11px;padding:2px 8px">Clean stale sessions</button>'
    html += ' <button class="tkbtn" id="wtBtn" onclick="openWorktreePanel()" style="font-size:11px;padding:2px 8px">Leftover worktrees</button>'
    html += '</div></div>'
    // Static <datalist> model-ID suggestions for AG/CX/CP backends.
    // AG_MODEL/AG_MODELS options sourced from verified live output of "agy models" on this
    // machine (re-verified 2026-07-28 on agy 1.1.8, which prints slugs; earlier builds printed
    // display names like "Gemini 3.5 Flash (High)"). agy accepts both, and ag-stream compares
    // them ignoring case and punctuation, so a config holding either format stays valid.
    html += '<datalist id="dl_AG_MODEL"><option value="gemini-3.6-flash-high"><option value="gemini-3.6-flash-medium"><option value="gemini-3.6-flash-low"><option value="gemini-3.5-flash-high"><option value="gemini-3.5-flash-medium"><option value="gemini-3.5-flash-low"><option value="gemini-3.1-pro-high"><option value="gemini-3.1-pro-low"><option value="claude-sonnet-4-6"><option value="claude-opus-4-6-thinking"><option value="gpt-oss-120b-medium"></datalist>'
    html += '<datalist id="dl_AG_MODELS"><option value="gemini-3.6-flash-high"><option value="gemini-3.6-flash-medium"><option value="gemini-3.6-flash-low"><option value="gemini-3.5-flash-high"><option value="gemini-3.5-flash-medium"><option value="gemini-3.5-flash-low"><option value="gemini-3.1-pro-high"><option value="gemini-3.1-pro-low"><option value="claude-sonnet-4-6"><option value="claude-opus-4-6-thinking"><option value="gpt-oss-120b-medium"></datalist>'
    // CX_MODEL/CX_MODELS options sourced from verified live ~/.codex/models_cache.json on this machine (re-verified 2026-07-11).
    html += '<datalist id="dl_CX_MODEL"><option value="gpt-5.6-sol"><option value="gpt-5.6-terra"><option value="gpt-5.6-luna"><option value="gpt-5.5"><option value="gpt-5.4"><option value="gpt-5.4-mini"><option value="gpt-5.3-codex-spark"><option value="codex-auto-review"></datalist>'
    html += '<datalist id="dl_CX_MODELS"><option value="gpt-5.6-sol"><option value="gpt-5.6-terra"><option value="gpt-5.6-luna"><option value="gpt-5.5"><option value="gpt-5.4"><option value="gpt-5.4-mini"><option value="gpt-5.3-codex-spark"><option value="codex-auto-review"></datalist>'
    // CP_MODEL/CP_MODELS options: "auto" and "gpt-5.4" verified live from "copilot --help" on this machine;
    // "claude-sonnet-4.6" is a repo-internal reference (install.sh CP_MODEL comment example), not CLI-verified;
    // "gpt-5.2" removed — never CLI-verified for copilot and has since dropped out of the Codex catalog too (2026-07-11).
    html += '<datalist id="dl_CP_MODEL"><option value="auto"><option value="gpt-5.4"><option value="claude-sonnet-4.6"></datalist>'
    html += '<datalist id="dl_CP_MODELS"><option value="auto"><option value="gpt-5.4"><option value="claude-sonnet-4.6"></datalist>'
    // OC_MODEL/OC_MODELS datalists are created empty — populated from /api/models/opencode fetch below.
    html += '<datalist id="dl_OC_MODEL"></datalist>'
    html += '<datalist id="dl_OC_MODELS"></datalist>'
    html += '</div>'
    setView(key, html)
    // Populate OpenCode (OpenRouter) model-ID datalists from live endpoint.
    try {
      var ocModels = await j('/api/models/opencode')
      if (ocModels && ocModels.length > 0) {
        for (var di = 0; di < 2; di++) {
          var dlId = di === 0 ? 'dl_OC_MODEL' : 'dl_OC_MODELS'
          var dl = document.getElementById(dlId)
          if (dl) {
            for (var mi = 0; mi < ocModels.length; mi++) {
              var opt = document.createElement('option')
              opt.value = ocModels[mi]
              dl.appendChild(opt)
            }
          }
        }
      }
    } catch(ocErr) { /* datalists stay empty on fetch failure — non-blocking */ }
  } catch (e) {
    setView(key, '<div class="err">Failed to load configuration: ' + esc(e.message) + '</div>')
  }
}
let _cleanStaleSecs = 600
let _cleanCount = 0

function closeCleanPanel() {
  document.getElementById('cleanPanel').style.display = 'none'
}

function fmtCleanDuration(ms) {
  if (typeof ms !== 'number' || ms < 0) return '?'
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's'
  return (ms / 3600000).toFixed(1) + 'h'
}

async function openCleanPanel() {
  const panel = document.getElementById('cleanPanel')
  panel.style.display = 'block'
  panel.innerHTML = 'Scanning…'
  try {
    const data = await j('/api/clean')
    _cleanStaleSecs = data.staleSecs
    _cleanCount = data.count
    if (data.count === 0) {
      panel.innerHTML = '<div style="padding:8px;color:var(--dim)">Nothing to clean — all sessions are fresh.</div>'
      return
    }
    let html = '<div style="margin-bottom:8px;color:var(--dim)">Found <b>' + data.count + '</b> stale session(s) in <code>' + esc(data.root) + '</code> (idle &gt; ' + data.staleSecs + 's):</div>'
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i]
      html += '<div class="clean-item">' + esc(item.backend) + ' · ' + esc(item.id) + ' · idle ' + fmtCleanDuration(item.idleMs) + '</div>'
    }
    html += '<button class="tkbtn" onclick="confirmClean()" style="margin-top:8px">Confirm delete ' + data.count + '</button>'
    html += ' <button class="tkbtn" onclick="closeCleanPanel()" style="margin-top:8px">Cancel</button>'
    panel.innerHTML = html
  } catch (e) {
    panel.innerHTML = '<div class="err">Failed: ' + esc(e.message) + '</div>'
  }
}

// Lists leftover *-wt-* worktree artifacts. Read-only BY DESIGN — no delete button.
// cli-dispatch-clean's sweep never removes a dirty worktree (commands/clean.md), and a dirty
// worktree is exactly what a successful run leaves behind, so these can only be resolved by hand.
// Offering a delete here would make the dashboard the one surface that breaks that invariant.
async function openWorktreePanel() {
  const panel = document.getElementById('cleanPanel')
  panel.style.display = 'block'
  panel.innerHTML = 'Scanning…'
  try {
    const data = await j('/api/clean?worktrees=1')
    if (!data.count) {
      panel.innerHTML = '<div style="padding:8px;color:var(--dim)">No leftover worktrees in ' + esc((data.roots || []).join(', ')) + '.</div>'
        + '<button class="tkbtn" onclick="closeCleanPanel()" style="margin-top:8px">Close</button>'
      return
    }
    let html = '<div style="margin-bottom:8px;color:var(--dim)">Found <b>' + data.count + '</b> worktree artifact(s)'
      + (data.dirty ? ', <b>' + data.dirty + '</b> with uncommitted changes' : '') + ':</div>'
    for (var i = 0; i < data.items.length; i++) {
      var it = data.items[i]
      // dirty === null means git could not tell us (missing binary, or not a valid worktree).
      var state = it.dirty === null
        ? '<span class="muted">unknown</span>'
        : (it.dirty ? '<span class="warnt">' + it.files + ' uncommitted</span>' : '<span class="muted">clean</span>')
      html += '<div class="clean-item">' + (it.backend ? esc(it.backend) + ' · ' : '') + state
        + ' · ' + it.ageDays + 'd · <span class="pathline">' + esc(it.path) + '</span></div>'
    }
    // One copyable block rather than a per-item button: the parent repo is only sometimes
    // resolvable, and a clean worktree is what the automated sweep already handles.
    var cmds = []
    for (var k = 0; k < data.items.length; k++) {
      var w = data.items[k]
      cmds.push(w.sourceRepo
        ? 'git -C "' + w.sourceRepo + '" worktree remove "' + w.path + '" --force'
        : 'git -C "' + w.path + '" worktree remove "' + w.path + '" --force')
    }
    html += '<div class="small muted" style="margin-top:8px">Review each one, then remove by hand — the dashboard deliberately will not delete a worktree with uncommitted changes:</div>'
    html += '<pre class="md-pre pathline">' + esc(cmds.join('\\n')) + '</pre>'
    html += '<div class="small muted">Clean, idle ones are swept automatically by /cli-dispatch:clean --worktree-days N.</div>'
    html += '<button class="tkbtn" onclick="closeCleanPanel()" style="margin-top:8px">Close</button>'
    panel.innerHTML = html
  } catch (e) {
    panel.innerHTML = '<div class="err">Failed: ' + esc(e.message) + '</div>'
  }
}

async function confirmClean() {
  const panel = document.getElementById('cleanPanel')
  panel.innerHTML = 'Deleting…'
  try {
    // X-CLI-Dispatch-Takeover is the non-CORS-simple header that forces a preflight the server
    // never grants cross-origin; POST /api/clean now requires it, as POST /api/config already did.
    const res = await fetch('/api/clean', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CLI-Dispatch-Takeover': '1' }, body: JSON.stringify({ staleSecs: _cleanStaleSecs }) })
    const body = await res.json()
    var html = '<div style="margin-bottom:8px">Removed <b>' + body.removed + '</b> of <b>' + body.count + '</b> stale sessions.</div>'
    if (body.failed && body.failed.length) {
      html += '<div style="color:var(--error)">Failures:</div>'
      for (var fi = 0; fi < body.failed.length; fi++) {
        html += '<div class="clean-item" style="color:var(--error)">' + esc(body.failed[fi].id) + ': ' + esc(body.failed[fi].error) + '</div>'
      }
    }
    html += '<button class="tkbtn" onclick="closeCleanPanel()" style="margin-top:8px">Close</button>'
    panel.innerHTML = html
    loadList()
  } catch (e) {
    panel.innerHTML = '<div class="err">Delete failed: ' + esc(e.message) + '</div>'
  }
}
function reopen(sid){ fetch('/api/sessions').then(r=>r.json()).then(ss=>{const s=ss.find(x=>x.id===sid); if(s) openSession(s)}) }
function back(){ watchDetail(null); takeoverTeardown(); { const tk=document.getElementById('takeover'); tk.style.display='none'; tk.innerHTML='' } sel=null; window._cur=null; document.getElementById('sidePanel').innerHTML=''; if(mode==='w'){document.getElementById('crumb').textContent='Workers'; setEmptyMainState()}else{document.getElementById('crumb').textContent='Sessions'; setEmptyMainState()} loadList() }
document.getElementById('tabCC').onclick=()=>{mode='cc';document.getElementById('tabCC').classList.add('on');document.getElementById('tabW').classList.remove('on');back()}
document.getElementById('tabW').onclick=()=>{mode='w';wFlt='all';document.getElementById('tabW').classList.add('on');document.getElementById('tabCC').classList.remove('on');back()}
initRailDrag()
loadList()
// Live list: SSE pushes a change whenever sessions/workers state changes (busy/idle flips, new runs).
const listES=new EventSource('/api/stream?watch=sessions')
listES.addEventListener('change', ()=>{ if(!sel) loadList() })
</script></body></html>`
