import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 16 Oct: comparisons took 5-10 minutes (one store per cron minute) and the reply carried a dashboard link.
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const pc = read('lib/commerce/price-comparison.ts')
// Electronics stores run at the same time in their own browser lanes; grocery/food share one browser, one at a time.
assert.match(pc, /PARALLEL_COMPARISON_PROVIDERS = new Set\(\['amazon', 'flipkart', 'croma', 'reliance'\]\)/)
assert.match(pc, /row\.status === 'pending' && \(PARALLEL_COMPARISON_PROVIDERS\.has\(row\.provider\) \|\| !sharedBusy\)/)
assert.match(pc, /const laneKey = 'commerce-browser:' \+ owner \+ \(parallel \? ':' \+ provider : ''\)/)
// Every read-modify-write of the saved comparison holds the state lease, so parallel lanes never overwrite each other.
assert.match(pc, /const key = 'comparison-state:' \+ id/)
assert.equal((pc.match(/withComparisonState\(id, async/g) || []).length, 2, 'claim and finish both hold the state lease')
assert.match(pc, /Promise\.all\(Array\.from\(\{length: Math\.max\(1, lanes\)\}/)
// Started at once on the internal route, not on the next cron minute.
assert.match(pc, /await triggerComparisonRun\(String\(\(data as any\)\.id\)\)/)
const route = read('app/api/agent/approved-browser/route.ts')
assert.match(route, /if \(body\?\.comparison === true\) \{/)
assert.match(route, /runComparisonNow\(runId\)/)
const worker = read('lib/agent/approved-browser-worker.ts')
assert.match(worker, /export async function triggerComparisonRun[\s\S]{0,700}evaluateAgentExecutionPolicy\(/, 'policy-gated')
assert.match(read('app/api/cron/price-comparisons/route.ts'), /await advancePriceComparisonAll\(actor, row\.id\)/)
// Each electronics store gets its own browser owner; grocery keeps the shared commerce browser.
const bc = read('lib/agent/browser-command.ts')
assert.match(bc, /function linkedBrowserOwner\(userId:string,meta:any\)/)
assert.match(bc, /const browserOwner=persistentCommerce\?linkedBrowserOwner\(/)
assert.match(bc, /const browserOwner=linked\?linkedBrowserOwner\(params\.actor\.userId,meta\)/)
// Quick look: labelled as a web search, never as confirmed; its product page is reused as the start.
assert.match(pc, /Quick look from a web search \(not yet confirmed on the store pages\):/)
assert.match(pc, /const known = next\.leadUrl && comparisonSource\(next\.provider, next\.leadUrl\)/)
// No dashboard link in replies or deliveries.
assert.doesNotMatch(pc, /'\\n\\nSaved comparison: '/)
assert.doesNotMatch(read('lib/commerce/comparison-delivery.ts'), /Full saved report/)
// Crisp summary: one line per store, the lowest listed price, no jargon.
const { comparisonWhatsAppSummary } = await import('../lib/commerce/comparison-model')
const row = (provider: string, url: string, evidence: string) => ({ provider, status: 'observed', checkedAt: new Date().toISOString(), sourceUrl: url, evidence })
const text = comparisonWhatsAppSummary({ metadata_json: { subject: 'iPhone 16', request: 'x', providers: [
  row('flipkart', 'https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itm3c9366c8c93cb', 'Apple iPhone 16 (128 GB Storage) Online at Best Price On Flipkart.com\n₹69,900 +₹299 Protect Promise Fee'),
  row('croma', 'https://www.croma.com/apple-iphone-16-128gb-black-/p/309690', 'Buy Apple iPhone 16 (128GB, Black) Online - Croma\n₹67,900.00 (Incl. all Taxes)'),
] } } as any)
assert.match(text, /^\*iPhone 16\*\n\n• \*Flipkart\*: ₹69,900 \+ ₹299 Protect Promise Fee · checked [^\n]+\n  Apple iPhone 16 \(128 GB Storage\)\n  https:\/\/www\.flipkart\.com\//)
assert.match(text, /• \*Croma\*: ₹67,900 · checked [^\n]+\n  Apple iPhone 16 \(128GB, Black\)\n/)
assert.match(text, /Lowest listed price: Croma, ₹67,900\./)
assert.doesNotMatch(text, /app\.askgogo\.in|read-only|verifiable|provider page/)
console.log('verify-comparison-fast: parallel lanes, immediate start, quick look and crisp reply ok')
