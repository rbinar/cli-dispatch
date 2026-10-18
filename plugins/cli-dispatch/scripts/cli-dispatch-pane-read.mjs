#!/usr/bin/env node
// cli-dispatch-pane-read.mjs — byte-range, line-aligned reads for the /cli-dispatch-runs pane.
//
// Runs from the plugin dir via $.process.run (not installed). The mod cannot read a
// multi-MiB transcript.jsonl itself ($.fs.read rejects over 4 MiB and has no offset), so every
// read of transcript.jsonl goes through here. Output is JSONL on stdout, never over OUT_MAX
// bytes. It does no masking: the mod masks what it receives.
//
//   fwd   <file> <from> <budget>   complete lines from byte `from`, up to `budget` file bytes
//   back  <file> <end>  <budget>   complete lines ending at or before `end`, up to `budget` bytes
//   chunk <file> <off> <len>       header {"next"}, then {"t"}: the text of bytes [off, off+len)
//
// Line records: {"o": byteOffset, "t": text}. A line over BIG_LINE becomes
// {"o","l","big":true,"t": first 4 KiB} and is fetched whole with `chunk`.

import { openSync, readSync, closeSync, fstatSync } from 'node:fs'

const OUT_MAX = 2 * 1024 * 1024
const BIG_LINE = 64 * 1024
const HEAD = 4096
const CH = 1024 * 1024

// Largest e <= end such that buf[0, e) does not end inside a multi-byte character.
function alignEnd(buf, end) {
  for (let i = end - 1; i >= Math.max(0, end - 4); i--) {
    const b = buf[i]
    if ((b & 0xc0) === 0x80) continue
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1
    return i + need > end ? i : end
  }
  return end
}

const head = (buf) => buf.subarray(0, alignEnd(buf, Math.min(buf.length, HEAD))).toString('utf8')

// Complete (newline-terminated) lines in [from, limit). Only the first BIG_LINE+1 bytes of a
// line are kept, so a huge line costs time, not memory.
function* scan(fd, from, limit) {
  const chunk = Buffer.allocUnsafe(CH)
  let pos = from, lineStart = from, parts = [], kept = 0, total = 0
  const keep = (view) => {
    total += view.length
    const room = BIG_LINE + 1 - kept
    if (room > 0) {
      const piece = Buffer.from(view.subarray(0, Math.min(room, view.length)))
      parts.push(piece)
      kept += piece.length
    }
  }
  while (pos < limit) {
    const n = readSync(fd, chunk, 0, Math.min(CH, limit - pos), pos)
    if (n <= 0) break
    const view = chunk.subarray(0, n)
    let s = 0
    for (;;) {
      const i = view.indexOf(10, s)
      if (i < 0) {
        keep(view.subarray(s))
        break
      }
      keep(view.subarray(s, i))
      yield { o: lineStart, len: total, buf: Buffer.concat(parts) }
      parts = []
      kept = 0
      total = 0
      lineStart = pos + i + 1
      s = i + 1
    }
    pos += n
  }
}

// Index of the last '\n' at a position < before, or -1.
function prevNl(fd, before) {
  const buf = Buffer.allocUnsafe(65536)
  let end = before
  while (end > 0) {
    const start = Math.max(0, end - buf.length)
    const n = readSync(fd, buf, 0, end - start, start)
    const i = buf.subarray(0, n).lastIndexOf(10)
    if (i >= 0) return start + i
    end = start
  }
  return -1
}

// Index of the first '\n' at a position in [from, limit), or -1.
function nextNl(fd, from, limit) {
  const buf = Buffer.allocUnsafe(65536)
  let pos = from
  while (pos < limit) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, limit - pos), pos)
    if (n <= 0) break
    const i = buf.subarray(0, n).indexOf(10)
    if (i >= 0) return pos + i
    pos += n
  }
  return -1
}

const record = (ln) =>
  ln.len > BIG_LINE
    ? { o: ln.o, l: ln.len, big: true, t: head(ln.buf) }
    : { o: ln.o, t: ln.buf.toString('utf8') }

const jsonBytes = (o) => Buffer.byteLength(JSON.stringify(o))
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n')

function fwd(fd, size, from, budget) {
  const recs = []
  let used = 0, outBytes = 256, to = from
  for (const ln of scan(fd, from, size)) {
    const cost = ln.len + 1
    if (recs.length && used + cost > budget) break
    const r = record(ln)
    const js = jsonBytes(r) + 1
    if (recs.length && outBytes + js > OUT_MAX) break
    recs.push(r)
    used += cost
    outBytes += js
    to = ln.o + ln.len + 1
  }
  emit({ from, to, size })
  for (const r of recs) emit(r)
}

function back(fd, size, end, budget) {
  const e = Math.min(end, size)
  // The last complete line ends at a newline strictly before e.
  const lastNl = prevNl(fd, e)
  if (lastNl < 0) {
    emit({ from: 0, to: 0, size })
    return
  }
  const limit = lastNl + 1
  let start = Math.max(0, limit - budget)
  if (start > 0) {
    const b = Buffer.alloc(1)
    readSync(fd, b, 0, 1, start - 1)
    if (b[0] !== 10) {
      const nl = nextNl(fd, start, lastNl)
      // No line start inside the window: the last line is longer than the budget, return it alone.
      start = nl < 0 ? prevNl(fd, lastNl) + 1 : nl + 1
    }
  }
  let recs = []
  for (const ln of scan(fd, start, limit)) recs.push(record(ln))
  let outBytes = recs.reduce((a, r) => a + jsonBytes(r) + 1, 256)
  while (recs.length > 1 && outBytes > OUT_MAX) outBytes -= jsonBytes(recs.shift()) + 1
  emit({ from: recs.length ? recs[0].o : limit, to: limit, size })
  for (const r of recs) emit(r)
}

// The text of bytes [off, off+len), cut so the JSON stays under OUT_MAX and on a character edge.
function readText(fd, size, off, len) {
  const raw = Math.max(0, Math.min(len, OUT_MAX, size - off))
  const buf = Buffer.allocUnsafe(raw)
  const n = raw > 0 ? readSync(fd, buf, 0, raw, off) : 0
  let e = alignEnd(buf, n)
  let t = buf.subarray(0, e).toString('utf8')
  while (jsonBytes(t) + 256 > OUT_MAX && e > 1) {
    e = alignEnd(buf, Math.floor(e / 2))
    t = buf.subarray(0, e).toString('utf8')
  }
  return { t, next: off + e < off + len && off + e < size ? off + e : null }
}

function main() {
  const [mode, a, b, c] = process.argv.slice(2)
  const fd = openSync(a, 'r')
  try {
    const size = fstatSync(fd).size
    if (mode === 'fwd') fwd(fd, size, Number(b), Number(c))
    else if (mode === 'back') back(fd, size, Number(b), Number(c))
    else if (mode === 'chunk') {
      const off = Number(b), len = Number(c)
      const { t, next } = readText(fd, size, off, len)
      emit({ next })
      emit({ t })
    } else throw new Error(`unknown mode: ${mode}`)
  } finally { closeSync(fd) }
}

try {
  main()
} catch (err) {
  emit({ error: err instanceof Error ? err.message : String(err) })
  process.exitCode = 2
}
