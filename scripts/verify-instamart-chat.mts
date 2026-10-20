// Regression: "Order milk on Swiggy Instamart" from dashboard chat / WhatsApp reached same-brain ("I can't place
// orders from chat") although the user had Swiggy connected. The chat entry point must list three in-stock
// options from the connected account, and bind a 1/2/3 reply ONLY while that list is waiting, adding that exact
// item once through the durable cart executor. No order, no payment, no blind retry.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as providers from '../lib/commerce/providers'
import * as addresses from '../lib/commerce/addresses'
import * as reads from '../lib/commerce/swiggy-read'
import * as evidence from '../lib/commerce/evidence'

process.env.NEXT_PUBLIC_APP_URL = 'https://app.askgogo.in'

// ---- In-memory supabase over the two tables this flow touches ----
type Row = Record<string, any>
const tables: Record<string, Row[]> = {agent_runs: [], conversations: []}
let seq = 0, clock = 0
const stamp = () => new Date(clock = Math.max(Date.now(), clock + 1)).toISOString()
const db = {from(table: string) {
  assert.ok(table in tables, 'unexpected table ' + table)
  const filters: Array<(r: Row) => boolean> = []
  let patch: Row | null = null, insertRows: Row[] | null = null, order: [string, boolean] | null = null, limit = Infinity
  const rows = () => {
    let out = tables[table].filter(r => filters.every(f => f(r)))
    if (order) { const [k, asc] = order; out = [...out].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)) }
    return out.slice(0, limit)
  }
  const run = (): {data: any; error: any} => {
    if (insertRows) {
      const made = insertRows.map(r => ({id: 'run-' + (++seq), created_at: stamp(), ...structuredClone(r), ...(r.updated_at ? {updated_at: stamp()} : {})}))
      tables[table].push(...made)
      return {data: structuredClone(made), error: null}
    }
    if (patch) {
      const hit = rows()
      for (const r of hit) Object.assign(r, structuredClone(patch), patch.updated_at ? {updated_at: stamp()} : {})
      return {data: structuredClone(hit), error: null}
    }
    return {data: structuredClone(rows()), error: null}
  }
  const q: any = {
    select() { return q }, insert(r: Row | Row[]) { insertRows = Array.isArray(r) ? r : [r]; return q },
    update(p: Row) { patch = p; return q },
    eq(k: string, v: any) { filters.push(r => r[k] === v); return q },
    order(k: string, o: any) { order = [k, o?.ascending !== false]; return q },
    limit(n: number) { limit = n; return q },
    async single() { const {data} = run(); return data.length === 1 ? {data: data[0], error: null} : {data: null, error: {message: 'not single'}} },
    async maybeSingle() { const {data} = run(); return {data: data[0] || null, error: null} },
    then(resolve: any, reject: any) { try { resolve(run()) } catch (e) { reject(e) } },
  }
  return q
}}

