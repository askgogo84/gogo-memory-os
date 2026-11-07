// Tipplr ops pilot, phase 1 (7 Nov): synthetic order feed and merchant screen 1. Every write goes through an action
// record and is verified by read-back; POS outlets refuse availability writes; the module names no consumer table.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { buildWorld, SyntheticAdapter } = await import('../lib/enterprise/tipplr/synthetic')
const rules = await import('../lib/enterprise/tipplr/stock-rules')
const msgs = await import('../lib/enterprise/tipplr/merchant-messages')
const act = await import('../lib/enterprise/tipplr/actions')
const { inr } = await import('../lib/enterprise/tipplr/types')

const NOW = Date.parse('2026-11-07T04:30:00Z') // 10:00 am IST
const world = buildWorld('ws_tipplr', NOW)
const adapter = new SyntheticAdapter(world)

// 1. The world is deterministic and shaped like the problem.
assert.equal(world.outlets.length, 48); assert.equal(world.outlets[0].name, 'Tipplr Cunningham Road (Testing)')
assert.equal(buildWorld('ws_tipplr', NOW).orders.length, world.orders.length, 'same seed, same world')
const month = rules.dayStats(null, world.orders, new Date(NOW - 30 * 86_400_000).toISOString(), new Date(NOW).toISOString())
assert.ok(month.orders > 20_000 && month.cancelled / month.orders > 0.08 && month.cancelled / month.orders < 0.2, `cancellation rate ${(month.cancelled / month.orders * 100).toFixed(1)}% over ${month.orders} orders`)
assert.ok(month.outOfStock / month.cancelled > 0.5, 'out of stock is the majority reason')
const oosAfterCutoff = world.orders.filter(o => o.state === 'cancelled' && o.cancelReason === 'out_of_stock' && rules.istHour(o.createdAt) >= 11.5).length
assert.ok(oosAfterCutoff / month.outOfStock > 0.6, 'OOS cancellations cluster after 11:30 IST')
assert.ok(world.outlets.some(o => o.posIntegrated), 'some outlets are POS-integrated')
assert.equal(inr(684000), '₹6,840'); assert.equal(inr(39_000_000), '₹3.9 L')
console.log(`✓ world: ${world.outlets.length} outlets, ${month.orders} orders / 30 d, ${(month.cancelled / month.orders * 100).toFixed(0)}% cancelled, ${(month.outOfStock / month.cancelled * 100).toFixed(0)}% of those out of stock`)

