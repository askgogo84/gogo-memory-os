// Shopping comparison: a store whose page never loads is retried once, then reported plainly (25 Oct live:
// Flipkart "page.goto: Timeout 45000ms exceeded" three times in a row, ~3.5 min, then a vague
// "couldn't confirm the item and price."). Other stores' observed results are unchanged; nothing is invented.
// Offline. Run: npx --yes tsx scripts/verify-comparison-timeout-recovery.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic'
process.env.OPENAI_API_KEY ||= 'synthetic'

const pc = await import('../lib/commerce/price-comparison')
const { comparisonSummary } = await import('../lib/commerce/comparison-model')

const LIVE_ERROR = 'secure_browser_read_failed:page.goto: Timeout 45000ms exceeded. Call log: - navigating to "https://www.flipkart.com/apple-iphone-16-white-128-gb/p/itm09e9f0a0f5ca0", waiting until "domcontentloaded"'

// 1. Only a real navigation timeout is classified as one.
assert.equal(pc.isNavigationTimeout(LIVE_ERROR), true, 'the live 25 Oct error is a navigation timeout')
assert.equal(pc.isNavigationTimeout('secure_browser_read_failed:page.goto: net::ERR_NAME_NOT_RESOLVED'), false)
assert.equal(pc.isNavigationTimeout('browser_objective_unverified'), false)
assert.equal(pc.isNavigationTimeout('human_auth_required'), false)
assert.equal(pc.isNavigationTimeout(''), false)
assert.equal(pc.isNavigationTimeout(null), false)

// 2. A failed timeout row gets a plain, honest reason that names the wait and the attempts; nothing else changes.
const failed = { provider: 'flipkart', status: 'failed', reason: 'couldn’t confirm the item and price.', attempts: 1 } as any
const first = pc.withNavigationTimeout(failed, LIVE_ERROR)
assert.equal(first.status, 'failed', 'still failed: no price is invented')
assert.equal(first.navTimeout, true)
assert.match(first.reason, /didn’t load within 45 seconds/)
assert.match(first.reason, /tried once/)
assert.match(first.reason, /no price from this store/)
assert.equal(first.evidence, undefined)
assert.equal(first.sourceUrl, undefined)
assert.match(pc.withNavigationTimeout({ ...failed, attempts: 2 }, LIVE_ERROR).reason, /tried 2 times/)
// Other failures and other statuses are untouched.
assert.deepEqual(pc.withNavigationTimeout(failed, 'browser_objective_unverified'), failed)
const observed = { provider: 'amazon', status: 'observed', evidence: 'Apple iPhone 16 (128 GB) ₹69,900', sourceUrl: 'https://www.amazon.in/dp/X' } as any
assert.deepEqual(pc.withNavigationTimeout(observed, LIVE_ERROR), observed, 'an observed store is never rewritten')
const blocked = { provider: 'croma', status: 'blocked', needsInput: true, reason: 'it needs your delivery location or sign-in before it shows prices.' } as any
assert.deepEqual(pc.withNavigationTimeout(blocked, LIVE_ERROR), blocked)

// 3. Retry budget: a timeout gets one retry (2 reads), other failures keep 3.
assert.equal(pc.storeRetryLimit({ status: 'failed', navTimeout: true } as any), 2)
assert.equal(pc.storeRetryLimit({ status: 'failed' } as any), 3)
const retried = pc.retryFailedStores([
  { provider: 'flipkart', status: 'failed', navTimeout: true, attempts: 1, reason: 'x' },
  { provider: 'croma', status: 'failed', attempts: 1, reason: 'y' },
  { provider: 'amazon', ...observed },
] as any)
assert.equal(retried[0].status, 'pending', 'first timeout is retried once')
assert.equal(retried[0].attempts, 2)
assert.equal(retried[1].status, 'pending', 'an ordinary failure is retried as before')
assert.deepEqual(retried[2], { provider: 'amazon', ...observed }, 'observed store untouched')
const exhausted = pc.retryFailedStores([{ provider: 'flipkart', status: 'failed', navTimeout: true, attempts: 2, reason: 'x' }] as any)
assert.equal(exhausted[0].status, 'failed', 'a second timeout is final: no third 45-second wait')
const ordinarySecond = pc.retryFailedStores([{ provider: 'croma', status: 'failed', attempts: 2, reason: 'y' }] as any)
assert.equal(ordinarySecond[0].status, 'pending', 'ordinary failures still get a third read')
// A retried row keeps its lead URL, drops the stale reason and timeout flag.
const lead = pc.retryFailedStores([{ provider: 'flipkart', status: 'failed', navTimeout: true, attempts: 1, reason: 'x', leadUrl: 'https://www.flipkart.com/p/1' }] as any)[0]
assert.equal(lead.leadUrl, 'https://www.flipkart.com/p/1')
assert.equal(lead.reason, undefined)
assert.equal(lead.navTimeout, undefined)

// 4. The final report: three stores observed, Flipkart honestly missing.
const final = pc.withNavigationTimeout({ provider: 'flipkart', status: 'failed', attempts: 2 } as any, LIVE_ERROR)
const summary = comparisonSummary({ id: 'r', status: 'paused', title: 'iPhone 16 128GB', source: 'x', updated_at: '', metadata_json: { request: 'r', subject: 'iPhone 16 128GB', providers: [
  { provider: 'amazon', status: 'observed', evidence: 'Apple iPhone 16 (128 GB) ₹69,900', sourceUrl: 'https://www.amazon.in/dp/X', checkedAt: '2026-10-25T15:50:00Z' },
  final,
] } } as any)
assert.match(summary, /Flipkart: its page didn’t load within 45 seconds \(tried 2 times\), so I have no price from this store\./)
assert.match(summary, /Amazon[^\n]*observed/)
assert.doesNotMatch(summary, /Flipkart[^\n]*₹/, 'no Flipkart price appears')

// 5. Wiring: the live read path and the retry step both use these helpers.
const src = readFileSync(new URL('../lib/commerce/price-comparison.ts', import.meta.url), 'utf8')
assert.match(src, /withNavigationTimeout\(\s*\{\s*\.\.\.providerObservation\(/, 'readPriceComparison applies the timeout reason')
assert.match(src, /task\.metadata_json\.providers = retryFailedStores\(task\.metadata_json\.providers\)/, 'advance uses the timeout-aware retry budget')
assert.doesNotMatch(src, /row\.status === 'failed' && \(row\.attempts \|\| 1\) < MAX_STORE_ATTEMPTS/, 'the flat 3-read retry is gone')

console.log('Comparison timeout recovery: one retry for a page that never loads, then an honest no-price line; other stores unchanged')
