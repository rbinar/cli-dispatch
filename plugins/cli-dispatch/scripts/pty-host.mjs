// pty-host.mjs — PTY lifecycle management for the human-takeover feature.
//
// Exposes spawnPtyHost({ cmd, args, env, cwd, cols, rows }) -> handle. Tries `node-pty`
// (opt-in native dependency) first via dynamic import; if it is not installed or fails to
// load, falls back to a zero-native `script`-based pseudo-TTY. This mirrors ADR-0002
// (.specs/dev/adr/0002-node-pty-first-native-dependency.md, Accepted): node-pty is never
// assumed present, `script` is the required zero-native fallback (never tmux), and if
// neither is available the caller must be able to disable the takeover feature cleanly.
//
// Primary orphan-prevention layer (.specs/dev/sdd/human-takeover.md, "Veri Modeli" →
// "Orphan-önleme, iki katman", layer 1 — "Birincil (süreç-yaşam-döngüsü)"): every PTY/child
// spawned here is tracked in a module-level Set and killed synchronously if THIS process
// (dashboard-server.mjs, which imports this module) receives SIGTERM or exits normally —
// so a hosted PTY can never outlive the server process in those two cases. The secondary
// layer (heartbeat + `cli-dispatch-clean.mjs` reap, for SIGKILL/OOM/power-loss) is
// implemented in other files and is intentionally NOT attempted here.

import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'

// ---- `script` binary detection (lazy, cached — only probed once per process) ----

let scriptAvailable = null

function hasScriptBinary() {
  if (scriptAvailable === null) {
    try {
      const r = spawnSync('which', ['script'], { stdio: 'ignore' })
      scriptAvailable = r.status === 0
    } catch {
      scriptAvailable = false
    }
  }
  return scriptAvailable
}

