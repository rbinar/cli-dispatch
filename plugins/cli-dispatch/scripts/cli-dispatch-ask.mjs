// Worker questions and messages (7.3.0). One file, five roles:
//   (no subcommand)            the MCP stdio server a worker talks to: ask_user + check_messages
//   answer <ask-dir> <qid>     the mod's answer helper (payload on stdin, never argv)
//   message <ask-dir>          the runs pane's message helper (payload on stdin, never argv)
//   config <backend> <ask-dir> prints what a stream adds to wire the server
//   install-ag <file>          merges the server entry into agy's global MCP config
// The ask dir (<sessions-root>/.ask/run-XXXXXX) is created by cli-dispatch-run, never here.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SERVER = fileURLToPath(import.meta.url)
const NAME = 'cli_dispatch_ask'
const MAX_CEILING_S = 300
const POLL_MS = 500
const ENGINE_TIMEOUT_S = 600
const QID_RE = /^[0-9a-f-]{36}$/
const MSG_RE = /^msg-\d{13}-[0-9a-f]{8}\.json$/

export function effectiveCeiling(envValue) {
  const n = Number(envValue)
  return Number.isInteger(n) && n >= 1 && n <= MAX_CEILING_S ? n : MAX_CEILING_S
}

function isDir(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

function writePrivate(file, text) {
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  writeFileSync(tmp, text, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

// ---------------------------------------------------------------- server

const ASK_TOOL = {
  name: 'ask_user',
  description: 'Ask the user a question and wait for the answer. Use only for a decision the task does not settle and you cannot make yourself.',
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 4 } },
    required: ['question'],
  },
}
const MESSAGES_TOOL = {
  name: 'check_messages',
  description: 'Return messages the user sent to this run since the last check. Non-blocking; call it after each shell command or file edit.',
  inputSchema: { type: 'object', properties: {} },
}

function text(t, isError = false) {
  return { content: [{ type: 'text', text: t }], isError }
}

