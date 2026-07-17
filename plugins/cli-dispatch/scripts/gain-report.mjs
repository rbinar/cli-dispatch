#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import os from 'node:os'
import {pathToFileURL} from 'node:url'

// ---------------------------------------------------------------------------
// Pure, testable core. Everything above the `runMain()` guard is import-safe:
// requiring this module runs no filesystem work. The CLI entrypoint is the
// guarded IIFE at the bottom.
// ---------------------------------------------------------------------------

export const num=v=>{
  if(typeof v==='number'&&Number.isFinite(v)) return v
  if(v!=null&&v!==''&&Number.isFinite(Number(v))) return Number(v)
  return null
}
export const fmt=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')
export const messageFor=(obj)=>{
  if(!obj||typeof obj!=='object') return null
  if(obj.message && typeof obj.message==='object') return obj.message
  if(obj.data && typeof obj.data==='object') return obj.data
  return null
}
export function usage(u){
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
export const RUNNER_RE=/(?:^|[;&|(]\s*|\s)(?:claude-ds(?:-stream)?|ds-agent|ds-worktree-run(?:\.sh)?|ag-agent|ag-stream|cx-agent|cx-stream|oc-agent|oc-stream|cp-agent|cp-stream)(?=\s|$)/

// Runner subagents are pinned to haiku in their frontmatter; a CLI-invoking
// subagent on any other model is NOT a sanctioned runner (it's a main-loop
// /cli-dispatch:run invocation surfaced as a subagent, or a forbidden model
// override) and must not inflate the babysitter/worker ratio numerator.
export const PINNED_RUNNER_MODEL_RE=/haiku/i

// Real polling signal: a Bash command that reads a session status.json directly.
// cli-dispatch-wait blocks inside a single Bash call (1 assistant turn), so a
// command that uses it is NOT a hot-loop poll even though it names status.json.
export function isStatusPollCommand(cmd){
  if(typeof cmd!=='string') return false
  if(/cli-dispatch-wait/.test(cmd)) return false
  return /status\.json/.test(cmd)
}

// Map a wrapper-CLI invocation to its backend, so blind backends (whose worker
// sessions report no usage) can be excluded from the ratio numerator too.
export function backendFromCommand(cmd){
  if(typeof cmd!=='string') return null
  if(/(?:^|[;&|(]\s*|\s)(?:claude-ds(?:-stream)?|ds-agent|ds-worktree-run(?:\.sh)?)(?=\s|$)/.test(cmd)) return 'deepseek'
  if(/(?:^|[;&|(]\s*|\s)(?:ag-agent|ag-stream)(?=\s|$)/.test(cmd)) return 'antigravity'
  if(/(?:^|[;&|(]\s*|\s)(?:cx-agent|cx-stream)(?=\s|$)/.test(cmd)) return 'codex'
  if(/(?:^|[;&|(]\s*|\s)(?:oc-agent|oc-stream)(?=\s|$)/.test(cmd)) return 'opencode'
  if(/(?:^|[;&|(]\s*|\s)(?:cp-agent|cp-stream)(?=\s|$)/.test(cmd)) return 'copilot'
  return null
}

// Analyze one agent transcript (array of parsed JSONL objects) into the fields
// the report needs. Pure: no I/O.
export function analyzeAgentEvents(objs){
  const models=new Map()
  let isRunner=false, assistantTurns=0, statusPolls=0, backend=null
  for(const obj of (Array.isArray(objs)?objs:[])){
    const msg=messageFor(obj)
    if(!msg) continue
    if(Array.isArray(msg.content)){
      for(const c of msg.content){
        if(c&&c.type==='tool_use'&&c.name==='Bash'&&c.input&&typeof c.input.command==='string'){
          const cmd=c.input.command
          if(!isRunner&&RUNNER_RE.test(cmd)) isRunner=true
          if(!backend){ const b=backendFromCommand(cmd); if(b) backend=b }
          if(isStatusPollCommand(cmd)) statusPolls++
        }
      }
    }
    if(obj.type==='assistant.message' || msg.role==='assistant') assistantTurns+=1
    if(!msg.usage||!msg.model) continue
    // Only Anthropic models: claude-ds (DeepSeek) workers write the same
    // transcript layout under ~/.claude/projects — exclude them and synthetics.
    if(!String(msg.model).startsWith('claude-')) continue
    const m=msg.model, u=msg.usage
    if(!models.has(m)) models.set(m,{input:0,output:0,cacheW:0,cacheR:0})
    const d=models.get(m)
    d.input+=num(u.input_tokens)||0
    d.output+=num(u.output_tokens)||0
    d.cacheW+=num(u.cache_creation_input_tokens)||0
    d.cacheR+=num(u.cache_read_input_tokens)||0
  }
  return {models,isRunner,backend,assistantTurns,statusPolls}
}

// Compute the babysitter/worker ratio from per-runner records.
//   runnerRecords: [{backend, models:Map<model,{output,...}>, statusPolls}]
//   workerOutputTotal: summed worker output across backends (denominator)
//   blindBackends: Set of backend names whose worker sessions report no usage
//   pollThreshold: status.json direct-reads above which a runner is a heavy poller
// The numerator is sanctioned-runner babysitting only:
//   Fix 3 — a runner whose backend is "blind" (worker reports no usage) adds
//     babysitting but zero worker output, so drop its whole output.
//   Fix 2 — among non-blind runners, count only the pinned runner model (haiku);
//     any other model is a main-loop /cli-dispatch:run invocation or a forbidden
//     override, not a sanctioned runner.
//   Fix 1 — count runners that read status.json directly above the threshold
//     (real hot-loop polling that cli-dispatch-wait would have avoided).
export function computeBabysitRatio({runnerRecords, workerOutputTotal, blindBackends=new Set(), pollThreshold=5}){
  let numeratorOutput=0, excludedNonPinnedOutput=0, excludedBlindOutput=0, heavyPollers=0
  for(const r of (Array.isArray(runnerRecords)?runnerRecords:[])){
    if((r.statusPolls||0)>pollThreshold) heavyPollers++
    const blind=blindBackends.has(r.backend)
    for(const [model,d] of r.models){
      if(blind){ excludedBlindOutput+=d.output }
      else if(PINNED_RUNNER_MODEL_RE.test(model)){ numeratorOutput+=d.output }
      else{ excludedNonPinnedOutput+=d.output }
    }
  }
  const ratioPct=workerOutputTotal>0?(numeratorOutput/workerOutputTotal*100):null
  return {ratioPct, numeratorOutput, excludedNonPinnedOutput, excludedBlindOutput, heavyPollers}
}

async function readAgentObjs(fp){
  return new Promise((resolve)=>{
    const rl=readline.createInterface({input:fs.createReadStream(fp),crlfDelay:Infinity})
    const objs=[]
    rl.on('line',line=>{ try{ objs.push(JSON.parse(line)) }catch{} })
    rl.on('close',()=>resolve(objs))
    rl.on('error',()=>resolve([]))
  })
}

function resolveRoot(){
  const cacheRoot=process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache')
  let root=process.env.CLI_DISPATCH_SESSIONS_DIR||''
  if(!root){
    root=path.join(cacheRoot,'cli-dispatch/sessions')
    if(!fs.existsSync(root) && fs.existsSync(path.join(cacheRoot,'claude-ds/sessions'))){
      root=path.join(cacheRoot,'claude-ds/sessions')
    }
  }
  return root
}

const POLL_THRESHOLD=5

async function runMain(){
  const ROOT=resolveRoot()
  const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return{}}}
  if(!ROOT){ console.log('(no sessions dir: )'); return }
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
  let runnerTurnsTotal=0, runnerAgents=0
  const runnerRecords=[]
  for(const fp of agentFiles){
    const {models:fileModels,isRunner,backend,assistantTurns,statusPolls}=analyzeAgentEvents(await readAgentObjs(fp))
    if(!isRunner){
      let sawModel=false
      for(const [,data] of fileModels){ otherOutput+=data.output; sawModel=true }
      if(sawModel) otherAgents++
      continue
    }
    runnerAgents++
    runnerTurnsTotal += assistantTurns
    runnerRecords.push({backend, models:fileModels, statusPolls, assistantTurns})
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

    console.log('')
    console.log('Anthropic babysitting (runner subagents only, all projects on this machine)')
    console.log('model                 agents      input     output     cacheW      cacheR')
    console.log('-------------------- ---------- ---------- ---------- ---------- ----------')
    for(const [model,am] of [...anthroByModel.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      console.log(`${model.padEnd(20)} ${String(am.agents.size).padStart(10)} ${fmt(am.input).padStart(10)} ${fmt(am.output).padStart(10)} ${fmt(am.cacheW).padStart(10)} ${fmt(am.cacheR).padStart(10)}`)
    }

    // #97: backends whose sessions report no usage at all (e.g. antigravity — agy exposes
    // none) add babysitting to the numerator but zero worker output to the denominator,
    // so the printed ratio OVERSTATES the true babysitter/worker cost. Name them AND drop
    // their runner babysitting from the numerator (Fix 3).
    const blindBackendRows=[...byBackend.entries()].filter(([,r])=>r.sessions>0&&r.output===0&&r.noData===r.sessions)
    const blindBackendNames=new Set(blindBackendRows.map(([b])=>b))
    const blindBackends=blindBackendRows.map(([b,r])=>`${b} (${r.sessions})`)

    const {ratioPct, excludedNonPinnedOutput, excludedBlindOutput, heavyPollers}=computeBabysitRatio({
      runnerRecords, workerOutputTotal:totalWorkerOutput, blindBackends:blindBackendNames, pollThreshold:POLL_THRESHOLD
    })
    const ratio=ratioPct==null?'-':ratioPct.toFixed(1)
    const avgTurns=runnerAgents>0?(runnerTurnsTotal/runnerAgents):0

    console.log('')
    console.log(`ratio: pinned-runner (haiku) babysitter output ≈ ${ratio}% of worker output  |  worker input offloaded: ${fmt(totalWorkerInput)} tokens`)
    if(excludedNonPinnedOutput>0 || excludedBlindOutput>0){
      const parts=[]
      if(excludedNonPinnedOutput>0) parts.push(`${fmt(excludedNonPinnedOutput)} output from non-pinned-model CLI-invoking subagents (main-loop /cli-dispatch:run or model-overridden)`)
      if(excludedBlindOutput>0) parts.push(`${fmt(excludedBlindOutput)} output from blind-backend runners`)
      console.log(`excluded from numerator: ${parts.join('; ')}`)
    }
    if(blindBackends.length) console.log(`ratio caveat: ${blindBackends.join(', ')} sessions report no usage — worker output is zero for these; their runner babysitting is excluded from the numerator`)
    console.log(`avg babysitter turns/runner: ${avgTurns.toFixed(2)}`)
    console.log(`${heavyPollers} runners read status.json directly >${POLL_THRESHOLD}× (bypassing cli-dispatch-wait)`)
  }
  if(otherAgents>0){
    console.log(`other (non-runner) subagents: ${otherAgents} agents, output ${fmt(otherOutput)} — excluded from ratio`)
  }
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  runMain()
}