// ---- POSIX single-quote shell escaping ----
//
// Only needed for the Linux `script -qec '<cmd>' /dev/null` path, where the whole
// command line must be passed as ONE string that `script` hands to `/bin/sh -c`. The
// macOS/darwin path passes cmd/args as separate argv entries via shell positional
// parameters ("$@"), so no escaping is needed there — see buildRelaySpawnArgs(). `cwd` is
// never interpolated into any shell string either way — it is passed via the `cwd` spawn
// option, which never touches a shell. Callers should still treat cmd/args as coming only
// from a trusted, server-side source (takeover-cmd.mjs), never raw client input.
function shellEscape(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function buildShellCommandLine(cmd, args) {
  return [cmd, ...args].map(shellEscape).join(' ')
}

// ---- how the script-fallback is actually invoked ----
//
// Naively `spawn('script', ['-q', '/dev/null', cmd, ...args])` (stdio: default 'pipe')
// fails immediately on this machine: Node's default 'pipe' stdio is a UNIX-domain
// socketpair on POSIX, and macOS/BSD `script` calls tcgetattr() on its own stdin during
// setup, which errors hard ("tcgetattr/ioctl: Operation not supported on socket") when
// stdin is that kind of socket — confirmed empirically. Using a named pipe (FIFO, via
// mkfifo) instead does NOT fix it either — also confirmed empirically (a bare bash repro,
// `script -q /dev/null cat < some-fifo`, hits the exact same error; only a genuine
// anonymous pipe, e.g. bash's `producer | script ...`, works). So we relay through `cat`
// inside a one-line `sh -c` pipeline: `sh -c 'exec cat | script -q /dev/null "$@"'`. This
// makes OUR write() target `cat`'s stdin (a plain Node pipe/socket — `cat` never calls
// tcgetattr, so it doesn't care), while `script`'s stdin becomes the *real* anonymous pipe
// the shell creates for the `cat | script` pipeline stage, which behaves exactly like the
// working bash repro. cmd/args are passed as shell positional parameters ("$@" / "$1"),
// never string-interpolated, so no injection surface even though they flow through a
// shell.
function buildRelaySpawnArgs(platform, cmd, args) {
  if (platform === 'darwin') {
    return ['sh', ['-c', 'exec cat | script -q /dev/null "$@"', 'sh', cmd, ...args]]
  }
  if (platform === 'linux') {
    const commandLine = buildShellCommandLine(cmd, args)
    return ['sh', ['-c', 'exec cat | script -qec "$1" /dev/null', 'sh', commandLine]]
  }
  throw new Error(
    `pty-host: 'script'-fallback is not implemented for platform '${platform}' (only darwin/linux — ` +
    `see ADR-0002, Windows/ConPTY parity deferred to a later phase)`
  )
}

// ---- primary orphan-prevention layer: process-lifecycle binding ----

const liveHandles = new Set()
let lifecycleHandlersRegistered = false

function registerLifecycleHandlersOnce() {
  if (lifecycleHandlersRegistered) return
  lifecycleHandlersRegistered = true

  // SIGTERM is an ASYNC teardown: the event loop keeps running after the handler, so a
  // graceful TERM→3s→KILL escalation (handle.kill()) can complete its timer.
  const gracefulKillAll = () => {
    for (const handle of liveHandles) {
      try { handle.kill() } catch { /* best-effort — process is going down regardless */ }
    }
  }

  // 'exit' is SYNCHRONOUS: the event loop halts the instant this returns, so any setTimeout
  // scheduled here would never fire. Use each handle's synchronous immediate-kill path
  // (group SIGKILL, no timer) so a child that ignores SIGTERM is still torn down before the
  // loop stops. node-pty handles alias killImmediate to their already-synchronous kill().
  const immediateKillAll = () => {
    for (const handle of liveHandles) {
      try { handle.killImmediate?.() ?? handle.kill() } catch { /* best-effort — going down regardless */ }
    }
  }

  // Normal exit and SIGTERM are the two cases this primary layer guarantees: if the
  // hosting process dies either way, every PTY it spawned dies with it.
  process.on('SIGTERM', gracefulKillAll)
  process.on('exit', immediateKillAll)
}

// ---- process-GROUP kill (script-fallback only) ----
//
// The script-fallback spawns `sh -c 'exec cat | script ... "$@"'` (detached: true, so it
// is its own process-group leader). `script` itself then forks the real target command
// underneath it. Killing only the top `sh`/`cat` PID would orphan `script` and its child —
// exactly the orphan risk this whole module exists to prevent — so we always signal the
// whole process GROUP (negative PID), falling back to a plain child.kill() if the group
// signal fails for some reason (e.g. already reaped).
//
// Two modes, because Node's 'exit' handler must run SYNCHRONOUSLY — the event loop stops
// the moment it returns, so any setTimeout scheduled from it NEVER fires:
//   - immediate: false (default) — graceful TERM, then KILL after a 3s grace window,
//     mirroring stream-utils.sh's kill_worker. Only safe from ASYNC teardown paths (the
//     module's SIGTERM handler, explicit handle.kill() from handback) where a timer CAN
//     still fire.
//   - immediate: true — send SIGKILL to the group right away, no setTimeout, no grace.
//     This is the ONLY variant that works from the 'exit' lifecycle handler, where a child
//     that ignores SIGTERM would otherwise never get SIGKILL'd before the loop stops.
function terminateProcessGroup(child, { immediate = false } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal)
    } catch {
      try { child.kill(signal) } catch { /* ignore — likely already exited */ }
    }
  }
  if (immediate) {
    // Synchronous, no timer: escalate straight to SIGKILL on the whole group so the tree
    // is gone before this synchronous 'exit' handler returns and the event loop halts.
    signalGroup('SIGKILL')
    return
  }
  signalGroup('SIGTERM')
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL')
  }, 3000)
  killTimer.unref?.()
  child.once('exit', () => clearTimeout(killTimer))
}

/**
 * Spawn a PTY host for an interactive CLI. `cmd`/`args`/`cwd`/`env` must come from a
 * trusted, server-side source (takeover-cmd.mjs), never raw client input.
 *
 * onData always delivers a decoded string (never a Buffer) in BOTH modes — the
 * script-fallback decodes through a persistent streaming TextDecoder so multibyte
 * sequences split across chunks reassemble; node-pty already yields strings.
 *
 * pid/pgid are consumed by dashboard-server.mjs for out-of-process reaping. killImmediate()
 * is a synchronous group SIGKILL for the 'exit' lifecycle path (no timer); kill() keeps the
 * graceful TERM→3s→KILL window for async teardown.
 *
 * @returns {Promise<{
 *   mode: 'node-pty' | 'script',
 *   pid: number,
 *   pgid: number | null,
 *   write: (data: string | Buffer) => void,
 *   resize: (cols: number, rows: number) => void,
 *   onData: (cb: (chunk: string) => void) => void,
 *   onExit: (cb: (code: number | null) => void) => void,
 *   kill: () => void,
 *   killImmediate: () => void,
 * }>}
 */