// ---- Fake Swiggy MCP client (records every provider call) ----
class CommerceMcpError extends Error { constructor(public reason: string) { super(reason) } }
let addressList: any[] = [{id: 'home', addressLine: 'Private street', addressTag: 'Home'}]
let searchMode: 'ok' | 'empty' | 'reauth' | 'down' = 'ok'
let writeMode: 'apply' | 'lost' = 'apply'
let cart: any
const calls: string[] = []
let writes: any[] = []
class CommerceMcpClient {
  constructor(public provider: string, public server: string, public token: string) { assert.equal(server, 'grocery') }
  async readTool(name: string, args: any) {
    calls.push(name)
    if (name === 'get_addresses') return {addresses: structuredClone(addressList), pagination: {hasMore: false}}
    if (name === 'search_products') {
      if (searchMode === 'reauth') throw new CommerceMcpError('reauth_required')
      if (searchMode === 'down') throw new CommerceMcpError('provider_unavailable')
      if (searchMode === 'empty') return {products: []}
      assert.equal(args.addressId, 'home')
      return {products: [
        {productId: 'p1', inStock: true, isAvail: true, variations: [
          {spinId: 'taaza', skuId: 'taaza-1l', displayName: 'Amul Taaza Toned Milk', quantityDescription: '1 litre', isInStockAndAvailable: true, maxQuantity: 6, price: {offerPrice: '₹54', mrp: '₹56'}},
          {spinId: 'taaza-half', skuId: 'taaza-500', displayName: 'Amul Taaza Toned Milk', quantityDescription: '500 ml', isInStockAndAvailable: false}]},
        {productId: 'p2', inStock: true, isAvail: true, variations: [
          {spinId: 'nandini', skuId: 'nandini-500', displayName: 'Nandini Toned Milk', quantityDescription: '500 ml', isInStockAndAvailable: true, price: {offerPrice: 24}}]},
        {productId: 'p3', inStock: false, isAvail: true, variations: [{spinId: 'oos', skuId: 'oos', displayName: 'Out of stock milk', quantityDescription: '1 litre', isInStockAndAvailable: true}]},
        {productId: 'p4', inStock: true, isAvail: true, variations: [
          {spinId: 'akshayakalpa', skuId: 'ak-1l', displayName: 'Akshayakalpa Organic Milk', quantityDescription: '1 litre', isInStockAndAvailable: true, price: {offerPrice: 'Rs. 92.50'}}]},
        {productId: 'p5', inStock: true, isAvail: true, variations: [
          {spinId: 'heritage', skuId: 'heritage-1l', displayName: 'Heritage Milk', quantityDescription: '1 litre', isInStockAndAvailable: true}]},
      ]}
    }
    assert.equal(name, 'get_cart')
    return structuredClone(cart)
  }
  async updateInstamartCart(addressId: string, items: any[]) {
    calls.push('update_cart')
    const run = tables.agent_runs.find(r => r.metadata_json?.commerce?.cartOperation && !r.metadata_json.commerce.cartOperation.verifiedAt)
    assert.equal(run?.status, 'outcome_unknown', 'durable uncertainty must be persisted before the provider write')
    writes.push({addressId, items: structuredClone(items)})
    if (writeMode === 'lost') throw Error('lost acknowledgement, cart unchanged')
    cart.items = items.map(item => ({...item, isInStockAndAvailable: true}))
    cart.cartTotalAmount = '₹239'; cart.billBreakdown = {toPay: {value: '₹239'}}
  }
}

let enabled = true, connected = true, leaseBusy = false
const leases: string[] = []
function load(file: string, deps: Record<string, any>) {
  const exports: any = {}
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(out, {exports, process, Date, URL, console, Promise, JSON, Error, Number, String, Array, Object, Set, Map, require(name: string) { if (name in deps) return deps[name]; throw Error('Unexpected dependency ' + name) }})
  return exports
}
const tasks = load('lib/commerce/task.ts', {'@/lib/supabase-admin': {supabaseAdmin: db}, './providers': providers})
const executor = load('lib/commerce/instamart-cart.ts', {'node:crypto': crypto, '@/lib/supabase-admin': {supabaseAdmin: db}, './swiggy-read': reads, './addresses': addresses})
const chat = load('lib/commerce/instamart-chat.ts', {
  '@/lib/supabase-admin': {supabaseAdmin: db},
  '@/lib/agent/brain-runtime-guard': {acquireBrainUserLease: async (key: string) => { leases.push(key); return leaseBusy ? null : {ownerToken: 'lease'} }, releaseBrainUserLease: async () => true},
  './providers': {...providers, commerceEnabled: () => enabled},
  './connection-store': {readCommerceConnection: async (owner: string) => { assert.equal(owner, '42'); return connected ? {accessToken: 'fixture-token', expiresAt: Date.now() + 3600_000} : null }},
  './mcp': {CommerceMcpClient, CommerceMcpError},
  './addresses': addresses, './swiggy-read': reads, './evidence': evidence, './task': tasks, './instamart-cart': executor,
})

