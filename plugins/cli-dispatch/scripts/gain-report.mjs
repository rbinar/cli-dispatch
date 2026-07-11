#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import os from 'node:os'

const cacheRoot=process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache')
let ROOT=process.env.CLI_DISPATCH_SESSIONS_DIR||''
if(!ROOT){
  ROOT=path.join(cacheRoot,'cli-dispatch/sessions')
  if(!fs.existsSync(ROOT) && fs.existsSync(path.join(cacheRoot,'claude-ds/sessions'))){
    ROOT=path.join(cacheRoot,'claude-ds/sessions')
  }
}
const ARGS=new Set(process.argv.slice(2))
const GAIN_LOG=ARGS.has('--log') || process.env.GAIN_LOG==='1'

const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return{}}}
const num=v=>{
  if(typeof v==='number'&&Number.isFinite(v)) return v
  if(v!=null&&v!==''&&Number.isFinite(Number(v))) return Number(v)
  return null
}
const fmt=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')
const messageFor=(obj)=>{
  if(!obj||typeof obj!=='object') return null
  if(obj.message && typeof obj.message==='object') return obj.message
  if(obj.data && typeof obj.data==='object') return obj.data
  return null
}
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
  // Codex reports cache-INCLUSIVE input_tokens (cached_input_tokens is a subset,
  // often 90%+) — subtract it so "input offloaded" counts fresh input only (#99).
  const cached=num(u.cached_input_tokens)
  if(i!=null&&cached!=null&&cached<=i) i-=cached
  return i==null&&o==null?null:{input:i??0,output:o??0}
}

