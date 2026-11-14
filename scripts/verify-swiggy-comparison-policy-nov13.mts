// Swiggy Integration Agreement (13 Nov 2026), clauses 4(iv), 4(xi), 6: Swiggy and Instamart stay out of price
// comparisons until Swiggy approves in writing (COMMERCE_SWIGGY_COMPARISON_APPROVED=true). Default = withheld.
delete process.env.COMMERCE_SWIGGY_COMPARISON_APPROVED
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as policy from '../lib/commerce/swiggy-policy.ts'
import * as intent from '../lib/agent/food-comparison-intent'
import {parsePriceComparison} from '../lib/commerce/comparison-model'

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }

// Policy: default withholds; only the exact string 'true' approves.
eq(policy.swiggyComparisonApproved(), false, 'default is not approved')
eq(policy.withheldComparisonProviders(['swiggy', 'zomato', 'instamart', 'zepto']), ['swiggy', 'instamart'], 'both Swiggy services withheld')
for (const v of ['TRUE', '1', 'yes', ' true']) { process.env.COMMERCE_SWIGGY_COMPARISON_APPROVED = v; eq(policy.swiggyComparisonApproved(), false, `"${v}" does not approve`) }
delete process.env.COMMERCE_SWIGGY_COMPARISON_APPROVED

// Parser, default mode.
const food = parsePriceComparison('Compare vegetarian burger delivery on Swiggy and Zomato')!
eq(food.providers, ['zomato'], 'Swiggy dropped from a food comparison')
eq(food.withheld, ['swiggy'], 'withheld Swiggy is reported')
const grocery = parsePriceComparison('Compare grocery prices for Amul Taaza 1 litre x1 and atta 1kg on Instamart, Zepto and Blinkit.')!
eq(grocery.providers, ['zepto', 'blinkit'], 'Instamart dropped from a grocery comparison')
eq(grocery.withheld, ['instamart'], 'withheld Instamart is reported')
const dish = parsePriceComparison('compare chicken biryani at Meghana Foods')
if (dish) eq(dish.providers.includes('swiggy' as any), false, 'dish-at-restaurant default drops Swiggy')
const shop = parsePriceComparison('compare iPhone 17 on Amazon and Flipkart')!
eq(shop.providers, ['amazon', 'flipkart'], 'electronics unaffected')
eq(shop.withheld, [], 'nothing withheld for electronics')
eq(parsePriceComparison('remind me to compare burger on swiggy and zomato'), null, 'non-comparison still not parsed')

// Approved mode restores the old behaviour exactly.
process.env.COMMERCE_SWIGGY_COMPARISON_APPROVED = 'true'
eq(parsePriceComparison('Compare vegetarian burger delivery on Swiggy and Zomato')!.providers, ['swiggy', 'zomato'], 'approved: Swiggy included')
eq(parsePriceComparison('Compare grocery prices for Amul Taaza 1 litre x1 and atta 1kg on Instamart, Zepto and Blinkit.')!.providers, ['instamart', 'zepto', 'blinkit'], 'approved: Instamart included')
delete process.env.COMMERCE_SWIGGY_COMPARISON_APPROVED

// Price comparison: an all-Swiggy request starts no browser run and says what was left out.
const pc = readFileSync('lib/commerce/price-comparison.ts', 'utf8')
const empty = pc.indexOf('if (!parsed.providers.length)'), insert = pc.indexOf("supabaseAdmin.from('agent_runs').insert(")
ok(empty > 0 && insert > empty, 'empty-provider reply comes before any run is created')
ok(/if \(!parsed\.providers\.length\) return \{[^}]*text: SWIGGY_ONLY_NOTE\}/.test(pc), 'empty-provider reply is the note with alternatives')
ok(policy.SWIGGY_ONLY_NOTE.startsWith(policy.SWIGGY_COMPARISON_NOTE) && /Zepto and Blinkit/.test(policy.SWIGGY_ONLY_NOTE), 'all-withheld reply offers a next step')
ok(pc.includes("(parsed.withheld.length ? '\\n\\n' + SWIGGY_COMPARISON_NOTE : '')"), 'partial comparisons carry the note')

