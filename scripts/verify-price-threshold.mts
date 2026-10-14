// Wajo benchmark (14 Oct) acceptance: a watch "daily, listed price strictly below ₹24,000, exclude
// bank/card/exchange offers, never buy, otherwise silent". The old search watcher alerted on any
// relevant result, so a ₹25,000 listing with ₹3,000 cashback could alert. The rule is now numeric.
import assert from 'node:assert/strict'
const {
  parseMoneyAmount, extractPrices, evaluatePriceRule, decidePriceAlert, INITIAL_PRICE_STATE,
  appendPriceRun, summarizePriceRuns, priceRunLine, normalizePriceRule, PRICE_RUN_HISTORY,
  assessPriceCheck, buildPriceRun, priceStateFrom, priceAlertText,
} = await import('../lib/agent/price-threshold.ts')

import type { PriceRule } from '../lib/agent/price-threshold.ts'
const rule: PriceRule = { threshold: 24000, comparison: 'below', offers: 'excluded' }
const verdict = (text: string, r = rule) => evaluatePriceRule(r, extractPrices(text))

// Amounts are read from the way people write them.
assert.equal(parseMoneyAmount('₹24,000'), 24000)
assert.equal(parseMoneyAmount('Rs. 23,500'), 23500)
assert.equal(parseMoneyAmount('24000'), 24000)
assert.equal(parseMoneyAmount('₹24k'), 24000)
assert.equal(parseMoneyAmount('1.2 lakh'), 120000)
assert.equal(parseMoneyAmount('₹1,29,900/-'), 129900)
assert.equal(parseMoneyAmount('cheap'), null)

// Project Amber: A = ₹25,000 plus ₹3,000 cashback; B = ₹23,500. Only B is below ₹24,000.
const a = verdict('Phone A: price ₹25,000. Get ₹3,000 cashback with bank card')
assert.deepEqual([a.action, a.reason, a.observed], ['silent', 'not_below', 25000])
const b = verdict('Phone B: price ₹23,500')
assert.deepEqual([b.action, b.reason, b.observed], ['alert', 'below_threshold', 23500])

// Strictly below: exactly the threshold is silent.
assert.equal(verdict('Sony WH-1000XM5 ₹24,000').action, 'silent')
assert.equal(verdict('Sony WH-1000XM5 ₹23,999').action, 'alert')

// Offers excluded: an effective price after offers does not count; savings, MRP and EMI never do.
assert.equal(verdict('Sony WH-1000XM5 ₹22,990 with bank offer').reason, 'no_price')
assert.equal(verdict('Effective price ₹22,490 after cashback').reason, 'no_price')
assert.equal(verdict('Price ₹24,990 (MRP ₹34,990). Save ₹10,000').action, 'silent')
assert.equal(verdict('Price ₹24,990 (MRP ₹34,990)').observed, 24990)
assert.equal(verdict('No cost EMI from ₹2,100/month').reason, 'no_price')
assert.equal(verdict('Price ₹22,490. Save ₹3,500').action, 'alert')
// Offers included: the effective price counts, an instalment still does not.
const incl = { ...rule, offers: 'included' as const }
assert.equal(verdict('Sony WH-1000XM5 ₹26,990, ₹22,990 with bank offer', incl).action, 'alert')
assert.equal(verdict('No cost EMI from ₹2,100/month', incl).reason, 'no_price')
// A far-too-low amount is an accessory or typo, not the product.
assert.equal(verdict('Sony WH-1000XM5 case ₹999').reason, 'no_price')
// No currency marker, no price: nothing is guessed.
assert.equal(verdict('Sony WH-1000XM5 review: best noise cancelling headphones').reason, 'no_price')

// Notification policy: first alert, silence on the same price, new low, re-arm after recovery.
let s = INITIAL_PRICE_STATE
const step = (text: string) => { const d = decidePriceAlert(s, verdict(text)); s = d.next; return d }
assert.deepEqual([step('₹23,500').notify, 'first_alert'], [true, 'first_alert'])
assert.equal(step('₹23,500').reason, 'already_alerted')
assert.equal(step('₹23,500').notify, false)
const low = step('₹23,100'); assert.deepEqual([low.notify, low.reason], [true, 'new_low'])
assert.equal(step('₹23,100').notify, false)
assert.equal(step('₹25,000').reason, 'not_below')
const again = step('₹23,400'); assert.deepEqual([again.notify, again.reason], [true, 're_armed'])
assert.equal(step('no price here').reason, 'no_price')

// One ledger: bounded, and the summary agrees with the entries.
let runs: any[] = []
const at = '2026-10-14T03:30:00.000Z'
runs = appendPriceRun(runs, { at, outcome: 'sent_nothing', observed: 25000, kind: 'listed', reason: 'not_below', source: 'amazon.in' })
runs = appendPriceRun(runs, { at, outcome: 'alert', observed: 23500, kind: 'listed', reason: 'first_alert', source: 'amazon.in' })
runs = appendPriceRun(runs, { at, outcome: 'no_price_found', observed: null, kind: null, reason: 'no_price', source: null })
assert.deepEqual({ ...summarizePriceRuns(runs), last: undefined }, { checks: 3, alerts: 1, silent: 1, noPrice: 1, last: undefined })
for (let i = 0; i < 60; i++) runs = appendPriceRun(runs, { at, outcome: 'sent_nothing', observed: 25000, kind: 'listed', reason: 'not_below', source: null })
assert.equal(runs.length, PRICE_RUN_HISTORY)