const say = async (text: string) => {
  const reply = await chat.tryInstamartChat({telegramId: 42, text, surface: 'web'})
  // Mirror the routes: every handled turn is saved, so "latest Gogo reply" is real state.
  if (reply) tables.conversations.push({telegram_id: '42', role: 'user', content: text, created_at: stamp()}, {telegram_id: '42', role: 'assistant', content: reply.text, created_at: stamp()})
  return reply
}
const botSays = (content: string) => tables.conversations.push({telegram_id: '42', role: 'assistant', content, created_at: stamp()})
const resetCart = () => { cart = {cartId: 'cart1', selectedAddressDetails: {id: 'home'}, cartTotalAmount: '₹185', billBreakdown: {toPay: {value: '₹185'}}, items: [{spinId: 'bread', skuId: 'loaf', quantity: 2, isInStockAndAvailable: true}]} }
resetCart()

// 1. Phrase recognition, and numbers that must never be read as a pick.
for (const [text, item] of [
  ['Order milk on Swiggy Instamart', 'milk'], ['order milk on instamart', 'milk'], ['Buy Amul butter from Instamart.', 'Amul butter'],
  ['get me some eggs on swiggy instamart please', 'eggs'], ['Can you order bread from Swiggy Instamart?', 'bread'],
  ['Add Nandini curd to my Instamart cart', 'Nandini curd'], ['add 2 onions to my swiggy instamart cart', '2 onions'],
] as const) assert.equal(chat.parseInstamartOrderRequest(text), item, text)
for (const text of ['order milk', 'compare grocery prices for milk', 'get my order status from instamart', 'did my instamart order arrive', 'buy milk on zepto', 'what is the price of milk on instamart', 'order 560086 on instamart'])
  assert.equal(chat.parseInstamartOrderRequest(text), null, text)
for (const [text, pick] of [['1', 1], ['2.', 2], ['#3', 3], ['add the first one', 1], ['second', 2], ['option 3', 3], ['add 2', 2], ['the 2nd one', 2]] as const) assert.equal(chat.parseInstamartPick(text), pick, text)
for (const text of ['4', '0', '12', '100', '560086', '1234', '482913', '₹1', 'Rs 2', '1 kg', '2 litres', '1 2 3', 'yes'])
  assert.equal(chat.parseInstamartPick(text), null, text)
assert.equal(await say('what is on my calendar'), null)

// 2. Not connected: the connect link, nothing else, and no task or provider call.
connected = false
let reply = await say('Order milk on Swiggy Instamart')
assert.equal(reply.text, 'Connect your Swiggy account first, then ask me again: https://app.askgogo.in/dashboard/commerce')
assert.equal(reply.handledBy, 'instamart-chat')
assert.equal(tables.agent_runs.length, 0); assert.equal(calls.length, 0)
connected = true
enabled = false
reply = await say('Order milk on Swiggy Instamart')
assert.match(reply.text, /cannot be connected/); assert.equal(calls.length, 0)
enabled = true

