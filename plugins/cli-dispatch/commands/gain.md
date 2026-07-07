---
description: Report worker token totals by backend
allowed-tools: Bash
---

# cli-dispatch gain

Read-only token accounting summary over worker session `status.json` files.

```bash
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
ROOT="${CLI_DISPATCH_SESSIONS_DIR:-${CLAUDE_DS_SESSIONS_DIR:-}}"
[ -n "$ROOT" ] || { ROOT="$CACHE/cli-dispatch/sessions"; [ -d "$ROOT" ] || ROOT="$CACHE/claude-ds/sessions"; }
[ -d "$ROOT" ] || { echo "(no sessions dir: $ROOT)"; exit 0; }

ROOT="$ROOT" node <<'EOF'
const fs=require('fs'), path=require('path')
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
const byBackend=new Map()
let totalNoData=0, oldest='', newest=''
for(const d of fs.readdirSync(root)){
  const dir=path.join(root,d)
  try{ if(!fs.statSync(dir).isDirectory()) continue }catch{ continue }
  const st=read(path.join(dir,'status.json')), m=read(path.join(dir,'meta.json'))
  const backend=st.backend||m.backend||'deepseek'
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
const fmt=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')
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
EOF
```