// Food discovery (web search): default mode never searches swiggy.com and tells the person.
const searches: string[] = []
const rows: any[] = []
const db = {from(table: string) {
  let patch: any = null, insert: any = null
  const preds: Array<(r: any) => boolean> = []
  const resolve = () => {
    if (table === 'conversations') return {data: [], error: null}
    if (insert) { const r = {id: `run-${rows.length + 1}`, ...insert}; rows.unshift(r); return {data: [r], error: null} }
    const found = rows.filter(r => preds.every(p => p(r)))
    if (patch) for (const r of found) Object.assign(r, patch)
    return {data: found, error: null}
  }
  const q: any = {select() { return q }, eq(k: string, v: any) { preds.push(r => r[k] === v); return q }, order() { return q }, limit() { return q },
    insert(r: any) { insert = r; return q }, update(p: any) { patch = p; return q },
    async maybeSingle() { const r = resolve(); return {...r, data: r.data?.[0] || null} }, async single() { return q.maybeSingle() },
    then(a: any, b: any) { return Promise.resolve(resolve()).then(a, b) }}
  return q
}}
const compiled = ts.transpileModule(readFileSync('lib/agent/food-comparison.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const exports: any = {}
runInNewContext(compiled, {exports, Date, URL, console, process, require(name: string) {
  if (name === '@/lib/supabase-admin') return {supabaseAdmin: db}
  if (name === './food-comparison-intent') return intent
  if (name === '@/lib/commerce/swiggy-policy') return policy
  if (name === '@/lib/commerce/task') return {commerceTaskLink: (id: string) => 'https://app.askgogo.in/dashboard/commerce?run=' + id}
  if (name === '@/lib/web-search') return {searchWebResults: async (query: string) => { searches.push(query); return [] }}
  throw new Error(`Unexpected dependency ${name}`)
}})
const res = await exports.tryFoodComparison({telegramId: 42, text: 'Find me a veg burger near 560086, compare the delivery apps', surface: 'whatsapp'})
ok(res && searches.length > 0, 'food discovery ran')
ok(searches.every(q => !/swiggy\.com/.test(q)), 'no swiggy.com search in default mode')
ok(!/^Swiggy:/m.test(res.text), 'no Swiggy group in the reply')
ok(res.text.includes(policy.SWIGGY_COMPARISON_NOTE), 'reply says Swiggy was left out')

// Grocery comparison task summary.
const g = readFileSync('lib/agent/grocery-comparison.ts', 'utf8')
ok(/swiggyComparisonApproved\(\)\s*\?/.test(g) && /on Zepto or Blinkit\. ' \+ SWIGGY_COMPARISON_NOTE/.test(g), 'grocery summary leaves Instamart out by default')

// Review fixes (PR #1515): browser route, task page, old runs, store fallback, finished summary.
const route = readFileSync('app/api/commerce/tasks/[runId]/browser/route.ts', 'utf8')
const gate = route.indexOf("withheldComparisonProviders([input.provider]).length"), runCall = route.indexOf('runCommerceBrowserRead(actor')
ok(gate > 0 && gate < runCall && /provider_withheld'\},\{status:403\}/.test(route), 'browser route refuses Swiggy/Instamart before any browser run')
const page = readFileSync('app/dashboard/(app)/commerce/page.tsx', 'utf8')
ok(page.includes("{!(task.withheldBrowserProviders||[]).includes(read.provider)&&<a href={read.taskUrl}"), 'old withheld browser reads lose their task link')
ok(/\.filter\(\(\[key\]\)=>!\(task\.withheldBrowserProviders\|\|\[\]\)\.includes\(key\)\)/.test(page), 'task page hides withheld browser buttons')
ok(readFileSync('lib/commerce/task.ts', 'utf8').includes("withheldBrowserProviders: withheldComparisonProviders(['swiggy', 'instamart'])"), 'task view carries the server-side decision')
const pcMod = await import('../lib/commerce/price-comparison.ts')
const old = pcMod.withholdRows([{provider: 'swiggy', status: 'pending'}, {provider: 'zomato', status: 'pending'}, {provider: 'instamart', status: 'failed', attempts: 1}, {provider: 'swiggy', status: 'observed', evidence: 'x'}] as any)
eq(old.map((r: any) => r.status), ['blocked', 'pending', 'blocked', 'observed'], 'old runs: pending/failed Swiggy rows closed, checked rows kept')
eq(old[0].reason, policy.SWIGGY_COMPARISON_NOTE, 'closed row says why')
eq(pcMod.retryFailedStores([{provider: 'instamart', status: 'failed', attempts: 1}] as any)[0].status, 'failed', 'withheld failed row is not re-queued')
eq(pcMod.retryFailedStores([{provider: 'zepto', status: 'failed', attempts: 1}] as any)[0].status, 'pending', 'other stores still retry')
const zomatoOnly: any = {providers: [{provider: 'zomato', status: 'blocked'}]}
eq(pcMod.withStoreFallback(zomatoOnly).length, 1, 'a blocked Zomato-only food run never falls back to electronics stores')
eq(pcMod.withStoreFallback({providers: [{provider: 'amazon', status: 'blocked'}]}).map((r: any) => r.provider), ['amazon', 'flipkart', 'croma', 'reliance'], 'electronics fallback unchanged')
const model = readFileSync('lib/commerce/comparison-model.ts', 'utf8')
ok(/withheldComparisonProviders\(\['swiggy'\]\)\.length && !task\.metadata_json\.providers\.some\(row => row\.provider === 'swiggy' && row\.status === 'observed'\) \? 'Want another dish\? Send it like “compare paneer butter masala at Empire on Zomato for 560086”/.test(model), 'finished food summary no longer suggests Swiggy')

console.log(`PASS verify-swiggy-comparison-policy-nov13: ${checks} checks`)
