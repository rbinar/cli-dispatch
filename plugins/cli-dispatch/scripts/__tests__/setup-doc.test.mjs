// /cli-dispatch:setup is a prompt, not code, so its end-to-end defects were prompt defects. Each
// assertion pins one found in a clean-container run of the real flow (5.2.0).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SETUP = process.env.SETUP_MD || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'commands', 'setup.md')
const md = readFileSync(SETUP, 'utf8')
const step = (n) => md.slice(md.indexOf(`\n${n}. **`), md.indexOf(`\n${n + 1}. **`) === -1 ? undefined : md.indexOf(`\n${n + 1}. **`))

test('the backend question fits AskUserQuestion: two questions, at most 4 options each, with a way to pick none', () => {
  // One question with five options was rejected (max 4), and the retry made the user type "none".
  const s = step(2)
  assert.match(s, /TWO\s+multiSelect questions/)
  assert.match(s, /at most 4 options/)
  assert.equal((s.match(/\*\*None of these\*\*/g) || []).length, 2)
})

test('setup never sends the form where the user browser cannot reach it', () => {
  assert.match(step(5), /Docker container/)
})

test('the static CLAUDE.md block routes to the runner agent and no longer bans a babysitter', () => {
  assert.match(md, /subagent_type: "cli-dispatch:runner"/)
  assert.doesNotMatch(md, /Never spawn an LLM subagent to\s+babysit a worker/)
})

test('the closing summary points at the runner agent and grounds "action needed" in installer output', () => {
  const s = step(8)
  assert.match(s, /cli-dispatch:runner/)
  assert.match(s, /never on a guess/)
})
