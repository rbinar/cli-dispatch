import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli-dispatch-pane-read.mjs')
const OUT_MAX = 2 * 1024 * 1024
const dir = mkdtempSync(path.join(os.tmpdir(), 'cli-dispatch-test-pane-read-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

function read(...args) {
  const r = spawnSync('node', [helper, ...args.map(String)], { maxBuffer: 64 * 1024 * 1024 })
  assert.ok(r.stdout.length <= OUT_MAX, `stdout ${r.stdout.length} over OUT_MAX`)
  return { status: r.status, recs: r.stdout.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

// > 6 MiB of lines with multi-byte characters, plus one 200 KiB line in the middle.
const BIG = 200 * 1024
const lines = []
for (let i = 0; i < 100000; i++) lines.push(`{"i":${i},"t":"ğüş✓ 日本語 ${'é'.repeat(i % 40)}"}`)
const bigLine = JSON.stringify({ big: 'ü'.repeat(BIG / 2 - 20) })
lines.splice(50000, 0, bigLine)
const transcript = path.join(dir, 'transcript.jsonl')
writeFileSync(transcript, lines.join('\n') + '\n')
const file = readFileSync(transcript)
const SIZE = file.length

// True byte offset of every line start.
const offsets = []
{
  let pos = 0
  for (const l of lines) { offsets.push(pos); pos += Buffer.byteLength(l) + 1 }
}
const offsetSet = new Map(offsets.map((o, i) => [o, i]))

test('fixture is larger than the 4 MiB engine read cap', () => {
  assert.ok(SIZE > 6 * 1024 * 1024, `fixture is ${SIZE} bytes`)
})

test('fwd returns complete lines at true byte offsets, within the budget', () => {
  const budget = 300 * 1024
  const { recs } = read('fwd', transcript, 0, budget)
  const [hdr, ...rows] = recs
  assert.equal(hdr.from, 0)
  assert.equal(hdr.size, SIZE)
  assert.ok(rows.length > 100)
  for (const r of rows) {
    const i = offsetSet.get(r.o)
    assert.notEqual(i, undefined, `offset ${r.o} is a real line start`)
    assert.equal(r.t, lines[i])
  }
  const last = rows[rows.length - 1]
  assert.equal(hdr.to, last.o + Buffer.byteLength(last.t) + 1)
  assert.ok(hdr.to - hdr.from <= budget)
  // The next line would not have fitted.
  const next = offsetSet.get(hdr.to)
  assert.ok(hdr.to - hdr.from + Buffer.byteLength(lines[next]) + 1 > budget)
})

test('fwd from the previous `to` continues without a gap or a repeat', () => {
  const a = read('fwd', transcript, 0, 100 * 1024).recs
  const b = read('fwd', transcript, a[0].to, 100 * 1024).recs
  assert.equal(b[1].o, a[0].to)
  assert.equal(b[0].from, a[0].to)
})

test('the 200 KiB line comes back as a big record; chunk calls over `next` rebuild it byte for byte', () => {
  const idx = 50000
  const { recs } = read('fwd', transcript, offsets[idx] - 10, 400 * 1024)
  const big = recs.find((r) => r.big)
  assert.ok(big, 'a big record')
  assert.equal(big.o, offsets[idx])
  assert.equal(big.l, Buffer.byteLength(bigLine))
  assert.ok(Buffer.byteLength(big.t) <= 4096)
  assert.ok(bigLine.startsWith(big.t), 'the head is a clean character prefix')
  const parts = []
  let off = big.o
  for (let n = 0; n < 50; n++) {
    const [h, body] = read('chunk', transcript, off, big.l - (off - big.o)).recs
    parts.push(body.t)
    if (h.next == null) break
    off = h.next
  }
  assert.equal(parts.join(''), bigLine)
})

test('chunk cuts on a character boundary, never inside a multi-byte character', () => {
  const o = offsets[100]
  const [h, body] = read('chunk', transcript, o, 37).recs
  assert.ok(!body.t.includes('�'))
  const bytes = Buffer.byteLength(body.t)
  assert.ok(bytes <= 37)
  assert.equal(h.next, o + bytes)
  // The rest continues exactly where the cut stopped.
  const [, rest] = read('chunk', transcript, h.next, 400).recs
  assert.ok((body.t + rest.t).startsWith(lines[100].slice(0, 20)))
  assert.ok(!rest.t.includes('�'))
})

test('back returns the complete lines that end at or before `end`, and a partial last line is not returned', () => {
  const budget = 200 * 1024
  const { recs } = read('back', transcript, SIZE, budget)
  const [hdr, ...rows] = recs
  assert.equal(hdr.to, SIZE)
  assert.ok(rows.length > 100)
  assert.equal(rows[rows.length - 1].t, lines[lines.length - 1])
  for (const r of rows) assert.equal(r.t, lines[offsetSet.get(r.o)])
  assert.equal(hdr.from, rows[0].o)
  assert.ok(hdr.to - hdr.from <= budget)
  // Going back from `from` reaches the earlier lines, contiguously.
  const earlier = read('back', transcript, hdr.from, budget).recs
  assert.equal(earlier[0].to, hdr.from)
  const e = earlier.slice(1)
  assert.equal(e[e.length - 1].t, lines[offsetSet.get(rows[0].o) - 1])

  // A file whose last line has no newline yet: that line is held back.
  const partial = path.join(dir, 'partial.jsonl')
  writeFileSync(partial, 'one\ntwo\nthr')
  const p = read('back', partial, 11, 1000).recs
  assert.deepEqual(p.slice(1).map((r) => r.t), ['one', 'two'])
  assert.equal(p[0].to, 8)
  const f = read('fwd', partial, 0, 1000).recs
  assert.deepEqual(f.slice(1).map((r) => r.t), ['one', 'two'])
  assert.equal(f[0].to, 8)
})

test('back across multi-byte characters starts on a line, not inside one', () => {
  for (const end of [SIZE, SIZE - 12345, 3_000_001]) {
    const { recs } = read('back', transcript, end, 4097)
    for (const r of recs.slice(1)) {
      assert.notEqual(offsetSet.get(r.o), undefined)
      assert.ok(!r.t.includes('�'))
    }
  }
})

test('back with a last line longer than the budget returns that line alone (as big)', () => {
  const f = path.join(dir, 'huge.jsonl')
  writeFileSync(f, 'small\n' + 'ü'.repeat(100_000) + '\n')
  const { recs } = read('back', f, Buffer.byteLength('small\n') + 200_001, 1000)
  assert.equal(recs.length, 2)
  assert.equal(recs[1].big, true)
  assert.equal(recs[1].o, 6)
  assert.equal(recs[1].l, 200_000)
})

test('event returns text, an offset pair, or none, per progress.idx', () => {
  const s = path.join(dir, 'sess')
  rmSync(s, { recursive: true, force: true })
  const ev = { type: 'x', out: 'ğüş✓ full output', n: 'a'.repeat(6000) }
  const evLine = JSON.stringify(ev)
  writeFileSync(path.join(s + '-t'), '')
  const sd = mkdtempSync(path.join(dir, 'sd-'))
  writeFileSync(path.join(sd, 'transcript.jsonl'), 'junk\n' + evLine + '\n')
  writeFileSync(
    path.join(sd, 'progress.idx'),
    [{ p: 0, o: 5, l: Buffer.byteLength(evLine) }, { p: 10, text: 'full coalesced text' }, { p: 100, o: 5, l: Buffer.byteLength(evLine) }].map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  const a = read('event', sd, 0).recs
  assert.deepEqual(a[0], { o: 5, l: Buffer.byteLength(evLine) })
  assert.deepEqual(JSON.parse(a[1].t), ev)
  assert.equal(a[1].next, null)
  assert.deepEqual(read('event', sd, 10).recs, [{ text: 'full coalesced text' }])
  assert.deepEqual(read('event', sd, 1).recs, [{ none: true }]) // a prefix of 10/100 is not a match
  assert.deepEqual(read('event', sd, 55).recs, [{ none: true }])
  const noIdx = mkdtempSync(path.join(dir, 'noidx-'))
  assert.deepEqual(read('event', noIdx, 0).recs, [{ none: true }])
})

test('event: a huge coalesced text comes in pages that rebuild it; a record deep in progress.idx is found', () => {
  const sd = mkdtempSync(path.join(dir, 'evbig-'))
  const huge = 'ğ'.repeat(3 * 1024 * 1024) // 6 MiB of text in one idx record
  const filler = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ p: i + 1000, o: 0, l: 1 })).join('\n') + '\n'
  writeFileSync(path.join(sd, 'progress.idx'), filler + JSON.stringify({ p: 7, text: huge }) + '\n' + JSON.stringify({ p: 8, text: 'after' }) + '\n')
  let text = ''
  let skip = 0
  for (let n = 0; n < 20; n++) {
    const [r] = read('event', sd, 7, skip).recs
    assert.equal(typeof r.text, 'string')
    text += r.text
    if (r.next == null) break
    skip = r.next
  }
  assert.equal(text, huge)
  assert.deepEqual(read('event', sd, 8).recs, [{ text: 'after' }])
})

test('a missing file is an error line and a non-zero exit, not a crash trace', () => {
  const r = read('fwd', path.join(dir, 'nope'), 0, 100)
  assert.equal(r.status, 2)
  assert.match(r.recs[0].error, /ENOENT/)
})

test('no mode exceeds OUT_MAX even for an enormous budget', () => {
  const evBig = mkdtempSync(path.join(dir, 'evcap-'))
  writeFileSync(path.join(evBig, 'progress.idx'), JSON.stringify({ p: 1, text: 'x'.repeat(5 * 1024 * 1024) }) + '\n')
  for (const args of [['fwd', transcript, 0, 50_000_000], ['back', transcript, SIZE, 50_000_000], ['chunk', transcript, 0, 50_000_000], ['event', evBig, 1]]) {
    const r = spawnSync('node', [helper, ...args.map(String)], { maxBuffer: 64 * 1024 * 1024 })
    assert.ok(r.stdout.length <= OUT_MAX, `${args[0]}: ${r.stdout.length}`)
    assert.equal(r.status, 0)
  }
})
