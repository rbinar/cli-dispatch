import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  isStatusPollCommand,
  backendFromCommand,
  analyzeAgentEvents,
  computeBabysitRatio,
  RUNNER_RE,
  PINNED_RUNNER_MODEL_RE,
} from '../gain-report.mjs'

// --- Fix 1 helper: real polling signal (status.json direct read, NOT cli-dispatch-wait) ---
test('isStatusPollCommand: direct status.json read counts', () => {
  assert.equal(isStatusPollCommand('cat ~/.cache/cli-dispatch/sessions/x/status.json'), true)
  assert.equal(isStatusPollCommand('node -e "read status.json"'), true)
})
test('isStatusPollCommand: cli-dispatch-wait is not a poll even if it names status.json', () => {
  assert.equal(isStatusPollCommand('cli-dispatch-wait abc --timeout 600'), false)
  assert.equal(isStatusPollCommand('cli-dispatch-wait abc; cat status.json'), false)
})
test('isStatusPollCommand: unrelated commands are not polls', () => {
  assert.equal(isStatusPollCommand('echo hi'), false)
  assert.equal(isStatusPollCommand(''), false)
  assert.equal(isStatusPollCommand(undefined), false)
})

// --- backend detection from wrapper-CLI command ---
test('backendFromCommand maps each wrapper to its backend', () => {
  assert.equal(backendFromCommand('ds-agent --prompt x'), 'deepseek')
  assert.equal(backendFromCommand('claude-ds-stream'), 'deepseek')
  assert.equal(backendFromCommand('ag-stream y'), 'antigravity')
  assert.equal(backendFromCommand('cx-agent'), 'codex')
  assert.equal(backendFromCommand('oc-stream'), 'opencode')
  assert.equal(backendFromCommand('cp-agent z'), 'copilot')
  assert.equal(backendFromCommand('foo status.json'), null)
})

// --- analyzeAgentEvents: data collection (Fix 1 counting + backend + runner detect) ---
test('analyzeAgentEvents: detects runner, backend, status polls, turns, model usage', () => {
  const objs = [
    {type:'assistant.message', message:{role:'assistant', content:[
      {type:'tool_use', name:'Bash', input:{command:'ds-agent --prompt "do x"'}},
    ]}},
    {message:{role:'assistant', content:[
      {type:'tool_use', name:'Bash', input:{command:'cat ~/.cache/cli-dispatch/sessions/s1/status.json'}},
    ], usage:{output_tokens:10, input_tokens:3, cache_read_input_tokens:99}, model:'claude-haiku-4-5-20251001'}},
    {message:{role:'assistant', content:[
      {type:'tool_use', name:'Bash', input:{command:'cli-dispatch-wait s1 --timeout 600'}},
    ]}},
    {message:{role:'assistant', content:[
      {type:'tool_use', name:'Bash', input:{command:'cat ./status.json'}},
    ]}},
  ]
  const r = analyzeAgentEvents(objs)
  assert.equal(r.isRunner, true)
  assert.equal(r.backend, 'deepseek')
  assert.equal(r.statusPolls, 2)          // two cat status.json; cli-dispatch-wait excluded
  assert.equal(r.assistantTurns, 4)
  assert.equal(r.models.get('claude-haiku-4-5-20251001').output, 10)
})
test('analyzeAgentEvents: non-runner file yields isRunner=false, null backend', () => {
  const r = analyzeAgentEvents([
    {message:{role:'assistant', content:[{type:'tool_use', name:'Bash', input:{command:'echo hi'}}]}},
  ])
  assert.equal(r.isRunner, false)
  assert.equal(r.backend, null)
  assert.equal(r.statusPolls, 0)
})
test('analyzeAgentEvents: tolerates empty/garbage input', () => {
  const r = analyzeAgentEvents(null)
  assert.equal(r.isRunner, false)
  assert.equal(r.assistantTurns, 0)
})

// --- computeBabysitRatio: Fix 2 (haiku-only numerator) + Fix 3 (drop blind backends) + Fix 1 (heavy pollers) ---
const M = (model, output) => new Map([[model, {input:0, output, cacheW:0, cacheR:0}]])

test('Fix 2: numerator counts pinned (haiku) runner output only; non-pinned excluded', () => {
  const runnerRecords = [
    {backend:'deepseek', models:M('claude-haiku-4-5-20251001', 100), statusPolls:0},
    {backend:'deepseek', models:M('claude-sonnet-5', 500), statusPolls:0},
  ]
  const r = computeBabysitRatio({runnerRecords, workerOutputTotal:100, blindBackends:new Set(), pollThreshold:5})
  assert.equal(r.numeratorOutput, 100)
  assert.equal(r.excludedNonPinnedOutput, 500)
  assert.equal(r.ratioPct, 100)           // 100 / 100 * 100
})

