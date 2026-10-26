// 26 Oct (owner): "Tata Motors share price watch" became a news watch that sent news links. A share-price watch reads
// a live exchange quote and alerts only on the person's move/level rule. Offline (fake fetch).
// Run: npx --yes tsx scripts/verify-stock-watch-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateStockRule, isStockWatchPhrasing, normalizeStockRule, parseStockWatchCommand, stockAlertText, stockStateFrom } from '../lib/agent/stock-rule'
import { fetchStockQuote, resolveStockSymbols } from '../lib/agent/stock-quote'

// ── phrasing ──
for (const t of ['Watch Tata Motors share price', 'alert me if Infosys stock price drops 10%', 'track HDFC Bank shares, tell me if it moves 5%', 'Notify me when Reliance share price goes below 1200'])
  assert.equal(isStockWatchPhrasing(t), true, t)
for (const t of ['watch iPhone 16 stock at Croma', 'tell me when PS5 is back in stock', 'alert me if gold rate drops 10%', 'what is the stock market doing', 'Tata Motors share price'])
  assert.equal(isStockWatchPhrasing(t), false, t)

// ── parsing ──
const p1 = parseStockWatchCommand('Watch Tata Motors share price and tell me if it drops or rises by 10%')!
assert.deepEqual([p1.company, p1.kind, p1.direction, p1.pct, p1.defaulted], ['Tata Motors', 'move', 'any', 10, false])
const p2 = parseStockWatchCommand('alert me if Infosys stock price drops 7%')!
assert.deepEqual([p2.company, p2.direction, p2.pct], ['Infosys', 'down', 7])
const p3 = parseStockWatchCommand('Notify me when Reliance share price goes below ₹1,200')!
assert.deepEqual([p3.company, p3.kind, p3.direction, p3.level], ['Reliance', 'level', 'below', 1200])
const p4 = parseStockWatchCommand('watch TMPV share price')!
assert.deepEqual([p4.company, p4.pct, p4.defaulted, p4.direction], ['TMPV', 5, true, 'any'], 'no size: 5% either way, and said so')
assert.equal(parseStockWatchCommand('watch Tata Motors share price 80%'), null, 'implausible move refused')

// ── rule normalisation ──
const rule = normalizeStockRule({ symbol: 'TMPV.NS', name: 'Tata Motors Passenger Vehicles', kind: 'move', direction: 'any', pct: 10, baseline: 400 })!
assert.equal(rule.exchange, 'NSE')
assert.equal(normalizeStockRule({ symbol: 'TMPV', kind: 'move', direction: 'any', pct: 10 }), null, 'exchange suffix required')
assert.equal(normalizeStockRule({ symbol: 'X.NS', kind: 'level', direction: 'any', level: 10 }), null)

