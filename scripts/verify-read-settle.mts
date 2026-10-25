import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 16 Oct live: signed in to Swiggy, the My Account page was read before its orders loaded.
const sc = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const i = sc.indexOf("const pageLoad=await pageReadiness.read(payload.mode==='read');")
const j = sc.indexOf('const out=await model(page);', i)
assert.ok(i > 0 && j > i)
const settle = sc.slice(i, j)
assert.match(settle, /if\(payload\.mode==='read'&&typeof page\.waitForLoadState==='function'/)
assert.match(settle, /waitForLoadState\('networkidle',\{timeout:6000\}\)/)
assert.match(settle, /for\(let i=0;i<12&&steady<3;i\+\+\)/, 'bounded text-stability wait')
console.log('verify-read-settle: read waits for the page to settle')
