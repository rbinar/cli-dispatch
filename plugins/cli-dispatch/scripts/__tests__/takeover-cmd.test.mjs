// takeover-cmd.test.mjs — unit tests for plugins/cli-dispatch/scripts/takeover-cmd.mjs
//
// Uses node's built-in test runner (node:test) + node:assert/strict — no new dependency.
// Run with: node --test plugins/cli-dispatch/scripts/__tests__/takeover-cmd.test.mjs
//
// Env-var hygiene: buildTakeoverCommand() reads process.env for API keys/model overrides,
// and internally (once per process, memoized) calls loadConfigDefaults() which may set
// process.env keys from an on-disk config file for any key NOT already present in
// process.env. Every test that touches env vars therefore explicitly sets the ones it
// cares about BEFORE calling buildTakeoverCommand (so loadConfigDefaults can never
// override them — verified by reading its source: it skips any key that
// `Object.prototype.hasOwnProperty.call(process.env, key)`), and restores/deletes them
// in a try/finally so no test leaks env state into another.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTakeoverCommand } from '../takeover-cmd.mjs'

// ---- env helper ----
//
// withEnv(overrides, fn): overrides is { KEY: 'value' | undefined }. undefined means
// "ensure this key is deleted/unset for the duration of fn". Saves prior state and
// restores it exactly (including "was absent") afterwards, even if fn throws.
function withEnv(overrides, fn) {
  const saved = {}
  for (const key of Object.keys(overrides)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return fn()
  } finally {
    for (const key of Object.keys(overrides)) {
      const prior = saved[key]
      if (prior === undefined) delete process.env[key]
      else process.env[key] = prior
    }
  }
}

// =====================================================================================
// 1. Per-backend happy-path shape
// =====================================================================================

test('deepseek: builds expected cmd/args/cwd', () => {
  withEnv(
    { DEEPSEEK_API_KEY: 'k', DS_MODEL: 'm', DS_FLASH_MODEL: 'fm' },
    () => {
      const result = buildTakeoverCommand('deepseek', { sessionId: 'sess-123', cwd: '/tmp/work' })
      assert.equal(result.cmd, 'claude')
      assert.deepEqual(result.args, ['--resume', 'sess-123', '--add-dir', '/tmp/work'])
      assert.equal(result.cwd, '/tmp/work')
    }
  )
})

test('antigravity: builds expected cmd/args/cwd', () => {
  const result = buildTakeoverCommand('antigravity', { convId: 'conv-abc', cwd: '/tmp/work' })
  assert.equal(result.cmd, 'agy')
  assert.deepEqual(result.args, ['--conversation', 'conv-abc'])
  assert.equal(result.cwd, '/tmp/work')
})

test('opencode: builds expected cmd/args/cwd', () => {
  const result = buildTakeoverCommand('opencode', { threadId: 'th-1', cwd: '/tmp/work' })
  assert.equal(result.cmd, 'opencode')
  assert.deepEqual(result.args, ['--session', 'th-1', '--continue'])
  assert.equal(result.cwd, '/tmp/work')
})

test('copilot: builds expected cmd/args/cwd', () => {
  const result = buildTakeoverCommand('copilot', { threadId: 'th-2', cwd: '/tmp/work' })
  assert.equal(result.cmd, 'copilot')
  assert.deepEqual(result.args, ['--resume', 'th-2'])
  assert.equal(result.cwd, '/tmp/work')
})

test('copilot: falls back to --continue when threadId is missing', () => {
  const result = buildTakeoverCommand('copilot', { cwd: '/tmp/work' })
  assert.equal(result.cmd, 'copilot')
  assert.deepEqual(result.args, ['--continue'])
  assert.equal(result.cwd, '/tmp/work')
})

test('copilot: falls back to --continue when threadId is empty string', () => {
  const result = buildTakeoverCommand('copilot', { threadId: '', cwd: '/tmp/work' })
  assert.deepEqual(result.args, ['--continue'])
})

// =====================================================================================
// 2. DeepSeek env completeness (highest-value test)
// =====================================================================================

test('deepseek: env has exactly the 7 required keys with explicit env values', () => {
  withEnv(
    { DEEPSEEK_API_KEY: 'test-ds-key', DS_MODEL: 'test-model', DS_FLASH_MODEL: 'test-flash-model' },
    () => {
      const result = buildTakeoverCommand('deepseek', { sessionId: 'sess-1', cwd: '/tmp' })
      assert.deepEqual(result.env, {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'test-ds-key',
        ANTHROPIC_MODEL: 'test-model',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'test-model',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'test-model',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'test-flash-model',
        CLAUDE_CODE_SUBAGENT_MODEL: 'test-flash-model',
      })
      assert.deepEqual(Object.keys(result.env).sort(), [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_MODEL',
        'CLAUDE_CODE_SUBAGENT_MODEL',
      ])
    }
  )
})