// 3. The live failure: list three in-stock options with pack size and price, store them on the task.
reply = await say('Order milk on Swiggy Instamart')
assert.ok(reply && !/can't place orders/i.test(reply.text))
assert.equal(reply.text, 'Instamart options for "milk" delivering to Home:\n'
  + '1. Amul Taaza Toned Milk — 1 litre — ₹54\n'
  + '2. Nandini Toned Milk — 500 ml — price shown in the Swiggy app\n'
  + '3. Akshayakalpa Organic Milk — 1 litre — ₹92.50\n\n'
  + 'Reply 1, 2 or 3 to add it to your Instamart cart. Nothing is ordered; you pay in the Swiggy app.')
assert.deepEqual(calls, ['get_addresses', 'search_products'], 'listing options is read-only')
let task = tables.agent_runs.at(-1)!
assert.equal(task.type, 'grocery_comparison'); assert.equal(task.status, 'paused'); assert.equal(task.telegram_id, '42')
assert.equal(task.metadata_json.state, 'waiting_item_selection')
assert.equal(task.metadata_json.commerce.address.id, 'home')
assert.deepEqual(task.metadata_json.chat_pick.options, [{spinId: 'taaza', skuId: 'taaza-1l'}, {spinId: 'nandini', skuId: 'nandini-500'}, {spinId: 'akshayakalpa', skuId: 'ak-1l'}])
assert.ok(!JSON.stringify(task).includes('fixture-token'))

// 4. A number that is NOT answering the list is not swallowed (an unrelated reply came in between).
botSays('Your reminder is set for 6pm.')
assert.equal(await say('1'), null)
assert.equal(writes.length, 0)
// PIN codes, amounts and sign-in codes never bind, even while the list is the latest reply.
botSays(tables.conversations.filter(r => r.role === 'assistant' && r.content.startsWith('Instamart options')).at(-1)!.content)
for (const text of ['560086', '482913', '54', '4']) assert.equal(await chat.tryInstamartChat({telegramId: 42, text}), null, text)
assert.equal(writes.length, 0)

// 5. "2" right after the list adds exactly that item once, preserving the existing basket, verified by readback.
calls.length = 0
reply = await say('2')
assert.equal(writes.length, 1)
assert.deepEqual(writes[0], {addressId: 'home', items: [{spinId: 'bread', skuId: 'loaf', quantity: 2}, {spinId: 'nandini', skuId: 'nandini-500', quantity: 1}]})
assert.equal(calls.filter(c => c === 'update_cart').length, 1)
assert.equal(calls.at(-1), 'get_cart', 'outcome comes from provider readback')
assert.equal(reply.status, 'completed'); assert.equal(reply.mutated, true)
assert.match(reply.text, /^Instamart cart contents verified: Nandini Toned Milk — 500 ml, added quantity 1\./)
assert.match(reply.text, /Provider payable total for the whole cart: ₹239\.00/)
assert.match(reply.text, /No order was placed/)
assert.match(reply.text, /Review and pay in the Swiggy app: https:\/\/www\.swiggy\.com\/instamart/)
assert.ok(leases.includes('commerce:swiggy:42'), 'same per-owner cart lease as the dashboard cart route')
task = tables.agent_runs.at(-1)!
assert.equal(task.metadata_json.state, 'cart_contents_verified')
// A repeated "2" is no longer a pick: no second write.
assert.equal(await say('2'), null)
assert.equal(writes.length, 1)

// 6. Unknown outcome: one write, honest line, never retried; later additions refused until reconciled.
resetCart(); writeMode = 'lost'
await say('order milk on instamart')
reply = await say('1')
assert.equal(writes.length, 2, 'exactly one more write attempt')
assert.equal(reply.status, 'outcome_unknown')
assert.match(reply.text, /could not confirm your cart afterwards\. I will not try again automatically\./)
assert.match(reply.text, /https:\/\/app\.askgogo\.in\/dashboard\/commerce\?run=/)
assert.equal(tables.agent_runs.at(-1)!.status, 'outcome_unknown')
assert.equal(await say('1'), null, 'the unknown task is not waiting for a pick')
writeMode = 'apply'
await say('order milk on instamart')
reply = await say('1')
assert.match(reply.text, /earlier Instamart cart change still needs checking/)
assert.equal(writes.length, 2, 'no write while an earlier outcome is unverified')
for (const r of tables.agent_runs) if (r.status === 'outcome_unknown') r.status = 'closed'

// 7. Stale offers: older than 15 min no longer binds; a catalogue older than 5 min refuses and asks for fresh options.
resetCart()
await say('order milk on instamart')
task = tables.agent_runs.at(-1)!
task.metadata_json.chat_pick.offeredAt = new Date(Date.now() - 16 * 60_000).toISOString()
assert.equal(await say('1'), null)
await say('order milk on instamart')
task = tables.agent_runs.at(-1)!
const old = new Date(Date.now() - 6 * 60_000).toISOString()
task.metadata_json.chat_pick.offeredAt = old; task.metadata_json.commerce.catalogue.observedAt = old
reply = await say('1')
assert.match(reply.text, /more than 5 minutes old, so I did not add anything/)
assert.equal(writes.length, 2)
// A cart on another address is not overwritten.
await say('order milk on instamart')
cart.selectedAddressDetails.id = 'office'
reply = await say('1')
assert.match(reply.text, /different address, so I did not change it/)
assert.equal(writes.length, 2)
resetCart()
// Lease held by the dashboard cart route: refuse, nothing written.
await say('order milk on instamart')
leaseBusy = true
reply = await say('3')
assert.match(reply.text, /still running\. Nothing new was added/)
leaseBusy = false
assert.equal(writes.length, 2)

// 8. Errors: no results, expired sign-in, unreachable/unserviceable, several addresses.
searchMode = 'empty'
reply = await say('order paneer on instamart')
assert.match(reply.text, /no in-stock match for "paneer" at Home/); assert.equal(await say('1'), null)
searchMode = 'reauth'
reply = await say('order paneer on instamart')
assert.equal(reply.text, 'Your Swiggy sign-in has expired. Reconnect here, then ask me again: https://app.askgogo.in/dashboard/commerce')
searchMode = 'down'
reply = await say('order paneer on instamart')
assert.match(reply.text, /did not return a result I could verify.*outside its delivery area.*Nothing was added or ordered/s)
searchMode = 'ok'
tables.agent_runs.length = 0
addressList = [{id: 'home', addressLine: 'a', addressTag: 'Home'}, {id: 'office', addressLine: 'b', addressTag: 'Work'}]
reply = await say('order milk on instamart')
assert.match(reply.text, /more than one saved Swiggy address.*dashboard\/commerce\?run=/)
assert.equal(tables.agent_runs.at(-1)!.metadata_json.state, 'waiting_address')
// A previously chosen address is reused when Swiggy still lists it.
tables.agent_runs.at(-1)!.metadata_json.commerce.address = {id: 'home', label: 'Home', source: 'provider_saved_address', page: 1}
reply = await say('order milk on instamart')
assert.match(reply.text, /delivering to Home/)
assert.equal(writes.length, 2)

// 9. Wiring: both chat surfaces call it, lazily, after the sign-in-code boundary.
const dashboard = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const whatsapp = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
for (const [name, source, boundary, before] of [['dashboard', dashboard, 'shouldWithholdAuthenticationCode', 'tryResolvePendingQuestion({'], ['whatsapp', whatsapp, 'shouldWithholdAuthenticationCode', 'tryResolvePendingQuestion({']] as const) {
  const hook = source.indexOf("await import('@/lib/commerce/instamart-chat').catch(")
  assert.ok(hook > 0, name + ' must load the Instamart chat entry lazily and guarded')
  assert.ok(source.indexOf(boundary) < hook, name + ': sign-in codes are withheld before any Instamart routing')
  assert.ok(hook < source.indexOf(before), name + ': list replies bind before generic pending-question routing')
  assert.ok(hook < source.indexOf('await tryFoodComparison('), name + ': before the legacy comparison entry')
  assert.ok(!/^import .*instamart-chat/m.test(source), name + ': no static import (strict harness dependency maps)')
}
const executorSource = readFileSync('lib/commerce/instamart-chat.ts', 'utf8')
assert.ok(!/updateInstamartCart\(/.test(executorSource), 'chat never writes the cart directly; only the durable executor does')
assert.ok(!/checkout_cart|place_order|placeOrder/.test(executorSource))
console.log('PASS: Instamart chat entry: connect link when unconnected, 3 in-stock options from the connected account, number binds only to a waiting list, exact single durable cart write with preserved basket and readback, unknown outcome never retried, honest errors')
