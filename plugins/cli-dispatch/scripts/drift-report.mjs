#!/usr/bin/env node
// drift-report.mjs — read-only delegation drift report.
//
// Measures the gap between "the policy reached Claude Code" and "Claude Code
// actually used the deterministic runner". It is intentionally cheap: transcript
// files outside the window are filtered by mtime before their contents are read,
// and in-window files are scanned as text rather than parsed line-by-line.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const POLICY_NEEDLE = 'spends ZERO LLM babysitter tokens'
const DAY_MS = 24 * 60 * 60 * 1000
const DRIFT_AGENT_THRESHOLD = 3
const DRIFT_RATIO_THRESHOLD = 3

export function nowMs() {
  const pinned = Number(process.env.CLI_DISPATCH_DRIFT_NOW)
  return Number.isFinite(pinned) ? pinned : Date.now()
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { days: 7, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--days') {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n > 0) out.days = n
    }
  }
  return out
}

export function resolveSessionsRoot() {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  let root = process.env.CLI_DISPATCH_SESSIONS_DIR || ''
  if (!root) {
    root = path.join(cacheRoot, 'cli-dispatch/sessions')
    if (!fs.existsSync(root) && fs.existsSync(path.join(cacheRoot, 'claude-ds/sessions'))) {
      root = path.join(cacheRoot, 'claude-ds/sessions')
    }
  }
  return root
}

export function resolveProjectsRoot() {
  return process.env.CLI_DISPATCH_DRIFT_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

function existsFile(file) {
  try { return fs.statSync(file).isFile() } catch { return false }
}

function inWindowMs(t, startMs, endMs) {
  return Number.isFinite(t) && t >= startMs && t <= endMs
}

function countMatches(text, re) {
  let n = 0
  re.lastIndex = 0
  while (re.exec(text)) n++
  return n
}

function countRunnerBashToolUses(text) {
  let n = 0
  const typeRe = /"type"\s*:\s*"tool_use"/g
  const starts = []
  let m
  while ((m = typeRe.exec(text))) starts.push(m.index)
  if (!starts.length) {
    const bashRe = /"name"\s*:\s*"Bash"/g
    while ((m = bashRe.exec(text))) {
      const segment = text.slice(m.index, Math.min(text.length, m.index + 20000))
      if (segment.includes('cli-dispatch-run') || segment.includes('/cli-dispatch:run')) n++
    }
    return n
  }
  starts.push(text.length)
  for (let i = 0; i < starts.length - 1; i++) {
    const segment = text.slice(starts[i], starts[i + 1])
    if (!/"name"\s*:\s*"Bash"/.test(segment)) continue
    if (segment.includes('cli-dispatch-run') || segment.includes('/cli-dispatch:run')) n++
  }
  return n
}

export function analyzeTranscriptText(text) {
  return {
    policyInjected: text.includes(POLICY_NEEDLE),
    agentSpawns: countMatches(text, /"name"\s*:\s*"Agent"/g),
    inlineEdits: countMatches(text, /"name"\s*:\s*"(?:Edit|Write)"/g),
    runnerInvocations: countRunnerBashToolUses(text),
  }
}

function projectNameFor(projectsRoot, file) {
  const rel = path.relative(projectsRoot, file)
  if (!rel || rel.startsWith('..')) return path.basename(path.dirname(file)) || '.'
  const first = rel.split(path.sep).filter(Boolean)[0]
  return first || '.'
}

function listJsonlFiles(root) {
  const files = []
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(p)
    }
  }
  walk(root)
  return files
}

export function isDrifting({ policyInjectedSessions, agentSpawns, runnerInvocations }) {
  const driftRatio = agentSpawns / Math.max(1, runnerInvocations)
  // Drift means the policy was present and Anthropic Agent routing dominated the
  // deterministic path. Require at least three Agent spawns and a 3:1 ratio:
  // one accidental Agent call is not drift, while 3 Agent spawns vs 1 runner is
  // already enough evidence that the policy failed to shape behaviour.
  return policyInjectedSessions > 0 &&
    agentSpawns >= DRIFT_AGENT_THRESHOLD &&
    driftRatio >= DRIFT_RATIO_THRESHOLD
}

