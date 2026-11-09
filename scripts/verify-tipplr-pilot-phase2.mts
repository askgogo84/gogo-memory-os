// Tipplr ops pilot, phase 2 (7 Nov): the breakfast cut-off schedule, screen 2. Proposal from the outlet's own week,
// one approval, every run verified by read-back, edits honoured, "no" is a week of silence. Also: the Supabase adapter
// and schedule store over a fake DB, and the cron route's gates.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { buildWorld, SyntheticAdapter } = await import('../lib/enterprise/tipplr/synthetic')
const sch = await import('../lib/enterprise/tipplr/schedules')
const act = await import('../lib/enterprise/tipplr/actions')

const AT = (h: number, m = 0) => Date.parse('2026-11-07T00:00:00Z') + ((h - 5.5) * 60 + m) * 60_000 // IST clock → epoch
const world = buildWorld('ws_tipplr', AT(10))
const adapter = new SyntheticAdapter(world)
const store = new sch.MemoryScheduleStore()
const saved: any[] = []; const persist = async (r: any) => { saved.push(r) }
const phone = '918310441698'
const testing = world.outlets[0]

// 1. 11:20 proposal: only outlets with the pattern, not POS, not scheduled, not snoozed.
const proposals = await sch.proposeCutoffs(adapter, store, AT(11, 20))
assert.ok(proposals.length > 10 && proposals.length < 48, `${proposals.length} outlets proposed`)
assert.ok(proposals.every(p => !p.outlet.posIntegrated), 'POS outlets never get a proposal')
const mine = proposals.find(p => p.outlet.id === testing.id)!
assert.match(mine.message.text, /^Breakfast items\nYou've had \*\d+ cancellations this week\* marked out of stock: (?:[A-Za-z ]+ \d+(?:, )?)+, all after 11:30 am\.\nShall I turn these \d off at \*11:30 every day\* and back on at 7 am\? You can say "keep pongal on" any time\.$/, mine.message.text)
assert.deepEqual(mine.message.buttons.map(b => b.title), ['Yes, every day', 'Only today', 'No'])
console.log(`✓ proposal: ${proposals.length} outlets with the breakfast pattern; message as mocked`)

// 2. "No" → a week of silence. "Yes, every day" at 11:22 → schedule set, first run today.
const other = proposals.find(p => p.outlet.id !== testing.id)!
const no = await act.handleMerchantInput(adapter, other.outlet.phoneNumbers[0], `cutoff:${other.outlet.id}:no`, persist, AT(11, 22), store)
assert.match(no!.texts[0], /won't bring this up for a week/)
assert.ok(!(await sch.proposeCutoffs(adapter, store, AT(11, 20) + 3 * 86_400_000)).some(p => p.outlet.id === other.outlet.id), 'snoozed outlet not proposed again in 3 days')
const yes = await act.handleMerchantInput(adapter, phone, `cutoff:${testing.id}:daily`, persist, AT(11, 22), store)
assert.match(yes!.texts[0], /^Set: .+ go off at 11:30 am and on at 7 am daily\. First run today at 11:30 am\. I'll confirm each change from Tipplr and tell you if one fails\.$/, yes!.texts[0])
const s0 = (await store.list(testing.id))[0]
const s = { ...s0, itemIds: [...s0.itemIds] } // snapshot: the store row is mutated by later edits
assert.ok(s.active && s.itemIds.length >= 1 && s.offAt === '11:30' && s.onAt === '07:00')
console.log('✓ "No" snoozes a week; "Yes, every day" sets the schedule with the first run today')

// 3. Cron at 11:25: nothing due. At 11:31: items go off, each verified; one Done message; a second run the same day is a no-op.
assert.equal((await sch.runDueSchedules(adapter, store, persist, AT(11, 25))).length, 0)
const run = await sch.runDueSchedules(adapter, store, persist, AT(11, 31))
assert.equal(run.length, 1); assert.equal(run[0].outlet.id, testing.id)
assert.match(run[0].text, /^Done\nTurned off .+ on Tipplr \(checked back: (?:it shows|all show) \*unavailable\*\)\. Back on at 7 am\.$/, run[0].text)
for (const id of s.itemIds) assert.equal((await adapter.getItem(testing.id, id))!.available, false)
assert.equal((await sch.runDueSchedules(adapter, store, persist, AT(11, 45))).length, 0, 'no double run')
const offRecords = saved.filter(r => r.action === 'merchant.item.availability' && r.telegramId === `schedule:${testing.id}`)
assert.ok(offRecords.length >= s.itemIds.length && offRecords.every(r => r.state === 'verified_success'))
console.log('✓ 11:31 run: items off, read back, one message, no double run, one verified record per item')

// 4. Next morning 7:02: items back on. A failing item is named, the others still Done.
const nextDay = AT(7, 2) + 86_400_000
adapter.failOnce(s.itemIds[0])
const on = await sch.runDueSchedules(adapter, store, persist, nextDay)
assert.equal(on.length, 1)
const firstName = world.items.find(i => i.id === s.itemIds[0])!.name
assert.match(on[0].text, new RegExp(`${firstName}: That didn't go through: ${firstName} back on \\(verified absent\\)\\. Nothing was changed\\.`), on[0].text)
if (s.itemIds.length > 1) assert.match(on[0].text, /^Done\nTurned on .+ \(checked back: (?:it shows|all show) \*available\*\)\.\n/)
assert.equal((await adapter.getItem(testing.id, s.itemIds[0]))!.available, false, 'the failed one stays off, honestly reported')
console.log('✓ 7:02 run: items back on; a 502 on one item is named and nothing is claimed for it')

// 5. Edits: keep X on (removed from the list and turned on now), add Y, show, stop.
const keepName = world.items.find(i => i.id === s.itemIds[0])!.name
const keep = await act.handleMerchantInput(adapter, phone, `keep ${keepName} on`, persist, nextDay + 60_000, store)
assert.match(keep!.texts[0], new RegExp(`^${keepName} taken off the cut-off list\\. Done: ${keepName} back on\\.`), keep!.texts[0])
assert.ok(!(await store.list(testing.id))[0].itemIds.includes(s.itemIds[0]))
const add = await act.handleMerchantInput(adapter, phone, 'add Masala Dosa to the cut-off', persist, nextDay, store)
assert.equal(add!.texts[0], 'Masala Dosa added: off at 11:30 am, on at 7 am.')
assert.match((await act.handleMerchantInput(adapter, phone, 'what is the cut-off?', persist, nextDay, store))!.texts[0], /^Off at 11:30 am, on at 7 am: .*Masala Dosa/)
assert.match((await act.handleMerchantInput(adapter, phone, 'stop the cut-off', persist, nextDay, store))!.texts[0], /^Stopped: no more scheduled changes/)
assert.equal((await sch.runDueSchedules(adapter, store, persist, nextDay + 5 * 3_600_000)).length, 0, 'a stopped schedule never runs')
console.log('✓ edits: keep on, add, show, stop')

// 6. "Only today" runs now until 7 am tomorrow, no schedule saved.
const todayOnly = proposals.find(p => p.outlet.id !== testing.id && p.outlet.id !== other.outlet.id)!
const t = await act.handleMerchantInput(adapter, todayOnly.outlet.phoneNumbers[0], `cutoff:${todayOnly.outlet.id}:today`, persist, AT(12), store)
assert.match(t!.texts[0], /^Done\nTurned off .+ Back on at 7 am\.$/, t!.texts[0])
assert.equal((await store.list(todayOnly.outlet.id)).filter(x => x.active).length, 0)
const it = await adapter.getItem(todayOnly.outlet.id, todayOnly.proposal.items[0].itemId)
assert.ok(it && !it.available && it.availableUntil && it.availableUntil.startsWith('2026-11-08T01:30'), `until 7 am IST next day: ${it?.availableUntil}`)
console.log('✓ "Only today": off now until 7 am tomorrow, nothing scheduled')
// 6b. …and the cron turns those items back on once available_until has passed (P1, 7 Nov review: nothing else restores them).
assert.equal((await sch.runDueSchedules(adapter, store, persist, Date.parse('2026-11-08T01:00:00Z'))).filter(r => r.outlet.id === todayOnly.outlet.id).length, 0, 'not before 7 am')
const restored = (await sch.runDueSchedules(adapter, store, persist, Date.parse('2026-11-08T01:35:00Z'))).find(r => r.outlet.id === todayOnly.outlet.id)
assert.ok(restored && /^Done\nTurned on .+ \(checked back: .+\*available\*\)\.$/.test(restored.text), `restored at 7:05: ${restored?.text}`)
const it2 = await adapter.getItem(todayOnly.outlet.id, todayOnly.proposal.items[0].itemId)
assert.ok(it2 && it2.available && !it2.availableUntil, 'item back on, until cleared')
assert.equal((await sch.runDueSchedules(adapter, store, persist, Date.parse('2026-11-08T01:40:00Z'))).filter(r => r.outlet.id === todayOnly.outlet.id).length, 0, 'restore runs once')
console.log('✓ "Only today" items come back on at 7 am through the cron, once, with read-back')

// 7. Supabase adapter and store over a fake DB: compare-and-set, 409 on a second accept, availability write + read-back, schedule rows, missing table → pilot_not_enabled.
const { SupabaseAdapter, worldToRows } = await import('../lib/enterprise/tipplr/supabase-adapter')
const rows: Record<string, any[]> = worldToRows(buildWorld('ws_tipplr', AT(10)))
rows.merchant_schedules = []
let seq = 1
function table(name: string) {
  const f: [string, any, string][] = []; let patch: any = null, ins: any = null, order: [string, boolean] | null = null, lim: number | null = null, single = false
  const hit = () => { let r = (rows[name] || []).filter(x => f.every(([k, v, op]) => op === 'gte' ? String(x[k]) >= String(v) : String(x[k]) === String(v))); if (order) r = r.sort((a, b) => (String(a[order![0]]) > String(b[order![0]]) ? 1 : -1) * (order![1] ? 1 : -1)); return lim ? r.slice(0, lim) : r }
  const b: any = { select() { return b }, eq(k: string, v: any) { f.push([k, v, 'eq']); return b }, gte(k: string, v: any) { f.push([k, v, 'gte']); return b }, order(k: string, o: any) { order = [k, o?.ascending !== false]; return b }, limit(n: number) { lim = n; return b },
    update(p: any) { patch = p; return b }, insert(r: any) { ins = Array.isArray(r) ? r : [r]; return b }, delete() { patch = '__delete'; return b },
    maybeSingle() { single = true; return b }, single() { single = true; return b },
    then(res: any, rej: any) {
      if (!rows[name]) return Promise.resolve({ data: null, error: { code: '42P01', message: `relation "public.${name}" does not exist` } }).then(res, rej)
      let out: any[] = []
      if (ins) { for (const r of ins) { const row = { id: `row_${seq++}`, created_at: new Date().toISOString(), ...r }; rows[name].push(row); out.push(row) } }
      else if (patch === '__delete') { const h = hit(); rows[name] = rows[name].filter(x => !h.includes(x)); out = h }
      else if (patch) { out = hit(); out.forEach(r => Object.assign(r, patch)) }
      else out = hit()
      return Promise.resolve({ data: single ? out[0] || null : out, error: null }).then(res, rej)
    } }
  return b
}
const db = { from: table }
const sa = new SupabaseAdapter(db, 'ws_tipplr')
assert.equal((await sa.listOutlets()).length, 48)
const live = await sa.listNewOrders('out_cunningham_test'); assert.equal(live.length, 3)
assert.equal((await sa.acceptOrder(live[0].id, 15)).status, 200); assert.equal((await sa.getOrder(live[0].id))!.state, 'accepted')
assert.equal((await sa.acceptOrder(live[0].id, 25)).status, 409, 'compare-and-set on state = new')
const a2 = await act.acceptOrder(sa, 'merchant:out_cunningham_test', live[1].id, 25, persist)
assert.match(a2.text, /^Done: #T-\d+ accepted, 25 minutes\. Tipplr confirmed it/)
const item = (await sa.listItems('out_cunningham_test'))[0]
assert.equal((await sa.setItemAvailability('out_cunningham_test', item.id, false, '2026-11-07T11:30:00.000Z')).status, 200)
assert.equal((await sa.getItem('out_cunningham_test', item.id))!.available, false)
const ss = new sch.SupabaseScheduleStore(db)
const row = await ss.save({ outletId: 'out_cunningham_test', itemIds: [item.id], offAt: '11:30', onAt: '07:00', active: true, createdBy: 'test' })
assert.equal((await ss.list('out_cunningham_test')).length, 1); await ss.update(row.id, { active: false }); assert.equal((await ss.list('out_cunningham_test'))[0].active, false)
await ss.snooze('out_001', '2026-11-14T00:00:00.000Z'); assert.equal(await ss.snoozedUntil('out_001'), '2026-11-14T00:00:00.000Z')
delete rows.merchant_schedules
await assert.rejects(() => ss.list(), /pilot_not_enabled/)
console.log('✓ Supabase adapter and store: compare-and-set accepts, 409 on repeat, availability read-back, schedule rows, missing table → pilot_not_enabled')

// 8. Cron route gates and seed script shape.
const cron = readFileSync('app/api/cron/tipplr-pilot/route.ts', 'utf8')
assert.match(cron, /CRON_SECRET/); assert.match(cron, /TIPPLR_PILOT_WORKSPACE_ID/); assert.match(cron, /pilot_not_enabled.*503/s); assert.match(cron, /runDueSchedules\(adapter, store, persist, now\)/); assert.ok(!/sendWhatsApp|twilio|graph\.facebook/i.test(cron), 'phase 2 sends nothing')
const seed = readFileSync('scripts/seed-tipplr-pilot.mts', 'utf8')
assert.match(seed, /from\('workspaces'\)\.select\('id,name'\)\.eq\('id', ws\)/); assert.ok(!/from\('(?:memories|reminders|users|conversations|expenses)'\)/.test(seed))
console.log('✓ cron: secret + workspace gates, 503 until enabled, sends nothing; seed touches only pilot tables')
console.log('Tipplr pilot phase 2 checks passed')

// Auto-seed (7 Nov, owner on phone): an empty workspace is seeded on the first cron run; a seeded one is left alone.
{
  const { seedIfEmpty } = await import('../lib/enterprise/tipplr/supabase-adapter')
  const t: Record<string, any[]> = { merchant_outlets: [], merchant_items: [], merchant_orders: [] }
  const fdb = { from: (name: string) => { const f: [string, any][] = []; let ins: any = null; const b: any = { select() { return b }, eq(k: string, v: any) { f.push([k, v]); return b }, limit() { return b }, insert(r: any) { ins = r; return b }, upsert(r: any) { ins = r; return b }, then(res: any, rej: any) { if (!t[name]) return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res, rej); if (ins) { t[name].push(...ins); return Promise.resolve({ data: null, error: null }).then(res, rej) } return Promise.resolve({ data: t[name].filter(x => f.every(([k, v]) => String(x[k]) === String(v))), error: null }).then(res, rej) } }; return b } }
  const first = await seedIfEmpty(fdb, 'ws_tipplr', AT(10))
  assert.equal(first.seeded, true); assert.equal(first.rows!.merchant_outlets, 48); assert.ok(first.rows!.merchant_orders > 20_000)
  assert.deepEqual(await seedIfEmpty(fdb, 'ws_tipplr', AT(10)), { seeded: false })
  // A seed that died after outlets (orders table empty) resumes on the next run instead of reporting seeded:false forever.
  const half = t.merchant_orders.splice(0); assert.equal(t.merchant_orders.length, 0)
  const resumed = await seedIfEmpty(fdb, 'ws_tipplr', AT(10)); assert.equal(resumed.seeded, true); assert.equal(t.merchant_orders.length, half.length)
  await assert.rejects(() => seedIfEmpty({ from: () => ({ select() { return this }, eq() { return this }, limit() { return this }, then(res: any) { return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "merchant_outlets" does not exist' } }).then(res) } }) } as any, 'ws'), /pilot_not_enabled/)
  assert.match(readFileSync('app/api/cron/tipplr-pilot/route.ts', 'utf8'), /seedIfEmpty\(supabaseAdmin, workspaceId\)/)
  console.log('✓ auto-seed: empty workspace seeded once by the cron; missing table → pilot_not_enabled')
}
