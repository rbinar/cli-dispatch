// Issue #215: a worker brief must not travel on a command line, where `ps` shows it to every
// local user.
//   Layer 1 (runner -> stream): every *-worktree-run.sh hands the brief over as
//           `--prompt-file <path>`, and every *-stream accepts it.
//   Layer 2 (stream -> worker CLI): measured against each CLI's own --help.
//           codex      `[PROMPT] ... or if `-` is used, instructions are read from stdin`  -> stdin
//           claude     reads the prompt from stdin in --print mode (already so)            -> stdin
//           copilot    `-p, --prompt <text>` is the only documented prompt input           -> argv kept
//           opencode   `run [message..]` positional; `-f` attaches files (not a prompt)    -> argv kept
//           agy        `-p/--print` takes the prompt; stdin only for `--input-format stream-json`
//                      with `--output-format stream-json`, which ag-stream does not use     -> argv kept
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SENTINEL = 'SENTINEL-215-brief-7f3a'
const BRIEF = `${SENTINEL}\nsecond line with 'quotes' "dq" $(echo expanded) \`bt\`\n`

// [stream script, worker CLI, fixed at layer 2?]
const STREAMS = [
  ['claude-ds-stream', 'claude', true],
  ['cx-stream', 'codex', true],
  ['cp-stream', 'copilot', false],
  ['oc-stream', 'opencode', false],
  ['ag-stream', 'agy', false],
]

function setup() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'prompt-argv-')))
  const bin = path.join(root, 'bin')
  for (const d of [bin, path.join(root, 'home'), path.join(root, 'home', '.codex'), path.join(root, 'sessions'), path.join(root, 'repo')]) mkdirSync(d)
  // A worker CLI stub that records its argv (one arg per line, NUL-free) and its stdin.
  for (const cli of ['claude', 'codex', 'copilot', 'opencode', 'agy']) {
    writeFileSync(path.join(bin, cli), `#!/bin/bash
printf '%s\\n' "$@" > "${root}/${cli}.argv"
cat > "${root}/${cli}.stdin"
exit 1
`)
    chmodSync(path.join(bin, cli), 0o755)
  }
  const briefFile = path.join(root, 'brief.txt')
  writeFileSync(briefFile, BRIEF, { mode: 0o600 })
  return { root, bin, briefFile }
}
const read = (x, f) => (existsSync(path.join(x.root, f)) ? readFileSync(path.join(x.root, f), 'utf8') : '')

function runStream(x, script, args) {
  return spawnSync('bash', [path.join(SCRIPTS, script), '--cwd', path.join(x.root, 'repo'), ...args], {
    cwd: x.root, encoding: 'utf8', timeout: 90000,
    env: { PATH: `${x.bin}:${process.env.PATH}`, HOME: path.join(x.root, 'home'), CODEX_HOME: path.join(x.root, 'home', '.codex'),
      CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: path.join(x.root, 'sessions'),
      DEEPSEEK_API_KEY: 'dummy', OPENROUTER_API_KEY: 'dummy' },
  })
}

for (const [script, cli, fixed] of STREAMS) {
  test(`${script}: --prompt-file delivers the brief to ${cli}${fixed ? ' on stdin, never on argv' : ' (argv kept: the CLI has no stdin/file prompt input)'}`, () => {
    const x = setup()
    try {
      const r = runStream(x, script, ['--prompt-file', x.briefFile])
      const argv = read(x, `${cli}.argv`), stdin = read(x, `${cli}.stdin`)
      assert.ok(argv !== '' || stdin !== '', `${cli} stub was never launched; stderr: ${r.stderr}`)
      if (fixed) {
        assert.ok(!argv.includes(SENTINEL), `the brief is on ${cli}'s argv:\n${argv}`)
        assert.ok(stdin.includes(SENTINEL), `${cli} did not receive the brief on stdin`)
        assert.ok(stdin.includes('$(echo expanded)'), 'brief was altered on the way in')
      } else {
        assert.ok(argv.includes(SENTINEL), `${cli} did not receive the brief; stderr: ${r.stderr}`)
        assert.ok(argv.includes('$(echo expanded)'), 'brief was altered on the way in')
      }
    } finally { rmSync(x.root, { recursive: true, force: true }) }
  })

  test(`${script}: --prompt-file and -p are mutually exclusive, and a missing file fails`, () => {
    const x = setup()
    try {
      const both = runStream(x, script, ['--prompt-file', x.briefFile, '-p', 'other'])
      assert.equal(both.status, 2, both.stderr)
      assert.match(both.stderr, /mutually exclusive/)
      const missing = runStream(x, script, ['--prompt-file', path.join(x.root, 'nope')])
      assert.equal(missing.status, 1, missing.stderr)
      assert.match(missing.stderr, /not found/)
      assert.equal(read(x, `${cli}.argv`), '', `${cli} must not be launched on a bad prompt source`)
    } finally { rmSync(x.root, { recursive: true, force: true }) }
  })
}

