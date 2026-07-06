import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAuthFailure } from '../parse-utils.mjs'

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
