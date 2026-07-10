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
.muted{color:var(--dim)}.small{font-size:11px}
.main{overflow:auto;padding:14px;grid-column:3;grid-row:1}
.crumb{margin-bottom:10px;color:var(--dim)}.crumb a{color:var(--accent);cursor:pointer;text-decoration:none}
.badge{border:1px solid var(--bd);border-radius:6px;padding:1px 7px;font-size:11px;color:var(--dim);margin-left:6px}
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
.panel.task .md{max-height:38vh;overflow:auto}.panel.task .sabody{padding-top:4px}
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
.panel.wk{border-color:var(--accent);background:var(--wk-panel)}
.panel.wk>summary{color:var(--accent)}
.sa.act{border-color:var(--success);color:var(--success)}
.live{color:var(--success)}
a.agentlink{color:var(--accent);cursor:pointer}
.human{background:var(--human)}
.badge.human{border-color:var(--human);color:var(--human)}
.badge.warn{border-color:var(--warning);color:var(--warning)}
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
<span class="small muted" id="meta"></span><button class="tkbtn" id="cleanBtn" onclick="openCleanPanel()" style="font-size:11px;padding:2px 8px">Clean stale sessions</button><span class="small muted">· read-only by default · opt-in takeover</span><button class="tkbtn" id="themeBtn" onclick="var h=document.documentElement;var n=h.getAttribute('data-theme')==='light'?'dark':'light';h.setAttribute('data-theme',n);localStorage.setItem('cli-dispatch-theme',n);this.textContent=n==='dark'?'☀':'☾'" title="Toggle theme" style="font-size:13px;padding:2px 8px">☀</button><button class="tkbtn" id="configBtn" onclick="openConfigView()" title="Configuration" style="font-size:13px;padding:2px 8px;margin-left:6px">⚙</button><script>document.getElementById("themeBtn").textContent=document.documentElement.getAttribute("data-theme")==="dark"?"☀":"☾"</script></header>
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
// "High overhead" heuristic: flag a worker row when its babysitter (the Claude Code runner
// that dispatched it) burned more than HIGH_OVERHEAD_RATIO times the OUTPUT tokens the worker
// itself produced on its own (usually cheaper) backend — i.e. delegation likely cost MORE
// Anthropic-native tokens than it saved. 4x is chosen as a middle point of a defensible 3-5x
// range: tolerant of normal babysitter overhead (polling/verification/reasoning) while still
// catching clear waste. When the worker's own usage was never captured (e.g. the Antigravity
// backend does not report usage), the ratio is unprovable — we deliberately do NOT flag in
// that case, to avoid crying wolf on backends that simply don't report usage.
const HIGH_OVERHEAD_RATIO = 4
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
function workersOverviewHtml(agg){
  const keys=Object.keys(agg||{}).sort()
  if(!keys.length) return '<div class="empty">No usage data yet.</div>'
  const cards=keys.map(k=>{
    const a=agg[k]||{}
    const nd=Number(a.noDataSessions)||0
    return '<div class="worker-overview-card"><div class="worker-overview-name">'+esc(k)+'</div><div class="small muted">'+esc(fmtTok(a.inputTokens))+' in / '+esc(fmtTok(a.outputTokens))+' out</div>'+(nd?'<div class="small muted">'+nd+' sessions no data</div>':'')+'</div>'
  }).join('')
  return '<div class="worker-overview"><div class="worker-overview-grid">'+cards+'</div></div>'
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
function workerBucket(w){
  if(w.state==='human-controlled') return 'human'
  if(w.stale||w.state==='error') return 'error'
  if(w.state==='running') return 'running'
  if(w.state==='done') return 'done'
  return 'error'
}
function isHighOverhead(w){
  return !!(w.parentSession && w.parentSession.babysitterUsage &&
    w.parentSession.babysitterUsage.outTok != null && w.usage && w.usage.outTok != null &&
    w.parentSession.babysitterUsage.outTok > HIGH_OVERHEAD_RATIO * w.usage.outTok)
}

async function loadList(){
  const el=document.getElementById('list')
  const fb=document.getElementById('filter')
  // Build first, swap once at the end — never blank the rail while the fetch is in flight.
  // Generation guard: a tab switch mid-fetch must not let the stale response win the rail.
  const gen=++loadListGen
  const frag=document.createDocumentFragment(); const sig=[]
  let agg=null
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
    agg=a
    const wCounts={all:ws.length,running:0,human:0,done:0,error:0}
    ws.forEach(w=>{ const k=workerBucket(w); wCounts[k]=(wCounts[k]||0)+1 })
    fb.style.display='flex'
    fb.innerHTML=[['all',wCounts.all],['running',wCounts.running],['human',wCounts.human],['done',wCounts.done],['error',wCounts.error]].map(([k,n])=>'<span class="fchip'+(wFlt===k?' on':'')+'" onclick="setWFilter(\\''+k+'\\')">'+k+'<span class="c">'+n+'</span></span>').join('')
    document.getElementById('meta').textContent=ws.length+' workers'
    const shown=wFlt==='all'?ws:ws.filter(w=>workerBucket(w)===wFlt)
    shown.forEach(w=>{
      const bucket=workerBucket(w)
      const live=bucket==='running'
      const dot=live?'busy':bucket==='human'?'human':bucket==='done'?'closed':bucket==='error'?'idle':'idle'
      const badge=w.stale?'stale':w.state
      const badgeCls='badge'+(bucket==='human'?' human':'')
      const u=fmtUsage(w.usage)
      let usageLine=''
      if(u&&(u.tokStr||u.costStr)){
        usageLine=' · '+(u.tokStr?esc(u.tokStr):'')+(u.tokStr&&u.costStr?' · ':'')+(u.costStr?esc(u.costStr):'')
      }
      const proj=shortProj(w.cwd)
      const h='<div class="item'+(sel===w.id?' sel':'')+'"><div><span class="dot '+dot+'"></span>'+esc(w.backend)+' <span class="c">'+(w.model?esc(w.model):'default')+'</span> <span class="'+badgeCls+'">'+esc(badge)+'</span>'+(isHighOverhead(w)?' <span class="badge warn">high overhead</span>':'')+'</div>'+(proj?'<div class="small muted">'+esc(proj)+'</div>':'')+(w.parentSession?'<div class="small muted">from '+esc(shortSessionProj(w.parentSession.project))+'</div>':'')+'<div class="small muted">'+esc(w.prompt||w.id.slice(0,8))+'</div><div class="small muted">'+esc(fmtDT(w.started))+(w.lastTool?' · '+esc(w.lastTool):'')+usageLine+'</div></div>'
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
  if(mode==='w'){ setView('workers-overview', workersOverviewHtml(agg)) }
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
function usageHtml(usage){
  const u=fmtUsage(usage,true)
  if(!u||(!u.tokStr&&!u.costStr)) return ''
  const parts=[]
  if(u.tokStr) parts.push(u.tokStr)
  if(u.costStr) parts.push(u.costStr)
  return '<div class="small muted" style="margin:4px 8px 12px">Usage: '+esc(parts.join(' · '))+'</div>'
}
function babysitterUsageHtml(w, workerUsage){
  if(!w.parentSession||!w.parentSession.babysitterUsage) return ''
  const bUsage=w.parentSession.babysitterUsage
  const bFmt=fmtUsage(bUsage,true)
  if(!bFmt||!bFmt.tokStr) return ''
  const wFmt=workerUsage?fmtUsage(workerUsage,true):null
  const wHasTokens=wFmt&&wFmt.tokStr
  if(wHasTokens){
    const totalUsage={
      inTok:(bUsage.inTok||0)+(workerUsage.inTok||0),
      outTok:(bUsage.outTok||0)+(workerUsage.outTok||0)
    }
    const tFmt=fmtUsage(totalUsage,true)
    const tTokStr=tFmt?tFmt.tokStr:''
    return '<div class="small muted" style="margin:4px 8px 12px">Babysitter cost: '+esc(bFmt.tokStr)+'<br>Total: '+esc(tTokStr)+'</div>'
  }
  return '<div class="small muted" style="margin:4px 8px 12px">Babysitter cost: '+esc(bFmt.tokStr)+' (worker-side usage not captured — total unknown)</div>'
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
async function openWorker(w){
  sel=w.id;
  document.getElementById('sidePanel').innerHTML=''
  document.getElementById('crumb').innerHTML='<a onclick="back()">workers</a> › '+esc(w.backend)+' <span class="c">'+(w.model?esc(w.model):'default')+'</span> '+esc(w.id.slice(0,12))+' <span class="muted">('+esc(w.stale?'stale':w.state)+')</span>'
  renderTakeoverBar(w)
  const taskPanel=document.querySelector('#view details.panel.task'); const taskOpen=taskPanel?taskPanel.open:false
  const key='worker:'+w.id
  const v=document.getElementById('view')
  if(v._k!==key){ v._k=key; v._h=null; v.className=''; v.innerHTML='loading…' }
  const flow=await j('/api/worker/'+w.id+'/flow')
  let h=''
  if(flow.prompt) h+='<details class="panel task"'+(taskOpen?' open':'')+'><summary>Görev / talimat</summary><div class="sabody"><div class="md">'+md(flow.prompt)+'</div></div></details>'
  h+=usageHtml(flow.usage)
  h+=babysitterUsageHtml(w, flow.usage)
  h+='<div class="term-flow">'+renderFlow(flow.steps)
  if(flow.finalResultPreview) h+='<div class="step message" style="margin-top:10px">⏺ <b>result:</b> '+esc(flow.finalResultPreview)+'</div>'
  h+='</div>'
  setView(key,h); loadList()
  watchDetail(((w.state==='running'&&!w.stale)||w.state==='human-controlled')?'worker:'+w.id:null, ()=>openWorker(w))
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
async function renderConfigEditor() {
  const v = document.getElementById('view')
  const key = 'config'
  try {
    // Fields that get a <datalist> with model-ID suggestions (suggestions only, free text still allowed).
    // AG/CX/CP datalists are static (sourced from live CLI output or repo docs — see comments below).
    // OC_MODEL/OC_MODELS datalists are populated from a live fetch to /api/models/opencode.
    var modelFields = {AG_MODEL:1,AG_MODELS:1,CX_MODEL:1,CX_MODELS:1,CP_MODEL:1,CP_MODELS:1,OC_MODEL:1,OC_MODELS:1}
    const cfg = await j('/api/config')
    const groups = [
      { name: 'DeepSeek', keys: ['DEEPSEEK_API_KEY', 'DS_MODEL', 'DS_FLASH_MODEL'] },
      { name: 'Antigravity', keys: ['GEMINI_API_KEY', 'AG_MODEL', 'AG_MODELS'] },
      { name: 'Codex', keys: ['CODEX_API_KEY', 'CX_MODEL', 'CX_MODELS'] },
      { name: 'OpenCode', keys: ['OPENROUTER_API_KEY', 'OC_MODEL', 'OC_MODELS'] },
      { name: 'Copilot', keys: ['COPILOT_GITHUB_TOKEN', 'CP_MODEL', 'CP_MODELS'] }
    ]
    let html = '<div style="max-width:800px">'
    for (const g of groups) {
      html += '<div class="panel">'
      html += '<div style="padding:8px 12px;border-bottom:1px solid var(--bd);font-weight:bold;color:var(--accent)">' + esc(g.name) + ' Backend</div>'
      html += '<div class="sabody" style="padding:12px">'
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
          html += '<div class="small muted" style="margin-top:2px">Comma-separated candidate model list (optional). When the delegation prompt names no explicit model, the babysitter checks this list first and picks the best fit itself — same reasoning as an orchestrator-provided list, just persisted here instead of retyped each time. Leave empty to keep using the single default above.</div>'
        } else if (!item.secret && k.endsWith('_MODEL')) {
          html += '<div class="small muted" style="margin-top:2px">Single default model, used only when no --model is passed and no candidate list applies. For multi-candidate selection (babysitter picks one), either list candidates in the task prompt, or set the matching ' + esc(k.replace(/_MODEL$/, '') + '_MODELS') + ' field below for a standing default list.</div>'
        }
        html += '</div>'
      }
      html += '</div></div>'
    }
    // Static <datalist> model-ID suggestions for AG/CX/CP backends.
    // AG_MODEL/AG_MODELS options sourced from verified live output of "agy models" on this machine.
    html += '<datalist id="dl_AG_MODEL"><option value="Gemini 3.5 Flash (Medium)"><option value="Gemini 3.5 Flash (High)"><option value="Gemini 3.5 Flash (Low)"><option value="Gemini 3.1 Pro (Low)"><option value="Gemini 3.1 Pro (High)"><option value="Claude Sonnet 4.6 (Thinking)"><option value="Claude Opus 4.6 (Thinking)"><option value="GPT-OSS 120B (Medium)"></datalist>'
    html += '<datalist id="dl_AG_MODELS"><option value="Gemini 3.5 Flash (Medium)"><option value="Gemini 3.5 Flash (High)"><option value="Gemini 3.5 Flash (Low)"><option value="Gemini 3.1 Pro (Low)"><option value="Gemini 3.1 Pro (High)"><option value="Claude Sonnet 4.6 (Thinking)"><option value="Claude Opus 4.6 (Thinking)"><option value="GPT-OSS 120B (Medium)"></datalist>'
    // CX_MODEL/CX_MODELS options sourced from verified live ~/.codex/models_cache.json on this machine.
    html += '<datalist id="dl_CX_MODEL"><option value="gpt-5.5"><option value="gpt-5.4"><option value="gpt-5.4-mini"><option value="gpt-5.3-codex-spark"><option value="codex-auto-review"></datalist>'
    html += '<datalist id="dl_CX_MODELS"><option value="gpt-5.5"><option value="gpt-5.4"><option value="gpt-5.4-mini"><option value="gpt-5.3-codex-spark"><option value="codex-auto-review"></datalist>'
    // CP_MODEL/CP_MODELS options: "auto" and "gpt-5.4" verified live from "copilot --help" on this machine;
    // "claude-sonnet-4.6" and "gpt-5.2" are repo-internal references (install.sh CP_MODEL comment examples), not CLI-verified.
    html += '<datalist id="dl_CP_MODEL"><option value="auto"><option value="gpt-5.4"><option value="claude-sonnet-4.6"><option value="gpt-5.2"></datalist>'
    html += '<datalist id="dl_CP_MODELS"><option value="auto"><option value="gpt-5.4"><option value="claude-sonnet-4.6"><option value="gpt-5.2"></datalist>'
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

async function confirmClean() {
  const panel = document.getElementById('cleanPanel')
  panel.innerHTML = 'Deleting…'
  try {
    const res = await fetch('/api/clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staleSecs: _cleanStaleSecs }) })
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
