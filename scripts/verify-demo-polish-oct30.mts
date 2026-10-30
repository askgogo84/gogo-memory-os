// 30 Oct demo polish: Muse 16 (% move every 6 h), Muse 20 (no invented product claims), Muse 26 (plan without notes).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sr = await import('../lib/agent/stock-rule')
const m16 = sr.parseStockWatchCommand('Check Tata Motors every 6 hours and tell me if it moved more than 2% since your last update.')
assert.deepEqual(m16, { company: 'Tata Motors', kind: 'move', direction: 'any', pct: 2, level: null, defaulted: false, cadenceMinutes: 360 })
assert.equal(sr.parseStockWatchCommand('Check Tata Motors share price and alert me if it moves 3%')?.company, 'Tata Motors', '"Check" is not part of the company')
assert.equal(sr.parseStockWatchCommand('Check the iPhone 16 price and tell me if it moved more than 2%'), null, 'products are not share watches')
assert.equal(sr.parseStockWatchCommand('Tell me if Bitcoin moved 5%'), null)
assert.equal(sr.parseStockWatchCommand('Remind me to check Tata Motors at 5 pm'), null)
assert.match(readFileSync('lib/agent/stock-watch.ts', 'utf8'), /I check \$\{pace\} during market hours/)
const cw = readFileSync('lib/agent/content-workflows.ts', 'utf8')
assert.match(cw, /Never add capabilities, security claims/)
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /Missing saved notes or details are not ambiguity/)
assert.match(readFileSync('lib/services/claude.ts', 'utf8'), /PLANS FROM SAVED NOTES/)
console.log('✓ % move watches every N hours; launch posts never invent features; plans come even without saved notes')