// ── evaluation: moves re-baseline after each alert; levels alert once and re-arm ──
let st = stockStateFrom({}, rule)
let v = evaluateStockRule(rule, 430, st); assert.equal(v.notify, false); assert.equal(v.reason, 'within_range')
v = evaluateStockRule(rule, 359.9, st); assert.equal(v.notify, true, '-10.03% alerts'); assert.equal(v.next.baseline, 359.9)
assert.match(stockAlertText(rule, 359.9, v, '26 Oct, 2:30 pm', 400), /down 10\.0% from ₹400\.00, past your 10% alert\. I'll alert again if it moves another 10% from ₹359\.90/)
st = v.next
assert.equal(evaluateStockRule(rule, 370, st).notify, false, 'no repeat alert for the same move')
const down = normalizeStockRule({ symbol: 'INFY.NS', name: 'Infosys', kind: 'move', direction: 'down', pct: 5, baseline: 1500 })!
assert.equal(evaluateStockRule(down, 1600, stockStateFrom({}, down)).notify, false, 'a rise does not trigger a drop rule')
assert.equal(evaluateStockRule(down, 1425, stockStateFrom({}, down)).notify, true)
const lvl = normalizeStockRule({ symbol: 'RELIANCE.NS', name: 'Reliance Industries', kind: 'level', direction: 'below', level: 1200, baseline: 1300 })!
let ls = stockStateFrom({}, lvl)
v = evaluateStockRule(lvl, 1199, ls); assert.equal(v.notify, true); ls = v.next
assert.equal(evaluateStockRule(lvl, 1150, ls).notify, false, 'still below: no repeat')
v = evaluateStockRule(lvl, 1250, ls); assert.equal(v.reason, 'rearmed'); ls = v.next
assert.equal(evaluateStockRule(lvl, 1190, ls).notify, true, 'crossing again after re-arm alerts again')
assert.equal(evaluateStockRule(rule, NaN, st).notify, false, 'no price, no alert')

// ── quote source validation (fake fetch) ──
const json = (o: any, status = 200) => (async () => new Response(JSON.stringify(o), { status })) as any
const matches = await resolveStockSymbols('tata motors', json({ quotes: [
  { symbol: 'TMPV.NS', quoteType: 'EQUITY', longname: 'Tata Motors Passenger Vehicles Limited' },
  { symbol: 'TMPV.BO', quoteType: 'EQUITY', longname: 'Tata Motors Passenger Vehicles Limited' },
  { symbol: 'TMCV.NS', quoteType: 'EQUITY', longname: 'Tata Motors Limited' },
  { symbol: 'TTM', quoteType: 'EQUITY', longname: 'Tata Motors ADR' },
  { symbol: 'TATAMTRDVR.NS', quoteType: 'MUTUALFUND', longname: 'not equity' },
] }))
assert.deepEqual(matches.map(m => m.symbol), ['TMPV.NS', 'TMCV.NS'], 'NSE preferred, one per company, Indian equities only')
const q = await fetchStockQuote('TMPV.NS', json({ chart: { result: [{ meta: { symbol: 'TMPV.NS', currency: 'INR', regularMarketPrice: 402.35, chartPreviousClose: 398.1, regularMarketTime: 1793001600 } }] } }))
assert.equal(q?.price, 402.35); assert.equal(q?.previousClose, 398.1)
assert.equal(await fetchStockQuote('TMPV.NS', json({ chart: { result: [{ meta: { symbol: 'TMPV.NS', currency: 'USD', regularMarketPrice: 5 } }] } })), null, 'non-INR rejected')
assert.equal(await fetchStockQuote('TMPV.NS', json({ chart: { result: [{ meta: { symbol: 'OTHER.NS', currency: 'INR', regularMarketPrice: 5 } }] } })), null, 'symbol mismatch rejected')
assert.equal(await fetchStockQuote('../etc', json({})), null, 'bad symbol never fetched')

// ── wiring ──
const w = readFileSync(new URL('../lib/agent/watchers.ts', import.meta.url), 'utf8')
assert.ok(w.indexOf('if (condition.stockRule) return await processStockCheck') < w.indexOf('const allowance = await checkCostAllowance(telegramId, COST_ESTIMATES_PAISE.web_search_basic)\n  const currentQuiet'), 'quote checks are not deferred by the search budget')
const wa = readFileSync(new URL('../lib/agent/whatsapp-bridge.ts', import.meta.url), 'utf8')
assert.ok(wa.indexOf("tryCreateStockWatchFromCommand({ actor, surface:'whatsapp'") < wa.indexOf('tryCreateWebWatchFromCommand({ actor, surface:'), 'share-price asks are claimed before generic web/news watches')
const d = readFileSync(new URL('../lib/agent/watch-dedupe.ts', import.meta.url), 'utf8')
assert.match(d, /key: `stock:\$\{String\(c\.stockRule\.symbol\)\.toUpperCase\(\)\}:/)
console.log('Share-price watches: live NSE quote, move/level rules decided by code, never a news watch')

// ── review round 1 ──
for (const t of ['Alert me if Infosys stock drops 5%', 'alert me when Eternal stock rises above 300', "Notify me if Tata Motors' share price falls below 600", 'alert me when Adani Ports stock crosses 1,500'])
  assert.ok(parseStockWatchCommand(t), `real share-price ask: ${t}`)
assert.equal(parseStockWatchCommand("Notify me if Tata Motors' share price falls below 600")!.company, 'Tata Motors', 'possessive apostrophe keeps the name')
assert.equal(parseStockWatchCommand('alert me when Adani Ports stock crosses 1,500')!.level, 1500)
for (const t of ['tell me if Divya shares the doc', 'let me know when Nithin shares the deck', 'tell me how much my shares are worth', 'keep an eye on stock of rice at home', 'remind me at 5pm to watch the Tata Motors share price'])
  assert.equal(parseStockWatchCommand(t), null, `not a share-price watch: ${t}`)
// A level already past starts disarmed: no false "crossed" alert on the first check.
const past = normalizeStockRule({ symbol: 'ETERNAL.NS', name: 'Eternal', kind: 'level', direction: 'above', level: 300, baseline: 320, startArmed: false })!
let ps = stockStateFrom({}, past)
assert.equal(evaluateStockRule(past, 330, ps).notify, false, 'already above at creation: silent')
let pv = evaluateStockRule(past, 290, ps); assert.equal(pv.reason, 'rearmed'); ps = pv.next
assert.equal(evaluateStockRule(past, 305, ps).notify, true, 'alerts after it comes back and crosses again')
const sw = readFileSync(new URL('../lib/agent/stock-watch.ts', import.meta.url), 'utf8')
assert.match(sw, /replaced_by_share_price_watch/, 'the older news watch about the company is retired')
assert.match(sw, /Yahoo Finance; can lag the exchange by a few minutes/, 'source named honestly')
assert.match(d, /key: `stock:\$\{String\(c\.stockRule\.symbol\)\.toUpperCase\(\)\}:\$\{c\.stockRule\.kind\}:\$\{c\.stockRule\.direction\}`/, 'above and below rules on one stock coexist')
const { nseMarketOpen } = await import('../lib/agent/stock-rule')
assert.equal(nseMarketOpen(new Date('2026-10-26T05:00:00Z')), true, 'Mon 10:30 IST open')
assert.equal(nseMarketOpen(new Date('2026-10-25T05:00:00Z')), false, 'Sunday closed')
assert.equal(nseMarketOpen(new Date('2026-10-26T13:00:00Z')), false, 'Mon 18:30 IST closed')
console.log('Share-price review fixes: real asks claimed, verbs/portfolio/reminders left alone, no false level alert')