test('deepseek: falls back to deepseek-v4-pro / deepseek-v4-flash when DS_MODEL/DS_FLASH_MODEL unset', () => {
  withEnv(
    { DEEPSEEK_API_KEY: 'some-key', DS_MODEL: undefined, DS_FLASH_MODEL: undefined },
    () => {
      const result = buildTakeoverCommand('deepseek', { sessionId: 'sess-1', cwd: '/tmp' })
      assert.equal(result.env.ANTHROPIC_MODEL, 'deepseek-v4-pro')
      assert.equal(result.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-v4-pro')
      assert.equal(result.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-v4-pro')
      assert.equal(result.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4-flash')
      assert.equal(result.env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4-flash')
    }
  )
})

// =====================================================================================
// 3. Injection-immunity for all 4 new branches
// =====================================================================================

const NASTY_ID = "'; rm -rf /; echo '"
const NASTY_CWD = '$(id) `whoami`'

test('deepseek: injection-shaped sessionId/cwd pass through untouched as inert argv values', () => {
  withEnv({ DEEPSEEK_API_KEY: 'k' }, () => {
    const result = buildTakeoverCommand('deepseek', { sessionId: NASTY_ID, cwd: NASTY_CWD })
    assert.equal(result.args[1], NASTY_ID)
    assert.ok(result.args.includes(NASTY_ID))
    assert.equal(result.cwd, NASTY_CWD)
  })
})

test('antigravity: injection-shaped convId/cwd pass through untouched as inert argv values', () => {
  const result = buildTakeoverCommand('antigravity', { convId: NASTY_ID, cwd: NASTY_CWD })
  assert.equal(result.args[1], NASTY_ID)
  assert.ok(result.args.includes(NASTY_ID))
  assert.equal(result.cwd, NASTY_CWD)
})

test('opencode: injection-shaped threadId/cwd pass through untouched as inert argv values', () => {
  const result = buildTakeoverCommand('opencode', { threadId: NASTY_ID, cwd: NASTY_CWD })
  assert.equal(result.args[1], NASTY_ID)
  assert.ok(result.args.includes(NASTY_ID))
  assert.equal(result.cwd, NASTY_CWD)
})

test('copilot: injection-shaped threadId/cwd pass through untouched as inert argv values', () => {
  const result = buildTakeoverCommand('copilot', { threadId: NASTY_ID, cwd: NASTY_CWD })
  assert.equal(result.args[1], NASTY_ID)
  assert.ok(result.args.includes(NASTY_ID))
  assert.equal(result.cwd, NASTY_CWD)
})

// =====================================================================================
// 4. Missing-required-field rejection
// =====================================================================================

const REQUIRED_FIELD = {
  deepseek: 'sessionId',
  antigravity: 'convId',
  opencode: 'threadId',
}

for (const [backend, idField] of Object.entries(REQUIRED_FIELD)) {
  test(`${backend}: throws when meta.${idField} is missing`, () => {
    const meta = { cwd: '/tmp' }
    assert.throws(
      () => buildTakeoverCommand(backend, meta),
      new RegExp(`buildTakeoverCommand: ${backend} requires meta\\.${idField}`)
    )
  })

  test(`${backend}: throws when meta.${idField} is empty string`, () => {
    const meta = { [idField]: '', cwd: '/tmp' }
    assert.throws(
      () => buildTakeoverCommand(backend, meta),
      new RegExp(`buildTakeoverCommand: ${backend} requires meta\\.${idField}`)
    )
  })

  test(`${backend}: throws when meta.cwd is missing`, () => {
    const meta = { [idField]: 'valid-id' }
    assert.throws(
      () => buildTakeoverCommand(backend, meta),
      new RegExp(`buildTakeoverCommand: ${backend} requires meta\\.cwd`)
    )
  })

  test(`${backend}: throws when meta.cwd is empty string`, () => {
    const meta = { [idField]: 'valid-id', cwd: '' }
    assert.throws(
      () => buildTakeoverCommand(backend, meta),
      new RegExp(`buildTakeoverCommand: ${backend} requires meta\\.cwd`)
    )
  })
}

test('copilot: throws when meta.cwd is missing', () => {
  assert.throws(
    () => buildTakeoverCommand('copilot', { threadId: 'th-x' }),
    /buildTakeoverCommand: copilot requires meta\.cwd/
  )
})

// =====================================================================================
// 4b. deepseek: DEEPSEEK_API_KEY billing-safety guard (dev-security finding SE1)
// =====================================================================================

test('deepseek: throws when DEEPSEEK_API_KEY is unset (billing-safety guard)', () => {
  withEnv({ DEEPSEEK_API_KEY: undefined }, () => {
    assert.throws(
      () => buildTakeoverCommand('deepseek', { sessionId: 'sess-1', cwd: '/tmp' }),
      /DEEPSEEK_API_KEY/
    )
  })
})

test('deepseek: throws when DEEPSEEK_API_KEY is empty string', () => {
  withEnv({ DEEPSEEK_API_KEY: '' }, () => {
    assert.throws(
      () => buildTakeoverCommand('deepseek', { sessionId: 'sess-1', cwd: '/tmp' }),
      /DEEPSEEK_API_KEY/
    )
  })
})

// =====================================================================================
// 5. Regression guards
// =====================================================================================

test('unknown backend still throws', () => {
  assert.throws(() => buildTakeoverCommand('bogus-backend', {}), /unknown backend/)
})

test('codex branch is unaffected by Phase 2 changes', () => {
  const result = buildTakeoverCommand('codex', { threadId: 't1', cwd: '/tmp' })
  assert.deepEqual(result, { cmd: 'codex', args: ['resume', 't1'], env: {}, cwd: '/tmp' })
})

// =====================================================================================
// 6. Env-forwarding — set/unset combinations, no `undefined` leakage
// =====================================================================================

test('antigravity: forwards only GEMINI_API_KEY when ANTIGRAVITY_API_KEY unset', () => {
  withEnv(
    { GEMINI_API_KEY: 'gem-key', ANTIGRAVITY_API_KEY: undefined },
    () => {
      const result = buildTakeoverCommand('antigravity', { convId: 'c1', cwd: '/tmp' })
      assert.deepEqual(result.env, { GEMINI_API_KEY: 'gem-key' })
      assert.ok(!('ANTIGRAVITY_API_KEY' in result.env))
    }
  )
})

test('antigravity: env is {} when both GEMINI_API_KEY and ANTIGRAVITY_API_KEY unset', () => {
  withEnv(
    { GEMINI_API_KEY: undefined, ANTIGRAVITY_API_KEY: undefined },
    () => {
      const result = buildTakeoverCommand('antigravity', { convId: 'c1', cwd: '/tmp' })
      assert.deepEqual(result.env, {})
    }
  )
})

test('antigravity: env has both keys when both are set', () => {
  withEnv(
    { GEMINI_API_KEY: 'gem-key', ANTIGRAVITY_API_KEY: 'ag-key' },
    () => {
      const result = buildTakeoverCommand('antigravity', { convId: 'c1', cwd: '/tmp' })
      assert.deepEqual(result.env, { GEMINI_API_KEY: 'gem-key', ANTIGRAVITY_API_KEY: 'ag-key' })
    }
  )
})

test('opencode: forwards OPENROUTER_API_KEY when set', () => {
  withEnv({ OPENROUTER_API_KEY: 'or-key' }, () => {
    const result = buildTakeoverCommand('opencode', { threadId: 't1', cwd: '/tmp' })
    assert.deepEqual(result.env, { OPENROUTER_API_KEY: 'or-key' })
  })
})

test('opencode: env is {} (no key present) when OPENROUTER_API_KEY unset', () => {
  withEnv({ OPENROUTER_API_KEY: undefined }, () => {
    const result = buildTakeoverCommand('opencode', { threadId: 't1', cwd: '/tmp' })
    assert.deepEqual(result.env, {})
    assert.ok(!('OPENROUTER_API_KEY' in result.env))
  })
})

test('copilot: token precedence COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN', () => {
  withEnv(
    {
      COPILOT_GITHUB_TOKEN: 'copilot-token',
      GH_TOKEN: 'gh-token',
      GITHUB_TOKEN: 'github-token',
    },
    () => {
      const result = buildTakeoverCommand('copilot', { threadId: 't1', cwd: '/tmp' })
      assert.deepEqual(result.env, { COPILOT_GITHUB_TOKEN: 'copilot-token' })
    }
  )
})

test('copilot: falls back to GH_TOKEN when COPILOT_GITHUB_TOKEN unset', () => {
  withEnv(
    {
      COPILOT_GITHUB_TOKEN: undefined,
      GH_TOKEN: 'gh-token',
      GITHUB_TOKEN: 'github-token',
    },
    () => {
      const result = buildTakeoverCommand('copilot', { threadId: 't1', cwd: '/tmp' })
      assert.deepEqual(result.env, { COPILOT_GITHUB_TOKEN: 'gh-token' })
    }
  )
})

test('copilot: falls back to GITHUB_TOKEN when both COPILOT_GITHUB_TOKEN and GH_TOKEN unset', () => {
  withEnv(
    {
      COPILOT_GITHUB_TOKEN: undefined,
      GH_TOKEN: undefined,
      GITHUB_TOKEN: 'github-token',
    },
    () => {
      const result = buildTakeoverCommand('copilot', { threadId: 't1', cwd: '/tmp' })
      assert.deepEqual(result.env, { COPILOT_GITHUB_TOKEN: 'github-token' })
    }
  )
})

test('copilot: env is {} when none of the three token vars are set', () => {
  withEnv(
    {
      COPILOT_GITHUB_TOKEN: undefined,
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
    },
    () => {
      const result = buildTakeoverCommand('copilot', { threadId: 't1', cwd: '/tmp' })
      assert.deepEqual(result.env, {})
    }
  )
})
