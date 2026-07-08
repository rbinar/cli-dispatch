---
description: Report worker token totals by backend
allowed-tools: Bash
---

# cli-dispatch gain

Read-only token accounting summary over worker session `status.json` files,
plus Anthropic babysitting token usage from runner subagent transcripts on this
machine (a subagent counts as a runner when it actually invoked a wrapper CLI —
`ds-agent`, `cx-stream`, etc. — in a Bash tool call; other subagents are
summarized in one line and excluded from the ratio).

Pass `--log` to ALSO append a timestamped JSON snapshot of the report to
`~/.cache/cli-dispatch/gain-history.jsonl` (one line per run), so runs can be
compared over time even after `/cli-dispatch:clean` deletes old session dirs.

```bash
ARGS="$*"
GAIN_LOG=0
case " $ARGS " in *" --log "*) GAIN_LOG=1;; esac
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
[ -n "$ROOT" ] || { ROOT="$CACHE/cli-dispatch/sessions"; [ -d "$ROOT" ] || ROOT="$CACHE/claude-ds/sessions"; }
[ -d "$ROOT" ] || { echo "(no sessions dir: $ROOT)"; exit 0; }

ROOT="$ROOT" GAIN_LOG="$GAIN_LOG" node <<'EOF'
const fs=require('fs'), path=require('path'), readline=require('readline'), os=require('os')
const root=process.env.ROOT
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return{}}}
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:(v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null)
function usage(u){
  if(!u||typeof u!=='object') return null
  let i,o
  if(u.tokens&&typeof u.tokens==='object'){
    i=u.tokens.input??u.tokens.prompt_tokens??u.tokens.promptTokens??u.tokens.input_tokens??u.tokens.inputTokens
    o=u.tokens.output??u.tokens.completion_tokens??u.tokens.completionTokens??u.tokens.output_tokens??u.tokens.outputTokens
  }
  if(i===undefined) i=u.input_tokens??u.prompt_tokens??u.inputTokens??u.promptTokens??u.input
  if(o===undefined) o=u.output_tokens??u.completion_tokens??u.outputTokens??u.completionTokens??u.output
  i=num(i); o=num(o)
  return i==null&&o==null?null:{input:i??0,output:o??0}
}
const fmt=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')

// A runner babysitter actually EXECUTES a wrapper CLI in a Bash tool call; other
// subagents at most mention the names (or read the scripts via a path prefix, which
// the leading [^/] boundary excludes). Bare-name invocation is how the runner defs work.
const RUNNER_RE=/(?:^|[;&|(]\s*|\s)(?:claude-ds(?:-stream)?|ds-agent|ds-worktree-run(?:\.sh)?|ag-agent|ag-stream|cx-agent|cx-stream|oc-agent|oc-stream|cp-agent|cp-stream)(?=\s|$)/

async function processAgentFile(fp){
  return new Promise((resolve)=>{
    const rl=readline.createInterface({input:fs.createReadStream(fp),crlfDelay:Infinity})
    const models=new Map()
    let isRunner=false
    rl.on('line',line=>{
      try{
        const obj=JSON.parse(line)
        const msg=obj&&obj.message
        if(!msg) return
        if(!isRunner&&Array.isArray(msg.content)){
          for(const c of msg.content){
            if(c&&c.type==='tool_use'&&c.name==='Bash'&&c.input&&typeof c.input.command==='string'&&RUNNER_RE.test(c.input.command)){ isRunner=true; break }
          }
        }
        if(!msg.usage||!msg.model) return
        // Only Anthropic models: claude-ds (DeepSeek) workers write the same
        // transcript layout under ~/.claude/projects — exclude them and synthetics.
        if(!String(msg.model).startsWith('claude-')) return
        const m=msg.model, u=msg.usage
        if(!models.has(m)) models.set(m,{input:0,output:0,cacheW:0,cacheR:0})
        const d=models.get(m)
        d.input+=num(u.input_tokens)||0
        d.output+=num(u.output_tokens)||0
        d.cacheW+=num(u.cache_creation_input_tokens)||0
        d.cacheR+=num(u.cache_read_input_tokens)||0
      }catch{}
    })
    rl.on('close',()=>resolve({models,isRunner}))
    rl.on('error',()=>resolve({models:new Map(),isRunner:false}))
  })
}

;(async()=>{
  // --- Worker section ---
  const byBackend=new Map()
  let totalNoData=0, trivialCount=0, oldest='', newest=''
  for(const d of fs.readdirSync(root)){
    const dir=path.join(root,d)
    try{ if(!fs.statSync(dir).isDirectory()) continue }catch{ continue }
    const st=read(path.join(dir,'status.json')), m=read(path.join(dir,'meta.json'))
    const backend=st.backend||m.backend||'deepseek'
    const cf=read(path.join(dir,'changed-files.json'))
    if(cf && typeof cf.diffstat === 'string') {
      // diffstat like " 3 files changed, 120 insertions(+), 5 deletions(-)" —
      // either part may be absent, so match them independently.
      let total = 0
      const mi = cf.diffstat.match(/(\d+) insertion/); if(mi) total += parseInt(mi[1], 10)
      const md = cf.diffstat.match(/(\d+) deletion/);  if(md) total += parseInt(md[1], 10)
      if(total > 0 && total < 50) trivialCount++;
    }
    const row=byBackend.get(backend)||{sessions:0,input:0,output:0,noData:0}
    row.sessions++
    const u=usage(st.usage)
    if(u){ row.input+=u.input; row.output+=u.output } else { row.noData++; totalNoData++ }
    byBackend.set(backend,row)
    const started=m.startedAt
    if(typeof started==='string'&&started){
      if(!oldest||started<oldest) oldest=started
      if(!newest||started>newest) newest=started
    }
  }
  console.log(`root: ${root}`)
  console.log(`oldest: ${oldest||'?'}  newest: ${newest||'?'}`)
  console.log('')
  console.log('backend       sessions       input      output    no data')
  console.log('------------ -------- ------------ ------------ ----------')
  for(const [backend,row] of [...byBackend.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    console.log(`${backend.padEnd(12)} ${String(row.sessions).padStart(8)} ${fmt(row.input).padStart(12)} ${fmt(row.output).padStart(12)} ${String(row.noData).padStart(10)}`)
  }
  console.log('')
  console.log(`sessions with no usage data: ${totalNoData}`)
  console.log('')
  // Count trivial delegations (diff < 50 lines)
  if(trivialCount>0) console.log(`trivial delegations (diff < 50 lines): ${trivialCount} — cheaper done inline; batch or inline next time`)

  // --- Anthropic babysitting (subagent transcripts) ---
  // Structure: ~/.claude/projects/<project>/<sessionId>/subagents/agent-*.jsonl
  const projectsDir=path.join(os.homedir(),'.claude','projects')
  const agentFiles=[]
  try{
    for(const pd of fs.readdirSync(projectsDir)){
      const projectPath=path.join(projectsDir,pd)
      try{
        for(const sessId of fs.readdirSync(projectPath)){
          const sd=path.join(projectPath,sessId,'subagents')
          try{
            for(const f of fs.readdirSync(sd)){
              if(f.startsWith('agent-')&&f.endsWith('.jsonl')) agentFiles.push(path.join(sd,f))
            }
          }catch{}
        }
      }catch{}
    }
  }catch{}

  // Runner babysitters get the full table + ratio; everything else (reviewers,
  // explorers, unrelated projects) is summarized in one line — it is not a
  // cli-dispatch cost and used to make the ratio meaningless.
  const anthroByModel=new Map()
  let otherAgents=0, otherOutput=0
  for(const fp of agentFiles){
    const {models:fileModels,isRunner}=await processAgentFile(fp)
    if(!isRunner){
      let sawModel=false
      for(const [,data] of fileModels){ otherOutput+=data.output; sawModel=true }
      if(sawModel) otherAgents++
      continue
    }
    for(const [model,data] of fileModels){
      if(!anthroByModel.has(model)){
        anthroByModel.set(model,{agents:new Set(),input:0,output:0,cacheW:0,cacheR:0})
      }
      const am=anthroByModel.get(model)
      am.agents.add(fp)
      am.input+=data.input
      am.output+=data.output
      am.cacheW+=data.cacheW
      am.cacheR+=data.cacheR
    }
  }

  if(anthroByModel.size>0){
    let totalWorkerOutput=0, totalWorkerInput=0
    for(const [,row] of byBackend){ totalWorkerOutput+=row.output; totalWorkerInput+=row.input }
    let totalAnthroOutput=0

    console.log('')
    console.log('Anthropic babysitting (runner subagents only, all projects on this machine)')
    console.log('model                 agents      input     output     cacheW      cacheR')
    console.log('-------------------- ---------- ---------- ---------- ---------- ----------')
    for(const [model,am] of [...anthroByModel.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      totalAnthroOutput+=am.output
      console.log(`${model.padEnd(20)} ${String(am.agents.size).padStart(10)} ${fmt(am.input).padStart(10)} ${fmt(am.output).padStart(10)} ${fmt(am.cacheW).padStart(10)} ${fmt(am.cacheR).padStart(10)}`)
    }

    const ratio=totalWorkerOutput>0?((totalAnthroOutput/totalWorkerOutput)*100).toFixed(1):'-'
    console.log('')
    console.log(`ratio: babysitter output ≈ ${ratio}% of worker output  |  worker input offloaded: ${fmt(totalWorkerInput)} tokens`)
  }
  if(otherAgents>0){
    console.log(`other (non-runner) subagents: ${otherAgents} agents, output ${fmt(otherOutput)} — excluded from ratio`)
  }

  // --- optional history snapshot (--log) ---
  if(process.env.GAIN_LOG==='1'){
    const snap={ts:new Date().toISOString(),workers:{},trivialDelegations:trivialCount,anthropic:{},otherSubagents:{agents:otherAgents,output:otherOutput}}
    for(const [b,r] of byBackend) snap.workers[b]={sessions:r.sessions,input:r.input,output:r.output,noData:r.noData}
    for(const [m,a] of anthroByModel) snap.anthropic[m]={agents:a.agents.size,input:a.input,output:a.output,cacheW:a.cacheW,cacheR:a.cacheR}
    const histFile=path.join(path.dirname(root),'gain-history.jsonl')
    try{
      fs.appendFileSync(histFile,JSON.stringify(snap)+'\n')
      console.log('')
      console.log(`logged → ${histFile}`)
    }catch(e){ console.log(`(history log failed: ${e.message})`) }
  }
})()
```