// A runner babysitter actually EXECUTES a wrapper CLI in a Bash tool call; other
// subagents at most mention the names (or read the scripts via a path prefix, which
// the leading [^/] boundary excludes). Bare-name invocation is how the runner defs work.
const RUNNER_RE=/(?:^|[;&|(]\s*|\s)(?:claude-ds(?:-stream)?|ds-agent|ds-worktree-run(?:\.sh)?|ag-agent|ag-stream|cx-agent|cx-stream|oc-agent|oc-stream|cp-agent|cp-stream)(?=\s|$)/

async function processAgentFile(fp){
  return new Promise((resolve)=>{
    const rl=readline.createInterface({input:fs.createReadStream(fp),crlfDelay:Infinity})
    const models=new Map()
    let isRunner=false
    let assistantTurns=0
    rl.on('line',line=>{
      try{
        const obj=JSON.parse(line)
        const msg=messageFor(obj)
        if(!msg) return
        if(!isRunner&&Array.isArray(msg.content)){
          for(const c of msg.content){
            if(c&&c.type==='tool_use'&&c.name==='Bash'&&c.input&&typeof c.input.command==='string'&&RUNNER_RE.test(c.input.command)){ isRunner=true; break }
          }
        }
        if(obj.type==='assistant.message' || msg.role==='assistant'){
          assistantTurns += 1
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
    rl.on('close',()=>resolve({models,isRunner,assistantTurns}))
    rl.on('error',()=>resolve({models:new Map(),isRunner:false,assistantTurns:0}))
  })
}

;(async()=>{
  if(!ROOT){
    console.log('(no sessions dir: )')
    return
  }
  if(!fs.existsSync(ROOT)){ console.log(`(no sessions dir: ${ROOT})`); return }

  // --- Worker section ---
  const byBackend=new Map()
  let totalNoData=0, trivialCount=0, oldest='', newest=''
  const trivialSessions=[]
  for(const d of fs.readdirSync(ROOT)){
    const dir=path.join(ROOT,d)
    try{ if(!fs.statSync(dir).isDirectory()) continue }catch{ continue }
    const st=read(path.join(dir,'status.json')), m=read(path.join(dir,'meta.json'))
    const backend=st.backend||m.backend||'deepseek'
    const cf=read(path.join(dir,'changed-files.json'))
    if(cf && typeof cf.diffstat === 'string') {
      let total = 0
      const mi=cf.diffstat.match(/(\d+) insertion/)
      const md=cf.diffstat.match(/(\d+) deletion/)
      if(mi) total += parseInt(mi[1],10)
      if(md) total += parseInt(md[1],10)
      if(total > 0 && total < 50){
        trivialCount++
        trivialSessions.push({sessionId:d,cwd:m.cwd||'',backend,diffstat:cf.diffstat,startedAt:m.startedAt||''})
      }
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

  console.log(`root: ${ROOT}`)
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
  if(trivialCount>0) console.log(`trivial delegations (diff < 50 lines): ${trivialCount} — cheaper done inline; batch or inline next time`)

  // Cluster trivial sessions by (cwd,backend), chaining consecutive startedAt values under a
  // 15-minute window.
  const RETRY_WINDOW_MS=15*60*1000
  const trivialGroups=new Map()
  for(const s of trivialSessions){
    if(!s.cwd) continue
    const key=s.cwd+' '+s.backend
    if(!trivialGroups.has(key)) trivialGroups.set(key,[])
    trivialGroups.get(key).push(s)
  }
  const trivialClusters=[]
  for(const [,list] of trivialGroups){
    list.sort((a,b)=>(a.startedAt||'').localeCompare(b.startedAt||''))
    let current=[], prevTime=null
    for(const s of list){
      const t=Date.parse(s.startedAt)
      const valid=Number.isFinite(t)
      if(current.length>0 && valid && prevTime!=null && (t-prevTime)<=RETRY_WINDOW_MS){
        current.push(s)
      } else {
        if(current.length>=2) trivialClusters.push(current)
        current=[s]
      }
      prevTime=valid?t:null
    }
    if(current.length>=2) trivialClusters.push(current)
  }
  const trivialClusterRecords=trivialClusters.map(c=>({
    cwd:c[0].cwd, backend:c[0].backend,
    sessionIds:c.map(s=>s.sessionId),
    count:c.length,
    firstStartedAt:c[0].startedAt,
    lastStartedAt:c[c.length-1].startedAt
  }))
  if(trivialClusterRecords.length>0){
    console.log('possible retry-as-new-delegation clusters (same cwd+backend, <15min apart):')
    for(const c of trivialClusterRecords){
      const hhmmss=t=>(t||'').slice(11,19)||'?'
      console.log(`  ${c.cwd} (${c.backend}): ${c.sessionIds.join(', ')}  (${c.count} sessions, ${hhmmss(c.firstStartedAt)} → ${hhmmss(c.lastStartedAt)})`)
    }
  }

  // --- Anthropic babysitting (subagent transcripts) ---
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

  const anthroByModel=new Map()
  let otherAgents=0, otherOutput=0
  let runnerTurnsTotal=0, runnerAgents=0, runnerTurnsOver20=0
  for(const fp of agentFiles){
    const {models:fileModels,isRunner,assistantTurns}=await processAgentFile(fp)
    if(!isRunner){
      let sawModel=false
      for(const [,data] of fileModels){ otherOutput+=data.output; sawModel=true }
      if(sawModel) otherAgents++
      continue
    }
    runnerAgents++
    runnerTurnsTotal += assistantTurns
    if(assistantTurns > 20) runnerTurnsOver20++
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
    const avgTurns=runnerAgents>0?(runnerTurnsTotal/runnerAgents):0
    // #97: backends whose sessions report no usage at all (e.g. antigravity — agy exposes
    // none) add babysitting to the numerator but zero worker output to the denominator,
    // so the printed ratio OVERSTATES the true babysitter/worker cost. Name them.
    const blindBackends=[...byBackend.entries()].filter(([,r])=>r.sessions>0&&r.output===0&&r.noData===r.sessions).map(([b,r])=>`${b} (${r.sessions})`)
    console.log('')
    console.log(`ratio: babysitter output ≈ ${ratio}% of worker output  |  worker input offloaded: ${fmt(totalWorkerInput)} tokens`)
    if(blindBackends.length) console.log(`ratio caveat: ${blindBackends.join(', ')} sessions report no usage — their babysitting counts in the numerator but adds nothing to the denominator, so the TRUE ratio is lower than shown`)
    console.log(`avg babysitter turns/runner: ${avgTurns.toFixed(2)}`)
    console.log(`${runnerTurnsOver20} runners exceeded 20 babysitter turns — polling instead of cli-dispatch-wait?`)
  }
  if(otherAgents>0){
    console.log(`other (non-runner) subagents: ${otherAgents} agents, output ${fmt(otherOutput)} — excluded from ratio`)
  }

  if(GAIN_LOG){
    const avgTurns=runnerAgents>0?(runnerTurnsTotal/runnerAgents):0
    const snap={ts:new Date().toISOString(),workers:{},trivialDelegations:trivialCount,trivialClusters:trivialClusterRecords,anthropic:{},otherSubagents:{agents:otherAgents,output:otherOutput},babysitting:{runnerTurns:{agents:runnerAgents,avgTurns,over20:runnerTurnsOver20}}}
    for(const [b,r] of byBackend) snap.workers[b]={sessions:r.sessions,input:r.input,output:r.output,noData:r.noData}
    for(const [m,a] of anthroByModel) snap.anthropic[m]={agents:a.agents.size,input:a.input,output:a.output,cacheW:a.cacheW,cacheR:a.cacheR}
    const histFile=path.join(path.dirname(ROOT),'gain-history.jsonl')
    try{
      fs.appendFileSync(histFile,JSON.stringify(snap)+'\n')
      console.log('')
      console.log(`logged → ${histFile}`)
    }catch(e){ console.log(`(history log failed: ${e.message})`) }
  }
})()
