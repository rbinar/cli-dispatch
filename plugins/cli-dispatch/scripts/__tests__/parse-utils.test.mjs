import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAuthFailure,
  extractUserRequest,
  conversationMatchesPrompt,
  firstUserInputContent,
  isTrivialDiffstat,
  selectOwnedConversation,
} from '../parse-utils.mjs'

test('isTrivialDiffstat: applies the shared changed-line rule', () => {
  assert.equal(isTrivialDiffstat(' 2 files changed, 10 insertions(+), 3 deletions(-)'), true)
  assert.equal(isTrivialDiffstat(' 9 files changed, 60 insertions(+), 4 deletions(-)'), false)
  assert.equal(isTrivialDiffstat(' 1 file changed, 12 insertions(+)'), true)
  assert.equal(isTrivialDiffstat(' 1 file changed, 12 deletions(-)'), true)
  assert.equal(isTrivialDiffstat(''), false)
  assert.equal(isTrivialDiffstat(undefined), false)
  assert.equal(isTrivialDiffstat(' 0 files changed, 0 insertions(+), 0 deletions(-)'), false)
})

// ---- E7: Antigravity conversation-ownership matching ----

// A real agy first USER_INPUT line shape (verified against transcript_full.jsonl).
const userLine = (prompt) => JSON.stringify({
  step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
  created_at: '2026-07-11T19:51:32Z',
  content: `<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-07-11T22:51:32+03:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to Gemini 3.5 Flash (High).\n</USER_SETTINGS_CHANGE>`,
})

test('extractUserRequest: pulls the wrapped prompt, ignoring metadata/settings suffix', () => {
  const content = `<USER_REQUEST>\nDo the thing\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nx\n</ADDITIONAL_METADATA>`
  assert.equal(extractUserRequest(content).trim(), 'Do the thing')
})

test('extractUserRequest: null when no wrapper / non-string', () => {
  assert.equal(extractUserRequest('no wrapper here'), null)
  assert.equal(extractUserRequest(null), null)
  assert.equal(extractUserRequest(123), null)
})

test('conversationMatchesPrompt: exact match on the wrapped block', () => {
  const content = `<USER_REQUEST>\nTask A: fix bug\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nx\n</ADDITIONAL_METADATA>`
  assert.equal(conversationMatchesPrompt(content, 'Task A: fix bug'), true)
  assert.equal(conversationMatchesPrompt(content, '  Task A: fix bug  '), true) // trimmed
})

test('conversationMatchesPrompt: a sibling whose prompt merely CONTAINS ours does NOT match', () => {
  // Race guard: our prompt "fix bug" must NOT match a sibling conversation whose own prompt
  // is "fix bug in module X" (would be a false-positive under a naive substring check).
  const siblingContent = `<USER_REQUEST>\nfix bug in module X\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nx\n</ADDITIONAL_METADATA>`
  assert.equal(conversationMatchesPrompt(siblingContent, 'fix bug'), false)
})

test('conversationMatchesPrompt: falls back to containment when no wrapper', () => {
  assert.equal(conversationMatchesPrompt('raw prompt text here', 'prompt text'), true)
  assert.equal(conversationMatchesPrompt('raw prompt text here', 'absent'), false)
})

test('conversationMatchesPrompt: empty prompt never matches', () => {
  assert.equal(conversationMatchesPrompt('<USER_REQUEST>\n\n</USER_REQUEST>', '   '), false)
})

test('firstUserInputContent: returns first USER_INPUT content, skipping other events', () => {
  const transcript = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'hello' }),
    JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'ignored' }),
  ].join('\n')
  assert.equal(firstUserInputContent(transcript), 'hello')
})

test('firstUserInputContent: null when file empty / not-yet-written / junk lines', () => {
  assert.equal(firstUserInputContent(''), null)
  assert.equal(firstUserInputContent(null), null)
  assert.equal(firstUserInputContent('{ not json\n'), null)
  assert.equal(firstUserInputContent(JSON.stringify({ type: 'CONVERSATION_HISTORY' })), null)
})

test('selectOwnedConversation: picks the candidate whose first user message is OUR prompt', () => {
  const candidates = [
    { cid: 'sibling', transcriptText: userLine('Task B: write docs') },
    { cid: 'mine', transcriptText: userLine('Task A: fix bug') },
  ]
  assert.equal(selectOwnedConversation('Task A: fix bug', candidates), 'mine')
})

test('selectOwnedConversation: returns "" when no candidate matches (all siblings)', () => {
  const candidates = [
    { cid: 'sibA', transcriptText: userLine('Task B') },
    { cid: 'sibB', transcriptText: userLine('Task C') },
  ]
  assert.equal(selectOwnedConversation('Task A', candidates), '')
})

test('selectOwnedConversation: skips not-yet-readable candidates (null transcript)', () => {
  const candidates = [
    { cid: 'pending', transcriptText: null },
    { cid: 'mine', transcriptText: userLine('Task A') },
  ]
  assert.equal(selectOwnedConversation('Task A', candidates), 'mine')
  // When ONLY the unreadable candidate exists, no match yet -> "" (caller keeps polling).
  assert.equal(selectOwnedConversation('Task A', [{ cid: 'pending', transcriptText: null }]), '')
})

test('selectOwnedConversation: tolerates bad input', () => {
  assert.equal(selectOwnedConversation('x', null), '')
  assert.equal(selectOwnedConversation('x', [null, { cid: '' }]), '')
})

test('classifyAuthFailure: exitCode=0, any output -> isAuthFailure=false', () => {
  const result = classifyAuthFailure(0, 'You are not logged into Antigravity.')
  assert.deepEqual(result, { isAuthFailure: false })
})

test('classifyAuthFailure: exitCode=1, output containing "Error: authentication failed or timed out" -> true', () => {
  const result = classifyAuthFailure(1, 'Error: authentication failed or timed out')
  assert.deepEqual(result, { isAuthFailure: true })
})

test('classifyAuthFailure: exitCode=1, output containing "You are not logged into Antigravity." -> true', () => {
  const result = classifyAuthFailure(1, 'Error: You are not logged into Antigravity. Please log in.')
  assert.deepEqual(result, { isAuthFailure: true })
})

test('classifyAuthFailure: exitCode=1, output containing "error getting token source" -> true', () => {
  const result = classifyAuthFailure(1, 'Some startup noise: error getting token source: You are not logged into Antigravity.')
  assert.deepEqual(result, { isAuthFailure: true })
})

test('classifyAuthFailure: exitCode=1, unrelated output -> false', () => {
  const result1 = classifyAuthFailure(1, 'network timeout')
  assert.deepEqual(result1, { isAuthFailure: false })

  const result2 = classifyAuthFailure(1, '')
  assert.deepEqual(result2, { isAuthFailure: false })
})