// Rule normalisation: a missing or non-numeric threshold is not a rule.
assert.equal(normalizePriceRule({ threshold: 'abc' }), null)
assert.deepEqual(normalizePriceRule({ threshold: 24000, offers: 'included' }), { threshold: 24000, comparison: 'below', offers: 'included' })
assert.equal(normalizePriceRule({ threshold: 24000 })!.offers, 'excluded')

// One whole check, as the watcher runs it: the Amber results, day by day.
const day1 = [{ title: 'Phone A', snippet: 'Price ₹25,000. Get ₹3,000 cashback' }, { title: 'Phone B', snippet: 'Price ₹23,500' }]
let st = priceStateFrom({})
const c1 = assessPriceCheck(rule, st, day1)
assert.equal(c1.pick, 1)
assert.equal(c1.decision!.reason, 'first_alert')
st = c1.decision!.next
const run1 = buildPriceRun({ now: new Date('2026-10-14T03:30:00Z'), eligibleCount: 2, check: c1, sent: true, source: 'amazon.in' })
assert.deepEqual([run1.outcome, run1.observed, run1.reason], ['alert', 23500, 'first_alert'])
// Day 2: the same price again must not message.
const c2 = assessPriceCheck(rule, st, [{ title: 'Phone B', snippet: 'Price ₹23,500' }])
assert.equal(c2.pick, null)
const run2 = buildPriceRun({ now: new Date('2026-10-15T03:30:00Z'), eligibleCount: 1, check: c2, sent: false })
assert.deepEqual([run2.outcome, run2.reason, run2.observed], ['sent_nothing', 'already_alerted', 23500])
// Day 3: only the above-threshold listing: silent, observed price recorded.
const c3 = assessPriceCheck(rule, st, [{ title: 'Phone A', snippet: 'Price ₹25,000. Get ₹3,000 cashback' }])
assert.equal(c3.pick, null)
assert.deepEqual([c3.verdict!.reason, c3.verdict!.observed], ['not_below', 25000])
st = c3.decision!.next
assert.equal(st.armed, true)
// No relevant result and no stated price are different ledger outcomes.
assert.equal(buildPriceRun({ now: new Date(), eligibleCount: 0, check: assessPriceCheck(rule, st, []), sent: false }).outcome, 'no_relevant_result')
assert.equal(buildPriceRun({ now: new Date(), eligibleCount: 1, check: assessPriceCheck(rule, st, [{ title: 'Sony review' }]), sent: false }).outcome, 'no_price_found')
// A send that the cooldown held back is recorded as silent with its reason, and state is unchanged.
const held = buildPriceRun({ now: new Date(), eligibleCount: 1, check: assessPriceCheck(rule, priceStateFrom({}), [{ title: 'B', snippet: '₹23,000' }]), sent: false, gateReason: 'cooldown' })
assert.deepEqual([held.outcome, held.reason], ['sent_nothing', 'cooldown'])
assert.deepEqual(priceStateFrom({ lastAlertPrice: 23500, priceArmed: false }), { armed: false, lastAlertPrice: 23500 })
// The alert says what it saw, where, and that it is not store-verified.
const text = priceAlertText({ title: 'Phone B', url: 'https://www.amazon.in/dp/x', host: 'amazon.in', observed: 23500, rule, at: new Date('2026-10-14T03:30:00Z') })
assert.match(text, /₹23,500 is below your ₹24,000/)
assert.match(text, /not counted/)
assert.match(text, /not confirmed on the store page/)
assert.match(text, /never buy/i)

console.log('Price threshold: strict below, offers excluded, equality silent, deterministic alert policy, one run ledger')

// The ledger is readable by the person: what the rule is, what each check found, and the last result.
const lineRule: PriceRule = { threshold: 25000, comparison: 'below', offers: 'excluded' }
assert.match(priceRunLine(undefined, lineRule), /Alert when the price is below ₹25,000\. No check has finished yet\./)
const ledger = [
  { at: '2026-10-14T09:00:00Z', outcome: 'sent_nothing', observed: 27990, kind: 'price', reason: 'not_below', source: 'a.in' },
  { at: '2026-10-14T10:00:00Z', outcome: 'no_price_found', observed: null, kind: null, reason: 'no_price', source: null },
  { at: '2026-10-14T11:00:00Z', outcome: 'alert', observed: 24500, kind: 'price', reason: 'first_alert', source: 'a.in' },
] as any
const ledgerLine = priceRunLine(ledger, lineRule)
assert.match(ledgerLine, /3 checks, 1 alert sent, 1 at or above the limit, 1 with no price found\./)
assert.match(ledgerLine, /Last check .* IST: alert sent at ₹24,500\./)
assert.match(priceRunLine(ledger.slice(0, 1), lineRule), /1 check, 0 alerts sent, 1 at or above the limit\. Last check .*: ₹27,990, not below the limit\./)
console.log('price run ledger is readable in plain words')
