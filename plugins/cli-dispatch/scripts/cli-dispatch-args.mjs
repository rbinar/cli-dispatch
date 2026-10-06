#!/usr/bin/env node
// Splits a slash command's raw $ARGUMENTS text into words, shell-style quoting but NO expansion:
// whitespace separates; '...' is literal; "..." is literal except \" and \; a backslash outside
// quotes escapes the next char. $, backticks, globs and ~ are never special. Words are written
// NUL-separated to stdout. An unterminated quote exits 2.
import fs from 'node:fs'

export function splitArgs(text) {
  const words = []
  let cur = ''
  let inWord = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"') {
      const end = (() => {
        for (let j = i + 1; j < text.length; j++) {
          if (c === '"' && text[j] === '\\' && (text[j + 1] === '"' || text[j + 1] === '\\')) { j++; continue }
          if (text[j] === c) return j
        }
        return -1
      })()
      if (end < 0) throw new Error(`unterminated ${c} quote in arguments`)
      let body = text.slice(i + 1, end)
      if (c === '"') body = body.replace(/\\(["\\])/g, '$1')
      cur += body
      inWord = true
      i = end
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[++i]
      inWord = true
    } else if (/\s/.test(c)) {
      if (inWord) { words.push(cur); cur = ''; inWord = false }
    } else {
      cur += c
      inWord = true
    }
  }
  if (inWord) words.push(cur)
  return words
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli-dispatch-args.mjs')) {
  try {
    const words = splitArgs(fs.readFileSync(0, 'utf8'))
    process.stdout.write(words.map((w) => w + '\0').join(''))
  } catch (e) {
    process.stderr.write(`cli-dispatch: ${e.message}\n`)
    process.exit(2)
  }
}