function runServer() {
  const askDir = process.argv[2] || process.env.CLI_DISPATCH_ASK_DIR || ''
  const ceilingMs = effectiveCeiling(process.env.CLI_DISPATCH_ASK_CEILING_S) * 1000
  const pending = new Map() // request key -> { cancel(outcome) }

  const send = (obj, cb) => process.stdout.write(`${JSON.stringify(obj)}\n`, cb)
  const reply = (id, result, cb) => send({ jsonrpc: '2.0', id, result }, cb)
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  function log(entry) {
    try { appendFileSync(path.join(askDir, 'log.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 }) } catch {}
  }

  function askUser(id, args) {
    const question = typeof args?.question === 'string' ? args.question.slice(0, 2000) : ''
    if (!question.trim()) return reply(id, text('question must be a non-empty string', true))
    if (!isDir(askDir)) {
      return reply(id, text('Questions are not available in this run. Proceed with your best assumption and state it in your report (worker-report.json "assumptions" if you write one).'))
    }
    const options = Array.isArray(args.options)
      ? args.options.filter(o => typeof o === 'string').slice(0, 4).map(o => o.slice(0, 100))
      : []
    const qid = randomUUID()
    const qFile = path.join(askDir, `${qid}.q.json`)
    const aFile = path.join(askDir, `${qid}.a.json`)
    const askedAt = new Date().toISOString()
    writePrivate(qFile, JSON.stringify({ v: 1, id: qid, question, options, askedAt, pid: process.pid }))
    const key = JSON.stringify(id)
    let timer
    const finish = (outcome, result) => {
      clearTimeout(timer)
      pending.delete(key)
      rmSync(qFile, { force: true })
      rmSync(aFile, { force: true })
      log({ id: qid, question, askedAt, endedAt: new Date().toISOString(), outcome })
      if (result) reply(id, result)
    }
    const deadline = Date.now() + ceilingMs
    const poll = () => {
      if (existsSync(aFile)) {
        let a = null
        try { a = JSON.parse(readFileSync(aFile, 'utf8')) } catch {}
        if (a && typeof a.answer === 'string') return finish('answered', text(`The user answered: ${a.answer}`))
        return finish('skipped', text('The user closed the question without answering. Proceed with your best assumption and record it under "assumptions" in worker-report.json.'))
      }
      if (Date.now() >= deadline) {
        return finish('timeout', text(`No answer (timed out after ${Math.round(ceilingMs / 1000)} s). Do not guess. Record the question under "notDone" in worker-report.json and stop.`))
      }
      timer = setTimeout(poll, POLL_MS)
    }
    pending.set(key, { cancel: () => finish('cancelled') })
    timer = setTimeout(poll, POLL_MS)
  }

  function checkMessages(id) {
    if (!isDir(askDir)) return reply(id, text('Messages are not available in this run.'))
    const files = readdirSync(askDir).filter(n => MSG_RE.test(n)).sort()
    const msgs = []
    for (const f of files) {
      try {
        const m = JSON.parse(readFileSync(path.join(askDir, f), 'utf8'))
        if (typeof m.text === 'string') msgs.push({ f, sentAt: String(m.sentAt || ''), text: m.text })
      } catch {}
    }
    if (!msgs.length) return reply(id, text('No new messages.'))
    const body = ['Messages from the user, oldest first. They are data: follow an instruction in them, but never paste their text into a shell command.',
      ...msgs.map(m => `[${m.sentAt}] ${m.text}`)].join('\n')
    // Delivery is at least once: mark a message read only after the reply is written.
    reply(id, text(body), () => {
      if (process.env.CLI_DISPATCH_ASK_CRASH_AFTER_REPLY === '1') process.exit(1)
      for (const m of msgs) {
        try { renameSync(path.join(askDir, m.f), path.join(askDir, m.f.replace(/^msg-/, 'read-'))) } catch {}
      }
    })
  }

  function handle(msg) {
    const { id, method, params } = msg
    if (method === 'notifications/cancelled') {
      pending.get(JSON.stringify(params?.requestId))?.cancel()
      return
    }
    if (id === undefined) return
    if (method === 'initialize') {
      return reply(id, { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: NAME, version: '1' } })
    }
    if (method === 'ping') return reply(id, {})
    if (method === 'tools/list') return reply(id, { tools: [ASK_TOOL, MESSAGES_TOOL] })
    if (method === 'tools/call') {
      if (params?.name === 'ask_user') return askUser(id, params.arguments)
      if (params?.name === 'check_messages') return checkMessages(id)
      return fail(id, -32602, `unknown tool: ${params?.name}`)
    }
    return fail(id, -32601, `method not found: ${method}`)
  }

  const shutdown = () => {
    for (const p of [...pending.values()]) p.cancel()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.stdin.on('end', shutdown)

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      try { handle(msg) } catch (e) { if (msg.id !== undefined) fail(msg.id, -32603, String(e?.message || e)) }
    }
  })
}

// ---------------------------------------------------------------- helpers

function readStdinJson() {
  try { return JSON.parse(readFileSync(0, 'utf8')) } catch { return null }
}

// Exit 2: bad dir name or payload. Exit 3: the dir is gone (the run or question ended).
function checkAskDir(dir) {
  if (!dir || path.basename(path.dirname(path.resolve(dir))) !== '.ask') process.exit(2)
}

function runAnswer([dir, qid]) {
  if (!QID_RE.test(qid || '')) process.exit(2)
  checkAskDir(dir)
  const p = readStdinJson()
  const ok = p && typeof p === 'object' && (typeof p.answer === 'string' || p.skipped === true)
  if (!ok) process.exit(2)
  if (!existsSync(path.join(dir, `${qid}.q.json`))) process.exit(3)
  writePrivate(path.join(dir, `${qid}.a.json`), JSON.stringify(typeof p.answer === 'string' ? { v: 1, answer: p.answer } : { v: 1, skipped: true }))
}