// 2. Screen 1: a new order, with the stock check only when history says so.
const queue = await adapter.listNewOrders('out_cunningham_test')
assert.equal(queue.length, 3, 'three live orders for the testing outlet')
// Two items with no out-of-stock cancellation in the last 2 days at this outlet (the generator is random; the rule is not).
const recentOOS = new Set(world.orders.filter(o => o.outletId === 'out_cunningham_test' && o.cancelReason === 'out_of_stock' && Date.parse(o.createdAt) >= NOW - 2 * 86_400_000).flatMap(o => o.outOfStockItemId ? [o.outOfStockItemId] : o.items.map(l => l.itemId)))
const clean = world.items.filter(i => i.outletId === 'out_cunningham_test' && i.category !== 'breakfast' && !recentOOS.has(i.id)).slice(0, 2)
assert.equal(clean.length, 2, 'two clean items exist')
const plain = await act.composeNewOrder(adapter, { ...queue[0], items: [{ itemId: clean[0].id, name: clean[0].name, qty: 2, pricePaise: 12000 }, { itemId: clean[1].id, name: clean[1].name, qty: 1, pricePaise: 4000 }], amountPaise: 28000, customerFirstName: 'Divya', area: 'Indiranagar', prepaid: true, source: 'flipkart' }, NOW)
assert.match(plain.text, new RegExp(`^New order · Flipkart\\n\\*#T-\\d+\\* · 2 × ${clean[0].name}, 1 × ${clean[1].name} · \\*₹280\\* · pickup by \\d{1,2}:\\d{2} [ap]m\\nDivya · Indiranagar · prepaid$`), plain.text)
assert.deepEqual(plain.buttons.map(b => b.title), ['Accept · 15 min', 'Accept · 25 min', "Can't make it"])
assert.ok(msgs.withinLimit(plain))
// Seed two recent OOS cancellations on Idli Vada after 1 pm, then the same order flags it.
const idli = world.items.find(i => i.outletId === 'out_cunningham_test' && i.name === 'Idli Vada')!
for (const h of [13.2, 14.5]) world.orders.push({ id: `T-seed-${h}`, outletId: 'out_cunningham_test', source: 'ondc', items: [{ itemId: idli.id, name: 'Idli Vada', qty: 3, pricePaise: 8000 }], amountPaise: 24000, customerFirstName: 'Nithin', area: 'HSR', prepaid: true, pickupBy: new Date(NOW).toISOString(), state: 'cancelled', prepMinutes: null, cancelReason: 'out_of_stock', outOfStockItemId: idli.id, createdAt: new Date(NOW - 86_400_000 + (h - 10) * 3_600_000).toISOString(), updatedAt: new Date(NOW).toISOString() })
const stock = await act.composeNewOrder(adapter, { ...queue[1], items: [{ itemId: idli.id, name: 'Idli Vada', qty: 3, pricePaise: 8000 }], amountPaise: 24000, customerFirstName: 'Nithin', area: 'HSR', prepaid: true }, NOW)
assert.match(stock.text, /^Check stock\n.*\nIdli Vada was the reason for \*\d+ cancellations\* in the last 2 days after 1[12]? [ap]m\. Still available now\?$/s, stock.text)
const flagCount = Number(stock.text.match(/\*(\d+) cancellations\*/)![1]); assert.ok(flagCount >= 2, 'at least the two seeded')
assert.deepEqual(stock.buttons.map(b => b.title), ['Yes, accept · 15 min', 'Out of stock, reject'])
assert.ok(msgs.withinLimit(stock))
console.log('✓ screen 1: plain order gets three buttons; an item that cancelled twice yesterday afternoon gets the stock check')

// 3. Accept through the action record: Done only after read-back says accepted.
const saved: any[] = []
const persist = async (r: any) => { saved.push(r) }
const phone = '918310441698'
const a = await act.handleMerchantInput(adapter, phone, `accept:${queue[0].id}:15`, persist, NOW)
assert.match(a!.texts[0], new RegExp(`^Done: #${queue[0].id} accepted, 15 minutes\\. Tipplr confirmed it \\(order state \\*accepted\\*\\)\\.`), a!.texts[0])
assert.deepEqual([saved[0].action, saved[0].state, saved[0].decision.mode, saved[0].evidence[0].httpStatus, saved[0].verification.state], ['merchant.order.accept', 'verified_success', 'approval', 200, 'verified_completed'])
assert.equal((await adapter.getOrder(queue[0].id))!.state, 'accepted')
const again = await act.handleMerchantInput(adapter, phone, `accept:${queue[0].id}:25`, persist, NOW)
assert.equal(again!.texts[0], `#${queue[0].id} is already accepted (15 min). Nothing changed.`, 'a second tap is not a second Done')
assert.notEqual(saved[1].state, 'verified_success')
console.log('✓ accept: verified by read-back; a repeat tap never claims Done again')