export function buildReport({ days = 7, sessionsRoot = resolveSessionsRoot(), projectsRoot = resolveProjectsRoot(), now = nowMs() } = {}) {
  const startMs = now - days * DAY_MS
  const report = {
    windowDays: days,
    runnerRuns: 0,
    rawWorkerRuns: 0,
    policyInjectedSessions: 0,
    agentSpawns: 0,
    inlineEdits: 0,
    runnerInvocations: 0,
    driftRatio: 0,
    drifting: false,
    projects: [],
  }

  let sessionEntries
  try { sessionEntries = fs.readdirSync(sessionsRoot, { withFileTypes: true }) } catch { sessionEntries = [] }
  for (const entry of sessionEntries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(sessionsRoot, entry.name)
    const meta = readJson(path.join(dir, 'meta.json'))
    const status = readJson(path.join(dir, 'status.json'))
    const startedRaw = meta.startedAt || status.startedAt
    const startedMs = typeof startedRaw === 'string' ? Date.parse(startedRaw) : Number(startedRaw)
    if (!inWindowMs(startedMs, startMs, now)) continue
    // verdict.json is a positive-only signal: a run killed before the terminal
    // verdict write leaves no verdict file, so absence must not be read as
    // "definitely did not launch through the runner" outside this coarse report.
    if (existsFile(path.join(dir, 'verdict.json'))) report.runnerRuns++
    else report.rawWorkerRuns++
  }

  const byProject = new Map()
  for (const file of listJsonlFiles(projectsRoot)) {
    let st
    try { st = fs.statSync(file) } catch { continue }
    if (!inWindowMs(st.mtimeMs, startMs, now)) continue
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    const a = analyzeTranscriptText(text)
    const project = projectNameFor(projectsRoot, file)
    const row = byProject.get(project) || {
      project,
      policyInjectedSessions: 0,
      agentSpawns: 0,
      inlineEdits: 0,
      runnerInvocations: 0,
    }
    if (a.policyInjected) {
      row.policyInjectedSessions++
      report.policyInjectedSessions++
    }
    row.agentSpawns += a.agentSpawns
    row.inlineEdits += a.inlineEdits
    row.runnerInvocations += a.runnerInvocations
    report.agentSpawns += a.agentSpawns
    report.inlineEdits += a.inlineEdits
    report.runnerInvocations += a.runnerInvocations
    byProject.set(project, row)
  }

  report.driftRatio = report.agentSpawns / Math.max(1, report.runnerInvocations)
  report.drifting = isDrifting(report)
  report.projects = [...byProject.values()]
    .sort((a, b) => {
      const ar = a.agentSpawns / Math.max(1, a.runnerInvocations)
      const br = b.agentSpawns / Math.max(1, b.runnerInvocations)
      return br - ar || b.agentSpawns - a.agentSpawns || a.project.localeCompare(b.project)
    })
  return report
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function formatHuman(report) {
  const lines = []
  lines.push(`cli-dispatch drift (${report.windowDays}d)`)
  lines.push(`workers: ${fmt(report.runnerRuns)} runner run(s), ${fmt(report.rawWorkerRuns)} raw worker run(s)`)
  lines.push(`transcripts: ${fmt(report.policyInjectedSessions)} policy-injected session(s), ${fmt(report.agentSpawns)} Agent spawn(s), ${fmt(report.inlineEdits)} inline edit/write(s), ${fmt(report.runnerInvocations)} runner invocation(s)`)
  lines.push(`drift ratio: ${fmt(report.driftRatio)} Agent spawns per runner invocation`)
  lines.push(`drifting: ${report.drifting ? 'yes' : 'no'}`)
  if (report.drifting) {
    lines.push('')
    lines.push('Fix: route delegable work through:')
    lines.push('/cli-dispatch:run <backend> "<task>" --verify \'<cmd>\'')
  }
  // A project with no delegation activity at all says nothing about drift — listing it
  // under "worst projects" just pads the report (a fresh install shows exactly one such
  // row and it reads like a finding). The JSON keeps every row; only the human view trims.
  const active = report.projects.filter(
    (p) => p.agentSpawns || p.inlineEdits || p.runnerInvocations
  )
  if (active.length) {
    lines.push('')
    lines.push('worst projects:')
    for (const p of active.slice(0, 8)) {
      lines.push(`  ${p.project}: Agent ${fmt(p.agentSpawns)} · Edit/Write ${fmt(p.inlineEdits)} · runner ${fmt(p.runnerInvocations)}`)
    }
  }
  return lines.slice(0, 40).join('\n')
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const report = buildReport({ days: args.days })
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(formatHuman(report) + '\n')
}

const entryPath = process.argv[1]
let entryRealPath = entryPath
try { entryRealPath = fs.realpathSync(entryPath) } catch {}
if (entryPath && import.meta.url === pathToFileURL(entryRealPath).href) {
  try {
    runCli()
  } catch (err) {
    console.error(`drift-report: ${err.message}`)
    process.exit(0)
  }
}
