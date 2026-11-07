// Tipplr ops pilot, phase 4 (7 Nov): invoice draft → approve → filed with read-back; the Tipplr HTTP adapter runs
// only when every endpoint is configured, and maps only through the given mappers.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
delete process.env.META_WA_TOKEN; delete process.env.META_WA_PHONE_ID
const { buildWorld, SyntheticAdapter } = await import('../lib/enterprise/tipplr/synthetic')
const sch = await import('../lib/enterprise/tipplr/schedules')
const dg = await import('../lib/enterprise/tipplr/digest')
const inv = await import('../lib/enterprise/tipplr/invoice')
const ta = await import('../lib/enterprise/tipplr/tipplr-adapter')
const { recordingSender } = await import('../lib/enterprise/tipplr/meta-whatsapp')

const NOW = Date.parse('2026-11-07T03:40:00Z')
const world = buildWorld('ws_tipplr', NOW)
const adapter = new SyntheticAdapter(world)
const store = new sch.MemoryScheduleStore()
const rec = recordingSender()
const pend = { v: null as any, async get() { return this.v }, async set(p: any) { this.v = p } }
const saved: any[] = []; const persist = async (r: any) => { saved.push(r) }
const ops = (t: string) => dg.handleOpsInput(adapter, store, t, rec.send, pend, persist, NOW, null)

// 1. Draft from the ledger: items, 5% GST, total, preview path; nothing filed yet.
const delivered = world.orders.find(o => o.outletId === 'out_cunningham_test' && o.state === 'delivered')!
const d = inv.draftInvoice(delivered, world.outlets[0])
assert.equal(d.subtotalPaise, delivered.items.reduce((s, l) => s + l.qty * l.pricePaise, 0)); assert.equal(d.gstPaise, Math.round(d.subtotalPaise * 0.05)); assert.equal(d.totalPaise, d.subtotalPaise + d.gstPaise)
const draftText = await ops(`generate invoice for #${delivered.id}`)
assert.match(draftText!, new RegExp(`^Needs approval\\nDraft ready: invoice for #${delivered.id}, Tipplr Cunningham Road \\(Testing\\), ₹[\\d,]+ \\+ GST 5% ₹[\\d,]+ = \\*₹[\\d,]+\\*\\. I'll only file it if you say "approve"\\.\\nPreview: https://app\\.askgogo\\.in/e/inv-${delivered.id}$`), draftText!)
assert.equal(pend.v?.kind, 'invoice')
console.log('✓ invoice draft: ledger figures, 5% GST, preview link, nothing filed')

// 2. Approve → filed (pilot ledger), read back → Done; a second approve has nothing; a new/cancelled order gets no draft.
const done = await ops('approve')
assert.equal(done, `Done: invoice for #${delivered.id} filed, ${(await import('../lib/enterprise/tipplr/types')).inr(d.totalPaise)}.`, done!)
assert.equal(saved.at(-1).action, 'merchant.invoice.file'); assert.equal(saved.at(-1).state, 'verified_success')
assert.equal(await ops('approve'), 'There is nothing waiting for approval.')
const live = (await adapter.listNewOrders('out_cunningham_test'))[0]
assert.match((await ops(`generate invoice for #${live.id}`))!, /is new; an invoice is raised only for an accepted or delivered order/)
assert.match((await ops('generate invoice for #T-nope'))!, /don't have an order #T-nope/)
console.log('✓ approve files with read-back; repeat approve empty; new/unknown orders refused')

// 3. A filer failure: "didn't go through", nothing claimed.
const failing = inv.ledgerFiler(null)
const bad = await inv.fileInvoice(d, async () => ({ ok: false, status: 502, error: 'upstream' }), failing.readBack, persist)
assert.match(bad, /^That didn't go through: invoice for #T-\d+ filed, ₹[\d,]+ \(verified absent\)\. Nothing was changed\.$/, bad)
console.log('✓ filer failure is reported, not claimed')

// 4. Tipplr HTTP adapter: null config unless every env piece is set and https; paths filled; calls go to the configured host only.
assert.equal(ta.tipplrConfigFromEnv({} as any), null)
const env: any = { TIPPLR_API_BASE_URL: 'https://api.tipplr.example/', TIPPLR_API_AUTH_HEADER: 'Bearer t', TIPPLR_PATH_OUTLETS: '/v1/outlets', TIPPLR_PATH_ITEMS: '/v1/outlets/{outletId}/items', TIPPLR_PATH_ITEM: '/v1/outlets/{outletId}/items/{itemId}', TIPPLR_PATH_ORDERS: '/v1/outlets/{outletId}/orders', TIPPLR_PATH_ORDER: '/v1/orders/{orderId}', TIPPLR_PATH_ACCEPT: '/v1/orders/{orderId}/accept', TIPPLR_PATH_REJECT: '/v1/orders/{orderId}/reject', TIPPLR_PATH_AVAILABILITY: '/v1/outlets/{outletId}/items/{itemId}/availability' }
assert.equal(ta.tipplrConfigFromEnv({ ...env, TIPPLR_PATH_REJECT: '' }), null, 'one missing path → not configured')
assert.equal(ta.tipplrConfigFromEnv({ ...env, TIPPLR_API_BASE_URL: 'http://api.tipplr.example' }), null, 'https only')
const cfg = ta.tipplrConfigFromEnv(env)!
assert.equal(cfg.baseUrl, 'https://api.tipplr.example')
assert.equal(ta.fillPath(cfg.paths.availability, { outletId: 'o 1', itemId: 'i/2' }), '/v1/outlets/o%201/items/i%2F2/availability')
const calls: { url: string; method: string; body: any }[] = []
const fakeFetch: any = async (url: string, init: any) => { calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }); if (/\/accept$/.test(url)) return { ok: true, status: 200, json: async () => ({ id: 'T-9', state: 'accepted' }) }; if (/\/orders\/T-9$/.test(url)) return { ok: true, status: 200, json: async () => ({ data: { id: 'T-9', state: 'accepted', prep: 15 } }) }; return { ok: true, status: 200, json: async () => ({ data: [] }) } }
const map = { outlet: (r: any) => ({ id: String(r.id), workspaceId: '', name: r.name, phoneNumbers: r.phones || [], posIntegrated: !!r.pos, timezone: 'Asia/Kolkata' }), item: (r: any) => ({ id: String(r.id), outletId: String(r.outlet), name: r.name, category: 'all_day' as const, available: !!r.available, availableUntil: null }), order: (r: any) => ({ id: String(r.id), outletId: String(r.outlet || ''), source: 'ondc' as const, items: [], amountPaise: 0, customerFirstName: '', area: '', prepaid: true, pickupBy: '', state: r.state, prepMinutes: r.prep ?? null, cancelReason: null, createdAt: '', updatedAt: '' }) }
const http = new ta.TipplrHttpAdapter(cfg, 'ws', map, fakeFetch)
assert.equal((await http.acceptOrder('T-9', 15)).status, 200)
assert.deepEqual(calls[0], { url: 'https://api.tipplr.example/v1/orders/T-9/accept', method: 'POST', body: { prepMinutes: 15 } })
assert.equal((await http.getOrder('T-9'))!.state, 'accepted')
assert.ok(calls.every(c => c.url.startsWith('https://api.tipplr.example/')), 'only the configured host')
console.log('✓ Tipplr HTTP adapter: configured-or-nothing, https only, paths filled, one host')
console.log('Tipplr pilot phase 4 checks passed')
