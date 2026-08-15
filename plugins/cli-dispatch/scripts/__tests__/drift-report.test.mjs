import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { analyzeTranscriptText, isDrifting } from '../drift-report.mjs'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const DRIFT_REPORT_PATH = path.resolve(SELF_DIR, '..', 'drift-report.mjs')
const NOW = Date.parse('2026-08-15T12:00:00.000Z')

function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-drift-'))
  try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj))
}

function writeSession(root, name, startedAt, { verdict = false, badStatus = false } = {}) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  writeJson(path.join(dir, 'meta.json'), { startedAt })
  if (badStatus) fs.writeFileSync(path.join(dir, 'status.json'), '{ not json')
  else writeJson(path.join(dir, 'status.json'), { startedAt })
  if (verdict) fs.writeFileSync(path.join(dir, 'verdict.json'), '{}')
}

function toolUse(name, extra = '') {
  return `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"${name}"${extra}}]}}`
}

function bash(command) {
  return toolUse('Bash', `,"input":{"command":${JSON.stringify(command)}}`)
}

function writeTranscript(root, project, name, text, mtimeMs = NOW) {
  const file = path.join(root, project, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs))
  return file
}

function runJson(sessionsRoot, projectsRoot, extraArgs = []) {
  const out = execFileSync(process.execPath, [DRIFT_REPORT_PATH, ...extraArgs, '--json'], {
    env: {
      ...process.env,
      CLI_DISPATCH_SESSIONS_DIR: sessionsRoot,
      CLI_DISPATCH_DRIFT_PROJECTS_DIR: projectsRoot,
      CLI_DISPATCH_DRIFT_NOW: String(NOW),
    },
    encoding: 'utf8',
  })
  return { out, parsed: JSON.parse(out) }
}

test('window filter, verdict split, counters, project sorting, and pure JSON output', () => withFixture((dir) => {
  const sessions = path.join(dir, 'sessions')
  const projects = path.join(dir, 'projects')
  writeSession(sessions, 'runner-in-window', '2026-08-15T11:00:00.000Z', { verdict: true })
  writeSession(sessions, 'raw-in-window', '2026-08-15T10:00:00.000Z')
  writeSession(sessions, 'old-runner', '2026-08-01T00:00:00.000Z', { verdict: true })

  const injected = 'spends ZERO LLM babysitter tokens'
  writeTranscript(projects, 'project-b', 'session.jsonl', [
    injected,
    toolUse('Agent'),
    toolUse('Agent'),
    toolUse('Agent'),
    toolUse('Edit'),
    toolUse('Write'),
    bash('cli-dispatch-run ds "task" --verify "true"'),
  ].join('\n'))
  writeTranscript(projects, 'project-a', 'session.jsonl', [
    toolUse('Agent'),
    toolUse('Edit'),
    bash('/cli-dispatch:run cx "task" --verify "true"'),
    bash('echo no runner here'),
  ].join('\n'))
  writeTranscript(projects, 'old-project', 'old.jsonl', [
    injected,
    toolUse('Agent'),
    bash('cli-dispatch-run ds x'),
  ].join('\n'), NOW - 10 * 24 * 60 * 60 * 1000)

  const { out, parsed } = runJson(sessions, projects)
  assert.equal(out.trimStart().startsWith('{'), true, '--json stdout must be JSON only')
  assert.equal(parsed.windowDays, 7)
  assert.equal(parsed.runnerRuns, 1)
  assert.equal(parsed.rawWorkerRuns, 1)
  assert.equal(parsed.policyInjectedSessions, 1)
  assert.equal(parsed.agentSpawns, 4)
  assert.equal(parsed.inlineEdits, 3)
  assert.equal(parsed.runnerInvocations, 2)
  assert.equal(parsed.driftRatio, 2)
  assert.equal(parsed.drifting, false)
  assert.deepEqual(parsed.projects.map((p) => p.project), ['project-b', 'project-a'])
}))

test('days flag applies to both session startedAt and transcript mtime', () => withFixture((dir) => {
  const sessions = path.join(dir, 'sessions')
  const projects = path.join(dir, 'projects')
  writeSession(sessions, 'two-days-old', '2026-08-13T12:00:00.000Z', { verdict: true })
  writeSession(sessions, 'recent', '2026-08-15T11:00:00.000Z')
  writeTranscript(projects, 'p', 'old.jsonl', toolUse('Agent'), NOW - 2 * 24 * 60 * 60 * 1000)
  writeTranscript(projects, 'p', 'recent.jsonl', toolUse('Write'), NOW)

  const { parsed } = runJson(sessions, projects, ['--days', '1'])
  assert.equal(parsed.runnerRuns, 0)
  assert.equal(parsed.rawWorkerRuns, 1)
  assert.equal(parsed.agentSpawns, 0)
  assert.equal(parsed.inlineEdits, 1)
}))

test('drifting threshold is true for 3 Agent spawns plus 1 runner when policy is injected', () => {
  assert.equal(isDrifting({ policyInjectedSessions: 1, agentSpawns: 3, runnerInvocations: 1 }), true)
})

test('drifting threshold is false for 2 runners plus 0 Agent spawns and for empty data', () => {
  assert.equal(isDrifting({ policyInjectedSessions: 1, agentSpawns: 0, runnerInvocations: 2 }), false)
  assert.equal(isDrifting({ policyInjectedSessions: 0, agentSpawns: 0, runnerInvocations: 0 }), false)
})

test('empty roots do not throw and exit as an empty report', () => withFixture((dir) => {
  const { parsed } = runJson(path.join(dir, 'missing-sessions'), path.join(dir, 'missing-projects'))
  assert.deepEqual(parsed, {
    windowDays: 7,
    runnerRuns: 0,
    rawWorkerRuns: 0,
    policyInjectedSessions: 0,
    agentSpawns: 0,
    inlineEdits: 0,
    runnerInvocations: 0,
    driftRatio: 0,
    drifting: false,
    projects: [],
  })
}))

test('broken input is skipped without crashing', () => withFixture((dir) => {
  const sessions = path.join(dir, 'sessions')
  const projects = path.join(dir, 'projects')
  fs.mkdirSync(path.join(sessions, 'broken'), { recursive: true })
  fs.writeFileSync(path.join(sessions, 'broken', 'meta.json'), '{ partial')
  fs.writeFileSync(path.join(sessions, 'broken', 'status.json'), '{ also partial')
  writeTranscript(projects, 'p', 'bad.jsonl', toolUse('Agent'))
  const { parsed } = runJson(sessions, projects)
  assert.equal(parsed.runnerRuns, 0)
  assert.equal(parsed.rawWorkerRuns, 0)
  assert.equal(parsed.agentSpawns, 1)
}))

test('transcript text analyzer counts names without JSON parsing', () => {
  const text = [
    'spends ZERO LLM babysitter tokens',
    toolUse('Agent'),
    toolUse('Edit'),
    toolUse('Write'),
    bash('cli-dispatch-run ds "x"'),
    bash('/cli-dispatch:run cx "x"'),
    '{"type":"tool_use","name":"Bash","input":{"command":"echo cli-dispatch-run mentioned outside runner? no"}}',
  ].join('\n')
  assert.deepEqual(analyzeTranscriptText(text), {
    policyInjected: true,
    agentSpawns: 1,
    inlineEdits: 2,
    runnerInvocations: 3,
  })
})