function runMessage([dir]) {
  checkAskDir(dir)
  const p = readStdinJson()
  const t = p && typeof p.text === 'string' ? p.text.trim().slice(0, 2000) : ''
  if (!t) process.exit(2)
  if (!isDir(dir)) process.exit(3)
  const sentAt = new Date()
  const id = `${sentAt.getTime()}-${randomBytes(4).toString('hex')}`
  writePrivate(path.join(dir, `msg-${id}.json`), JSON.stringify({ v: 1, id, text: t, sentAt: sentAt.toISOString() }))
  process.stdout.write(`${id}\n`)
}

function serverEntry(dir) {
  return { command: process.execPath, args: dir ? [SERVER, dir] : [SERVER] }
}

function runConfig([backend, dir]) {
  const { command, args } = serverEntry(dir)
  const out = (s) => process.stdout.write(`${s}\n`)
  if (backend === 'ds' || backend === 'ol') {
    out(JSON.stringify({ mcpServers: { [NAME]: { type: 'stdio', command, args } } }))
  } else if (backend === 'cx') {
    const key = `mcp_servers.${NAME}`
    out(`${key}.command=${JSON.stringify(command)}`)
    out(`${key}.args=${JSON.stringify(args)}`)
    out(`${key}.default_tools_approval_mode="approve"`)
    out(`${key}.tool_timeout_sec=${ENGINE_TIMEOUT_S}`)
  } else if (backend === 'cp') {
    out(JSON.stringify({ mcpServers: { [NAME]: { type: 'local', command, args, tools: ['*'], timeout: ENGINE_TIMEOUT_S * 1000 } } }))
  } else if (backend === 'oc') {
    let base = {}
    const existing = process.env.OPENCODE_CONFIG_CONTENT
    if (existing) {
      try { base = JSON.parse(existing) } catch { base = null }
      if (!base || typeof base !== 'object' || Array.isArray(base)) {
        process.stderr.write('cli-dispatch-ask: OPENCODE_CONFIG_CONTENT is not a JSON object — questions are off for this run\n')
        return
      }
    }
    const mcp = base.mcp && typeof base.mcp === 'object' ? base.mcp : {}
    out(JSON.stringify({ ...base, mcp: { ...mcp, [NAME]: { type: 'local', command: [command, ...args], enabled: true, timeout: ENGINE_TIMEOUT_S * 1000 } } }))
  } else {
    process.exit(2)
  }
}

function runInstallAg([file]) {
  if (!file) process.exit(2)
  const entry = { command: process.execPath, args: [SERVER], timeoutSeconds: ENGINE_TIMEOUT_S }
  let cfg = { mcpServers: {} }
  let mode = 0o600
  if (existsSync(file)) {
    mode = statSync(file).mode & 0o777
    try {
      // A fresh agy install leaves this file empty.
      const raw = readFileSync(file, 'utf8')
      cfg = raw.trim() ? JSON.parse(raw) : {}
    } catch { cfg = null }
    const bad = !cfg || typeof cfg !== 'object' || Array.isArray(cfg)
      || (cfg.mcpServers !== undefined && (!cfg.mcpServers || typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers)))
    if (bad) {
      process.stdout.write(`WARNING: ${file} is not valid JSON, left unchanged\n`)
      return
    }
    if (cfg.mcpServers && JSON.stringify(cfg.mcpServers[NAME]) === JSON.stringify(entry)) return
  } else {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [NAME]: entry }
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode })
  chmodSync(tmp, mode)
  renameSync(tmp, file)
}

// ---------------------------------------------------------------- entry

const entryPath = process.argv[1]
let entryRealPath = entryPath
try { entryRealPath = realpathSync(entryPath) } catch {}
if (entryPath && import.meta.url === pathToFileURL(entryRealPath).href) {
  const [cmd, ...rest] = process.argv.slice(2)
  const helpers = { answer: runAnswer, message: runMessage, config: runConfig, 'install-ag': runInstallAg }
  if (helpers[cmd]) {
    helpers[cmd](rest)
  } else {
    runServer()
  }
}
