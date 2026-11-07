// Tipplr ops pilot, phase 3 (7 Nov): the Meta WhatsApp channel and the ops side (screen 3). Signed webhooks only,
// payloads within Meta's limits, digest figures equal the ledger, offers go out only on "approve", nothing sent
// when Meta isn't configured.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
delete process.env.META_WA_TOKEN; delete process.env.META_WA_PHONE_ID
const wa = await import('../lib/enterprise/tipplr/meta-whatsapp')
const { buildWorld, SyntheticAdapter } = await import('../lib/enterprise/tipplr/synthetic')
const sch = await import('../lib/enterprise/tipplr/schedules')
const dg = await import('../lib/enterprise/tipplr/digest')
const rules = await import('../lib/enterprise/tipplr/stock-rules')

// 1. Cloud API payloads: buttons → interactive (≤3, titles ≤20), none → text, digits-only recipient.
const p = wa.cloudPayload('+91 83104 41698', { text: 'hi', buttons: [{ id: 'accept:T-1:15', title: 'Accept · 15 min' }, { id: 'accept:T-1:25', title: 'Accept · 25 min' }, { id: 'reject:T-1:no_response', title: "Can't make it" }, { id: 'x', title: 'four' }] }) as any
assert.equal(p.to, '918310441698'); assert.equal(p.type, 'interactive'); assert.equal(p.interactive.action.buttons.length, 3); assert.ok(p.interactive.action.buttons.every((b: any) => b.reply.title.length <= 20))
assert.equal((wa.cloudPayload('918310441698', { text: 'plain', buttons: [] }) as any).type, 'text')
assert.deepEqual(await wa.sendViaMeta('918310441698', { text: 'x', buttons: [] }), { ok: false, status: 0, error: 'meta_not_configured' }, 'no env, no send')
console.log('✓ payloads within Meta limits; nothing sent without env')

// 2. Webhook security: handshake and signature.
assert.equal(wa.verifyHandshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'v1', 'hub.challenge': '42' }), 'v1'), '42')
assert.equal(wa.verifyHandshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '42' }), 'v1'), null)
assert.equal(wa.verifyHandshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '42' }), undefined), null, 'unset token never verifies')
const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '918310441698', id: 'wamid.1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'accept:T-4512:15', title: 'Accept · 15 min' } } }, { from: '918310441698', id: 'wamid.2', type: 'text', text: { body: 'how many orders today' } }], statuses: [{ id: 'x', status: 'delivered' }] } }] }] })
const sig = `sha256=${createHmac('sha256', 'secret1').update(raw).digest('hex')}`
assert.ok(wa.verifySignature(raw, sig, 'secret1')); assert.ok(!wa.verifySignature(raw, sig, 'secret2')); assert.ok(!wa.verifySignature(raw + ' ', sig, 'secret1')); assert.ok(!wa.verifySignature(raw, null, 'secret1')); assert.ok(!wa.verifySignature(raw, sig, undefined))
const inbound = wa.parseInbound(JSON.parse(raw))
assert.deepEqual(inbound.map(i => [i.kind, i.text]), [['button', 'accept:T-4512:15'], ['text', 'how many orders today']])
console.log('✓ handshake and HMAC signature; taps and texts parsed, statuses ignored')

// 3. Digest equals the ledger; screen-3 wording.
const NOW = Date.parse('2026-11-07T03:30:00Z') // 9:00 IST
const world = buildWorld('ws_tipplr', NOW)
const adapter = new SyntheticAdapter(world)
const store = new sch.MemoryScheduleStore()
const d = await dg.buildDigest(adapter, store, NOW)
const yFrom = new Date(Date.parse('2026-11-05T18:30:00Z')).toISOString(), yTo = new Date(Date.parse('2026-11-06T18:30:00Z')).toISOString()
const ledger = rules.dayStats(null, world.orders, yFrom, yTo)
assert.deepEqual([d.orders, d.cancelled, d.outOfStock, d.revenuePaise], [ledger.orders, ledger.cancelled, ledger.outOfStock, ledger.revenuePaise], 'digest figures are the ledger figures')
const text = dg.formatDigest(d)
assert.match(text, /^Fri, 6 Nov · 48 pilot outlets\nOrders [\d,]+ · ₹[\d.,]+(?: L)? · Cancelled \d+ \(\d+%\) · Out of stock \d+ of \d+\n\n\*Top out-of-stock cancellers\*\n1\. .+ · \d+ · .+\n2\. .+\n3\. .+\n.*cut-off.*\nSay "offer cut-offs to the top 3"/, text)
assert.ok(text.length < 900)
console.log('✓ digest: figures equal the ledger; wording as mocked')

// 4. Reasons reply and today-at-outlet.
const all = world.orders
const reasons = dg.reasonsReply(all, NOW)
assert.match(reasons, /^\*Last 7 days:\* \d+ cancellations\. Out of stock \d+ \(\d+%\) · merchant didn't respond \d+ \(\d+%\) · rider unavailable \d+ · customer \d+\./)
const rec = wa.recordingSender()
const pend = { v: null as any, async get() { return this.v }, async set(p: any) { this.v = p } }
const saved: any[] = []; const persist = async (r: any) => { saved.push(r) }
const ops = (t: string) => dg.handleOpsInput(adapter, store, t, rec.send, pend, persist, NOW)
assert.match((await ops('how many orders today at cunningham'))!, /^\*Today so far:\*/)
assert.equal(await ops('what is the weather'), null, 'unrelated ops text falls through')
console.log('✓ reasons by week; today at an outlet; unrelated text ignored')

// 5. Offers: draft → nothing sent → approve → sent with one action record each → second approve has nothing.
const draft = await ops('offer cut-offs to the top 3')
assert.match(draft!, /^Needs approval\nDraft for [1-3] outlets?: .+\.\nEach gets the breakfast cut-off question/, draft!)
assert.equal(rec.sent.length, 0, 'drafting sends nothing')
const approved = await ops('approve')
const n = pend.v === null ? approved!.split('\n').length : 0
assert.ok(n >= 1 && rec.sent.length === n, `${n} sent`)
assert.ok(approved!.split('\n').every(l => /^Done: offer sent to out_/.test(l)), approved!)
assert.ok(rec.sent.every(s => s.message.buttons.length === 3 && /^Breakfast items/.test(s.message.text)))
assert.equal(saved.filter(r => r.action === 'merchant.offer.cutoff' && r.state === 'verified_success').length, n)
assert.equal(await ops('approve'), 'There is nothing waiting for approval.')
console.log(`✓ offers: draft, approve → ${n} sent with verified records, nothing left pending`)

// 6. Routes: webhook checks the signature before reading, 503 until configured; cron sends only when Meta is configured.
const hook = readFileSync('app/api/enterprise/tipplr/webhook/route.ts', 'utf8'), cron = readFileSync('app/api/cron/tipplr-pilot/route.ts', 'utf8')
assert.ok(hook.indexOf('verifySignature') < hook.indexOf('JSON.parse(raw)'), 'signature before parse')
assert.match(hook, /bad_signature.*401/s); assert.match(hook, /pilot_not_configured.*503/s); assert.match(hook, /TIPPLR_PILOT_OPS_NUMBERS/)
assert.match(cron, /if \(wa\.metaConfigured\(\)\) \{/); assert.match(cron, /istMin >= 9 \* 60 && istMin < 9 \* 60 \+ 5/)
console.log('✓ routes: signed webhooks only, 503 until configured, cron sends only with Meta env, digest at 9:00')
console.log('Tipplr pilot phase 3 checks passed')