// 4. Reject as out of stock → verified, then the one follow-up; the follow-up marks the item off with read-back.
const r = await act.handleMerchantInput(adapter, phone, `reject:${queue[1].id}:out_of_stock`, persist, NOW)
assert.match(r!.texts[0], new RegExp(`^Done: #${queue[1].id} rejected as out of stock\\.$`), r!.texts[0])
assert.match(r!.texts[1], /^Want me to mark \*.+\* out of stock on Tipplr until 5 pm so this doesn't repeat\?$/)
assert.equal(r!.buttons?.[0].title, 'Yes, until 5 pm')
const oos = await act.handleMerchantInput(adapter, phone, r!.buttons![0].id, persist, NOW)
assert.match(oos!.texts[0], /^Done: .+ marked out of stock until 5 pm\. Checked back: Tipplr shows it unavailable\.$/, oos!.texts[0])
const item = world.items.find(i => i.outletId === 'out_cunningham_test' && !i.available)!
assert.ok(item && item.availableUntil && new Date(item.availableUntil).toISOString().endsWith('T11:30:00.000Z'), `until 5 pm IST = 11:30Z: ${item?.availableUntil}`)
const backOn = await act.handleMerchantInput(adapter, phone, `turn ${item.name} back on`, persist, NOW)
assert.match(backOn!.texts[0], new RegExp(`^Done: ${item.name} back on\\. Checked back: Tipplr shows it available\\.$`))
console.log('✓ reject out of stock → follow-up → item off until 5 pm IST → back on, each verified')

// 5. Upstream failure: no mutation, honest receipt, no retry.
adapter.failOnce(queue[2].id)
const f = await act.handleMerchantInput(adapter, phone, `accept:${queue[2].id}:15`, persist, NOW)
assert.match(f!.texts[0], new RegExp(`^That didn't go through: #${queue[2].id} accepted, 15 minutes \\(verified absent\\)\\. Nothing was changed\\.$`), f!.texts[0])
assert.equal((await adapter.getOrder(queue[2].id))!.state, 'new')
assert.equal(saved.at(-1).state, 'failed'); assert.equal(saved.at(-1).evidence[0].httpStatus, 502)
console.log('✓ a 502 from Tipplr: "didn\'t go through … nothing was changed", order still new, no retry')

// 6. POS-integrated outlets refuse availability writes; unknown numbers get nothing; today's count reads the ledger.
const pos = world.outlets.find(o => o.posIntegrated)!
const posReply = await act.setAvailability(adapter, 'merchant:x', pos, 'Idli Vada', false, 17, persist, NOW)
assert.equal(posReply.record, null); assert.equal(posReply.text, msgs.POS_REFUSAL)
assert.equal(await act.handleMerchantInput(adapter, '919999999999', 'how many orders today', persist, NOW), null)
const today = await act.handleMerchantInput(adapter, phone, 'how many orders today', persist, NOW)
assert.match(today!.texts[0], /^\*Today so far:\* \d+ orders, ₹[\d,]+\. \d+ accepted, \d+ not fulfilled.*\. Yesterday at this time: \d+ orders, ₹[\d,]+\.$/, today!.texts[0])
console.log('✓ POS outlets refused, unknown numbers ignored, today\'s count from the ledger')

// 7. Cut-off proposal rule finds the breakfast pattern on the synthetic week.
const prop = rules.cutoffProposal('out_cunningham_test', world.orders, world.items, NOW)
assert.ok(prop && prop.total >= 3 && prop.items.every(i => ['Idli Vada', 'Pongal', 'Upma', 'Set Dosa', 'Croissant'].includes(i.name)), JSON.stringify(prop))
console.log(`✓ cut-off rule: ${prop!.total} breakfast OOS cancellations after 11:30 this week → proposal (${prop!.items.map(i => `${i.name} ${i.count}`).join(', ')})`)

// 8. Boundary: the pilot module names no consumer store; policy has the merchant capability as consequential + ask.
const files = readdirSync('lib/enterprise/tipplr').map(f => readFileSync(`lib/enterprise/tipplr/${f}`, 'utf8')).join('\n')
for (const t of ['memories', 'reminders', 'expenses', 'conversations', 'friend_contacts', 'gmail', 'calendar', 'users']) assert.ok(!new RegExp(`from\\('${t}'\\)`).test(files), `pilot never reads ${t}`)
const policy = readFileSync('lib/agent/policy.ts', 'utf8')
assert.match(policy, /\| 'merchant'/); assert.match(policy, /'payments', 'merchant'\]\)/)
assert.match(readFileSync('lib/agent/adaptive-trust.ts', 'utf8'), /merchant: 'ask'/)
const mig = readFileSync('supabase/migrations/20261107160000_tipplr_pilot.sql', 'utf8')
for (const t of ['merchant_outlets', 'merchant_items', 'merchant_orders', 'merchant_order_events', 'merchant_schedules']) { assert.match(mig, new RegExp(`create table if not exists public\\.${t}`)); assert.match(mig, new RegExp(`grant all on public\\.${t} to service_role`)) }
assert.ok(readFileSync('supabase/migrations/20261107160000_tipplr_pilot.rollback.sql', 'utf8').split('drop table').length === 6)
console.log('✓ boundary: no consumer tables, merchant capability consequential and ask, migration + rollback prepared')
console.log('Tipplr pilot phase 1 checks passed')