test('cx-stream: -p keeps working and also stays off codex argv', () => {
  const x = setup()
  try {
    runStream(x, 'cx-stream', ['-p', BRIEF])
    assert.ok(!read(x, 'codex.argv').includes(SENTINEL))
    assert.ok(read(x, 'codex.stdin').includes(SENTINEL))
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('cx-stream: the prompt is the stdin marker `-` on both exec and exec resume', () => {
  const x = setup()
  try {
    runStream(x, 'cx-stream', ['--prompt-file', x.briefFile])
    const plain = read(x, 'codex.argv').trim().split('\n')
    assert.equal(plain[0], 'exec')
    assert.equal(plain.at(-1), '-')
    rmSync(path.join(x.root, 'codex.argv'))
    runStream(x, 'cx-stream', ['--resume', 'thr-215', '--prompt-file', x.briefFile])
    const resume = read(x, 'codex.argv').trim().split('\n')
    assert.deepEqual(resume.slice(0, 2), ['exec', 'resume'])
    assert.deepEqual(resume.slice(-2), ['thr-215', '-'])
    assert.ok(!resume.join('\n').includes(SENTINEL))
    assert.ok(read(x, 'codex.stdin').includes(SENTINEL))
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

test('cx-stream: the stdin prompt file is removed on exit', () => {
  const x = setup()
  try {
    const tmp = path.join(x.root, 'tmp'); mkdirSync(tmp)
    spawnSync('bash', [path.join(SCRIPTS, 'cx-stream'), '--cwd', path.join(x.root, 'repo'), '--prompt-file', x.briefFile], {
      cwd: x.root, encoding: 'utf8', timeout: 90000,
      env: { PATH: `${x.bin}:${process.env.PATH}`, HOME: path.join(x.root, 'home'), CODEX_HOME: path.join(x.root, 'home', '.codex'),
        TMPDIR: tmp, CLI_DISPATCH_CONFIG: '/dev/null', CLI_DISPATCH_SESSIONS_DIR: path.join(x.root, 'sessions') },
    })
    const left = spawnSync('bash', ['-c', `ls "${tmp}"`], { encoding: 'utf8' }).stdout.split('\n').filter(n => n.startsWith('cx-prompt-'))
    assert.deepEqual(left, [])
  } finally { rmSync(x.root, { recursive: true, force: true }) }
})

// ---- Layer 1, end to end: each runner launches its stream with --prompt-file <brief>, no -p.
const RUNNERS = [['ds', 'claude-ds-stream'], ['cx', 'cx-stream'], ['ag', 'ag-stream'], ['oc', 'oc-stream'], ['cp', 'cp-stream']]
for (const [pfx, stream] of RUNNERS) {
  test(`${pfx}-worktree-run.sh: launches ${stream} with --prompt-file <brief>, brief never on its argv`, () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'prompt-runner-')))
    try {
      const bin = path.join(root, 'bin'), repo = path.join(root, 'repo')
      mkdirSync(bin); mkdirSync(repo)
      const genv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e.x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e.x' }
      spawnSync('bash', ['-c', 'git init -q -b main && echo seed > f && git add f && git commit -q -m seed'], { cwd: repo, env: genv })
      writeFileSync(path.join(bin, stream), `#!/bin/bash
printf '%s\\n' "$@" > "${root}/stream.argv"
exit 0
`)
      chmodSync(path.join(bin, stream), 0o755)
      const briefFile = path.join(root, 'brief.txt')
      writeFileSync(briefFile, BRIEF, { mode: 0o600 })
      const branch = `t215-${pfx}-${process.pid}`
      const r = spawnSync('bash', [path.join(SCRIPTS, `${pfx}-worktree-run.sh`), repo, branch, briefFile], {
        cwd: root, encoding: 'utf8', timeout: 90000, env: { ...genv, PATH: `${bin}:${process.env.PATH}` },
      })
      const argv = read({ root }, 'stream.argv').split('\n')
      assert.ok(argv.length > 1, `stream stub not launched; stderr: ${r.stderr}`)
      const i = argv.indexOf('--prompt-file')
      assert.ok(i >= 0 && argv[i + 1] === briefFile, `no --prompt-file <brief> in:\n${argv.join('\n')}`)
      assert.ok(!argv.includes('-p'), '-p still passed')
      assert.ok(!argv.join('\n').includes(SENTINEL), 'the brief text is on the stream argv')
      assert.equal(statSync(briefFile).mode & 0o077, 0, 'brief file must be owner-only')
      const wt = (/Worktree: (\S+)/.exec(`${r.stdout}${r.stderr}`) || [])[1]
      if (wt) spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test('static gate: no worktree runner passes the brief as -p "$(cat "$BRIEF")"', () => {
  const r = spawnSync('bash', ['-c', `grep -nE -- '-p "\\$\\(cat "\\$BRIEF"\\)"' ${SCRIPTS}/*-worktree-run.sh`], { encoding: 'utf8' })
  assert.equal(r.status, 1, `matched:\n${r.stdout}`)
})