export async function spawnPtyHost({ cmd, args = [], env = {}, cwd, cols = 80, rows = 24 }) {
  registerLifecycleHandlersOnce()

  let nodePty = null
  try {
    nodePty = await import('node-pty')
  } catch {
    // Expected/normal path whenever node-pty was not opted into at install time
    // (ADR-0002: try/catch dynamic import, never assume installed).
    nodePty = null
  }

  if (nodePty) return spawnWithNodePty(nodePty, { cmd, args, env, cwd, cols, rows })

  if (!hasScriptBinary()) {
    throw new Error("pty-host: neither node-pty nor 'script' binary available — takeover cannot be hosted")
  }

  return spawnWithScriptFallback({ cmd, args, env, cwd })
}

// ---- node-pty path (full-fidelity: real resize, raw mode, signals) ----

function spawnWithNodePty(nodePty, { cmd, args, env, cwd, cols, rows }) {
  const ptyProcess = nodePty.spawn(cmd, args, {
    name: 'xterm-color',
    cols,
    rows,
    cwd,
    env: { ...process.env, ...env },
  })

  const dataCbs = []
  const exitCbs = []
  let exited = false

  ptyProcess.onData((chunk) => {
    for (const cb of dataCbs) { try { cb(chunk) } catch { /* ignore listener errors */ } }
  })

  ptyProcess.onExit(({ exitCode }) => {
    exited = true
    liveHandles.delete(handle)
    for (const cb of exitCbs) { try { cb(exitCode) } catch { /* ignore listener errors */ } }
  })

  const handle = {
    mode: 'node-pty',
    // Consumed by dashboard-server.mjs (written into status.json.takeover so an
    // out-of-process reaper can later kill the tree). node-pty is NOT spawned detached, so
    // there is no separate process group we control → pgid is null (not the pid).
    pid: ptyProcess.pid,
    pgid: null,
    write(data) {
      if (exited) return
      try { ptyProcess.write(typeof data === 'string' ? data : data.toString()) } catch { /* ignore */ }
    },
    resize(newCols, newRows) {
      if (exited) return
      try { ptyProcess.resize(newCols, newRows) } catch { /* ignore — e.g. already exited */ }
    },
    onData(cb) { dataCbs.push(cb) },
    onExit(cb) { exitCbs.push(cb) },
    kill() {
      if (exited) return
      try { ptyProcess.kill() } catch { /* ignore */ }
      liveHandles.delete(handle)
    },
    // ptyProcess.kill() is already synchronous, so the exit-path immediate kill is just the
    // same call — alias it so the 'exit' lifecycle handler can treat both modes uniformly.
    killImmediate() {
      if (exited) return
      try { ptyProcess.kill() } catch { /* ignore */ }
      liveHandles.delete(handle)
    },
  }

  liveHandles.add(handle)
  return handle
}