test('Fix 3: blind-backend runner output excluded from numerator regardless of model', () => {
  const runnerRecords = [
    {backend:'codex', models:M('claude-haiku-4-5-20251001', 20), statusPolls:0},
    {backend:'antigravity', models:M('claude-haiku-4-5-20251001', 80), statusPolls:0},
  ]
  const r = computeBabysitRatio({runnerRecords, workerOutputTotal:100, blindBackends:new Set(['antigravity']), pollThreshold:5})
  assert.equal(r.numeratorOutput, 20)     // codex haiku only; antigravity dropped
  assert.equal(r.excludedBlindOutput, 80)
})

test('Fix 1: heavyPollers counts runners with statusPolls above threshold', () => {
  const runnerRecords = [
    {backend:'deepseek', models:M('claude-haiku-4-5-20251001', 10), statusPolls:9},
    {backend:'deepseek', models:M('claude-haiku-4-5-20251001', 10), statusPolls:5},
    {backend:'deepseek', models:M('claude-haiku-4-5-20251001', 10), statusPolls:0},
  ]
  const r = computeBabysitRatio({runnerRecords, workerOutputTotal:100, blindBackends:new Set(), pollThreshold:5})
  assert.equal(r.heavyPollers, 1)         // only statusPolls=9 exceeds 5 (strictly greater)
})

test('computeBabysitRatio: combined numerator across pinned non-blind runners', () => {
  const runnerRecords = [
    {backend:'deepseek', models:M('claude-haiku-4-5-20251001', 100), statusPolls:0},
    {backend:'codex', models:M('claude-haiku-4-5-20251001', 20), statusPolls:9},
    {backend:'deepseek', models:M('claude-sonnet-5', 500), statusPolls:0},
    {backend:'antigravity', models:M('claude-haiku-4-5-20251001', 80), statusPolls:0},
  ]
  const r = computeBabysitRatio({runnerRecords, workerOutputTotal:100, blindBackends:new Set(['antigravity']), pollThreshold:5})
  assert.equal(r.numeratorOutput, 120)    // 100 + 20 pinned & non-blind
  assert.equal(r.excludedNonPinnedOutput, 500)
  assert.equal(r.excludedBlindOutput, 80)
  assert.equal(r.heavyPollers, 1)
  assert.equal(r.ratioPct, 120)
})

test('computeBabysitRatio: null ratio when denominator is zero', () => {
  const r = computeBabysitRatio({runnerRecords:[], workerOutputTotal:0, blindBackends:new Set(), pollThreshold:5})
  assert.equal(r.ratioPct, null)
})

// --- #122 AU4: deterministic runs are counted, and cli-dispatch-run is NOT a babysitter ---

// The retired *-runner subagents were pinned to haiku, which is what identifies a real pre-4.0.0
// babysitter in transcript history. `cli-dispatch-run` must stay OUT of RUNNER_RE: it IS the
// sanctioned path and spends no Anthropic tokens, so matching it would score the fix as the problem.
test('RUNNER_RE matches the retired wrapper CLIs but never cli-dispatch-run', () => {
  for (const cmd of ['ds-agent -p x', 'claude-ds-stream --cwd /tmp', 'ag-stream y', 'cx-agent', 'oc-stream', 'cp-agent']) {
    assert.ok(RUNNER_RE.test(cmd), 'should match a legacy runner invocation: ' + cmd)
  }
  for (const cmd of [
    'cli-dispatch-run ds "task" --verify "npm test"',
    '/cli-dispatch:run cx "task"',
    'cli-dispatch-wait abc',
  ]) {
    assert.equal(RUNNER_RE.test(cmd), false, 'must NOT be scored as a babysitter: ' + cmd)
  }
})

// The gate is deliberately narrow. Widening it to today's path would inflate a ratio whose only
// remaining purpose is historical accounting.
test('PINNED_RUNNER_MODEL_RE identifies the legacy haiku pinning only', () => {
  assert.ok(PINNED_RUNNER_MODEL_RE.test('claude-haiku-4-5-20251001'))
  assert.equal(PINNED_RUNNER_MODEL_RE.test('claude-opus-5'), false)
  assert.equal(PINNED_RUNNER_MODEL_RE.test('claude-sonnet-5'), false)
})
