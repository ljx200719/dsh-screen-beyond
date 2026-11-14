// 方便地调用注入壳：node sbc-eval.mjs @codeFile  或  node sbc-eval.mjs "<code>"
import fs from 'node:fs'
const arg = process.argv[2]
if (!arg) { console.error('usage: node sbc-eval.mjs @file | "<code>"'); process.exit(1) }
const code = arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8') : arg
const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), 25000)
try {
  const r = await fetch('http://127.0.0.1:3057/eval', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: ac.signal,
  })
  clearTimeout(timer)
  console.log(await r.text())
} catch (e) {
  clearTimeout(timer)
  console.error('EVAL ERR: ' + String((e && e.message) || e))
  process.exit(2)
}