// ---- `script`-based zero-native fallback (ADR-0002) ----
//
// Known, documented limitation vs. node-pty: no live resize (the pty allocated internally
// by `script` is not exposed to us for TIOCSWINSZ), coarser exit-code/signal fidelity.
// `resize()` is therefore a safe no-op here rather than a throw — callers should not have
// to special-case the fallback mode just to call resize(). See buildRelaySpawnArgs() above
// for why this goes through a `sh -c 'exec cat | script ...'` relay rather than a bare
// `spawn('script', [...])`.
function spawnWithScriptFallback({ cmd, args, env, cwd }) {
  const platform = os.platform()
  const spawnEnv = { ...process.env, ...env }
  const [command, argv] = buildRelaySpawnArgs(platform, cmd, args)

  // detached: true — makes this child the leader of its own process group, so
  // terminateProcessGroup() can reliably kill the whole `cat | script | <real cmd>`
  // pipeline (script forks the real target command underneath itself) with one signal.
  const child = spawn(command, argv, { cwd, env: spawnEnv, detached: true })

  const dataCbs = []
  const exitCbs = []
  let exited = false

  // UTF-8 boundary safety: child.stdout/child.stderr hand us raw Buffer chunks, and a
  // multibyte codepoint (emoji, box-drawing char, …) can be split across two 'data' events.
  // Decoding each chunk independently would turn each half into U+FFFD (`�`). A streaming
  // TextDecoder buffers a trailing partial sequence and reassembles it with the next chunk,
  // so we create ONE persistent decoder per stream and reuse it across every chunk. stdout
  // and stderr get SEPARATE decoders — feeding both through one decoder would let a partial
  // sequence on one stream corrupt the multibyte state of the other. Net contract
  // (dashboard-server.mjs depends on it): onData callbacks always receive a decoded string,
  // never a Buffer — matching the node-pty path, which already yields assembled strings.
  const stdoutDecoder = new TextDecoder('utf-8', { stream: true })
  const stderrDecoder = new TextDecoder('utf-8', { stream: true })

  // `script` merges the target command's stdout+stderr into a single pty stream and
  // relays it through the `cat` relay's stdout to us (that IS the "real PTY output" —
  // both stdout and stderr appear merged, as a real PTY would, because the command under
  // `script` shares one tty fd).
  child.stdout.on('data', (chunk) => {
    const text = stdoutDecoder.decode(chunk, { stream: true })
    if (text === '') return
    for (const cb of dataCbs) { try { cb(text) } catch { /* ignore listener errors */ } }
  })
  // Defensive: forward anything the relay shell/script itself writes to stderr too
  // (should be near-silent with -q), so no output is ever silently dropped. Own decoder —
  // see the stdout/stderr separation note above.
  child.stderr.on('data', (chunk) => {
    const text = stderrDecoder.decode(chunk, { stream: true })
    if (text === '') return
    for (const cb of dataCbs) { try { cb(text) } catch { /* ignore listener errors */ } }
  })

  child.once('exit', (code, signal) => {
    exited = true
    liveHandles.delete(handle)
    // Standard shell convention when a signal (not a plain exit) ended the process:
    // 128 + signal number (e.g. SIGTERM=15 -> 143). Falls back to a flat 128 if the
    // signal name isn't in this platform's os.constants.signals table.
    const normalizedCode = code !== null ? code : (128 + (os.constants.signals[signal] ?? 0))
    for (const cb of exitCbs) { try { cb(normalizedCode) } catch { /* ignore listener errors */ } }
  })

  const handle = {
    mode: 'script',
    // Consumed by dashboard-server.mjs (written into status.json.takeover so an
    // out-of-process reaper can later kill the tree). The child is spawned detached: true,
    // making it its own process-group leader → the group id equals the child pid, so a
    // reaper can `kill -SIGKILL -<pgid>` the whole `cat | script | <cmd>` tree.
    pid: child.pid,
    pgid: child.pid,
    write(data) {
      if (exited) return
      try { child.stdin.write(data) } catch { /* ignore — e.g. EPIPE after exit */ }
    },
    resize(_newCols, _newRows) {
      // Known reduced-fidelity limitation of the script-fallback (ADR-0002): no live
      // resize capability. Intentionally a safe no-op, never throws.
    },
    onData(cb) { dataCbs.push(cb) },
    onExit(cb) { exitCbs.push(cb) },
    // Async teardown (SIGTERM handler, explicit handback): graceful TERM→3s→KILL.
    kill() {
      if (exited) return
      terminateProcessGroup(child)
      liveHandles.delete(handle)
    },
    // Synchronous teardown (the 'exit' lifecycle handler): immediate group SIGKILL with no
    // timer, because the event loop halts the moment that handler returns — a scheduled
    // setTimeout would never fire, leaving a SIGTERM-ignoring child un-killed.
    killImmediate() {
      if (exited) return
      terminateProcessGroup(child, { immediate: true })
      liveHandles.delete(handle)
    },
  }

  liveHandles.add(handle)
  return handle
}
