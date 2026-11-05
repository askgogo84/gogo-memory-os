// Occasion invites (approved canvas screen 4, 5 Nov): forwarded table booking → occasion → who/which → signed card.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.CARD_LINK_SECRET ||= 'test-secret-for-cards'
const { supabaseAdmin } = await import('../lib/supabase-admin')
const oi = await import('../lib/agent/occasion-invite')

// 1. The real ReserveGo confirmation from 5 Nov.
const sms = "Hi Giverdhan, Your reservation at Dali and Gala Cocktail Bar for 4 guests on 06-Nov-2026 at 07:30 PM is confirmed. To accommodate slight delays, we'll hold your table for maximum 15 mins. Visit rsrvg.com/-NUtBA for details."
const now = new Date('2026-11-05T13:00:00Z')
assert.deepEqual(oi.parseReservationConfirmation(sms, now), { venue: 'Dali and Gala Cocktail Bar', guests: 4, dateIso: '2026-11-06', time: '7:30 pm', link: 'https://rsrvg.com/-NUtBA' })
assert.equal(oi.whenLabel({ dateIso: '2026-11-06', time: '7:30 pm' }), 'Fri, 6 Nov · 7:30 pm')
assert.equal(oi.whenLabel({ dateIso: '2026-11-06', time: '7:30 pm' }, true), 'Friday, 6 November 2026 · 7:30 pm')
assert.equal(oi.parseReservationConfirmation('Your table at Toit for 2 people on 12 Dec at 8:00 pm is booked', now)?.guests, 2)
for (const x of ['Your hotel booking at Taj for 2 guests on 12 Nov at 2:00 PM is confirmed', 'Booking confirmed: PNR ABC123, flight 6E 201 on 12 Nov at 7:30 AM', 'Your reservation is confirmed', 'what a dinner'])
  assert.equal(oi.parseReservationConfirmation(x, now), null, x)
console.log('✓ forwarded table bookings are read; hotels, flights and vague messages are not')

// 2. Who / which.
assert.deepEqual(oi.parseOccasionDetails('Divya, turning 30'), { who: 'Divya', number: 30 })
assert.deepEqual(oi.parseOccasionDetails('Divya and Nithin, 5th'), { who: 'Divya and Nithin', number: 5 })
assert.deepEqual(oi.parseOccasionDetails('Goverdhan & Divyashree 15th'), { who: 'Goverdhan and Divyashree', number: 15 })
assert.deepEqual(oi.parseOccasionDetails('our 15th'), { who: null, number: 15 })
const booking = oi.parseReservationConfirmation(sms, now)!
assert.equal(oi.cardSpec({ step: 'card', booking, kind: 'anniversary', who: 'Goverdhan and Divyashree', number: 15, style: 0 }).kicker, 'Celebrating 15 years')
assert.equal(oi.cardSpec({ step: 'card', booking, kind: 'anniversary', who: 'Goverdhan and Divyashree', number: 15, style: 1 }).kicker, '15 years together')
assert.equal(oi.cardSpec({ step: 'card', booking, kind: 'birthday', who: 'Divya', number: 30, style: 0 }).title, 'Divya turns 30')
assert.equal(oi.cardSpec({ step: 'card', booking, kind: 'dinner', style: 0 }).party, 'Table for 4')
console.log('✓ names come from what was typed; titles and kickers per occasion and style')

// 3. Signed card link: tamper-proof and bound to the owner.
const card = await import('../lib/security/card-link')
const spec = oi.cardSpec({ step: 'card', booking, kind: 'anniversary', who: 'Goverdhan and Divyashree', number: 15, style: 0 })
const url = new URL((await oi.cardUrl(spec, '918884501501'))!)
const d = url.searchParams.get('d')!, t = url.searchParams.get('t')!
assert.equal(await card.verifyCardToken(`invite-${await oi.cardDigest(d)}`, '918884501501', t), true)
const forged = Buffer.from(JSON.stringify({ ...spec, title: 'Someone else' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
assert.equal(await card.verifyCardToken(`invite-${await oi.cardDigest(forged)}`, '918884501501', t), false, 'changed words fail')
assert.equal(await card.verifyCardToken(`invite-${await oi.cardDigest(d)}`, '919999999999', t), false, 'another owner fails')
assert.equal(JSON.parse(Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).title, 'Goverdhan and Divyashree')
console.log('✓ card links are signed: words and owner cannot be changed')

// 4. The whole conversation, owner-scoped.
const rows: any[] = []
let clock = Date.now()
const tq = () => { const f: any[] = []; let ins: any = null; const b: any = {
  select() { return b }, insert(x: any) { ins = x; return b }, eq(k: string, v: any) { if (k === 'telegram_id') assert.equal(typeof v, 'string'); f.push((r: any) => r[k] === v); return b },
  gte(k: string, v: any) { f.push((r: any) => r[k] >= v); return b }, order() { return b }, limit() { return b },
  then(res: any, rej: any) { if (ins) { clock += 1000; rows.push({ ...ins, created_at: new Date(clock).toISOString() }); return Promise.resolve({ error: null }).then(res, rej) }
    return Promise.resolve({ data: rows.filter(r => f.every(fn => fn(r))).sort((a, b2) => b2.created_at.localeCompare(a.created_at)), error: null }).then(res, rej) } }; return b }
;(supabaseAdmin as any).from = (tbl: string) => { if (tbl === 'agent_activity') return tq(); throw new Error('unexpected table ' + tbl) }
const A = '918884501501', B = '919999999999'
const say = (tg: string, text: string) => oi.tryOccasionInvite({ telegramId: tg, text, name: 'Goverdhan' })
const r1 = await say(A, sms)
assert.match(r1!.text, /^✅ Table confirmed at \*Dali and Gala Cocktail Bar\*\n4 guests · Fri, 6 Nov · 7:30 pm\n\nIs it for an occasion\?/)
assert.equal(await say(B, 'anniversary'), null, "another person's booking never starts my flow")
assert.match((await say(A, 'Anniversary'))!.text, /Whose anniversary is it/)
assert.equal(await say(A, 'what is the weather'), null, 'an unrelated question is not read as the names')
assert.equal(await say(A, 'remind me to call mom'), null, 'nor is a command')
const r3 = await say(A, 'Goverdhan and Divyashree, 15th')
assert.match(r3!.text, /^Here's your invite: \*Goverdhan and Divyashree\*/)
assert.match(String(r3!.mediaUrl), /\/api\/invite-card\?o=918884501501&d=/)
const r4 = await say(A, 'another style')
assert.ok(r4!.mediaUrl && r4!.mediaUrl !== r3!.mediaUrl, 'a new style is a new card')
const r5 = await say(A, 'send')
assert.match(r5!.text, /^Forward the next message to your group\./)
assert.match(r5!.text, /I never message your friends myself/)
// The forwardable message is three short lines; the link is short and carries no phone number (5 Nov live: one huge link).
assert.match(String(r5!.followUp), /^🥂 Goverdhan and Divyashree's 15th anniversary dinner\nFri, 6 Nov · 7:30 pm · Dali and Gala Cocktail Bar\nhttps:\/\/app\.askgogo\.in\/e\/[A-Za-z0-9]{10}$/)
assert.ok(r5!.followUp!.length < 160, 'short enough to read at a glance')
assert.ok(!/wa\.me|918884501501|invite-card|maps\./.test(r5!.followUp! + r5!.text), 'no wa.me blob, phone number or long URL')
const cardRow = rows.find(r => r.event_type === 'occasion_invite_card')
assert.equal(cardRow.message, `card ${r5!.followUp!.slice(-10)}`)
assert.equal(cardRow.metadata_json.spec.kicker, '15 years together', 'the shared card is the chosen style')
assert.equal(await say(A, 'send'), null, 'after sharing, "send" is ordinary chat again')
// 5 Nov live replay: no year given, then a correction, then the year.
await say(A, sms); await say(A, 'Anniversary')
const n1 = await say(A, 'Divya and Goverdhan')
assert.match(n1!.text, /^Here's your invite: \*Divya and Goverdhan\*/)
assert.equal(rows.filter(r => r.event_type === 'occasion_invite').at(-1).metadata_json.number, null)
assert.equal(oi.cardSpec({ step: 'card', booking, kind: 'anniversary', who: 'Divya and Goverdhan', number: null, style: 0 }).kicker, 'Anniversary dinner', 'never a lone "Celebrating"')
const n2 = await say(A, "It's actually Divya and Gogo")
assert.match(n2!.text, /^Here's your invite: \*Divya and Gogo\*/, 'a correction redraws the card')
assert.ok(n2!.mediaUrl, 'with a new image, not just words')
const n3 = await say(A, 'make it 15 years')
assert.equal(JSON.parse(Buffer.from(new URL(n3!.mediaUrl!).searchParams.get('d')!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).kicker, 'Celebrating 15 years')
assert.match(n3!.text, /\*Divya and Gogo\*/, 'the names stay')
assert.equal(oi.correction('15th', { kind: 'anniversary', who: 'Divya and Gogo', number: null })!.number, 15)
assert.equal(oi.correction('what time is it', { kind: 'anniversary', who: 'X', number: null }), null)
assert.ok(oi.INVITE_GATE.test("It's actually Divya and Gogo") && oi.INVITE_GATE.test('make it 15 years') && oi.INVITE_GATE.test('15th'))
const n4 = await say(A, 'send')
assert.match(String(n4!.followUp), /^🥂 Divya and Gogo's 15th anniversary dinner\n/)
// Shortcut: occasion with details in one message; dinner needs no questions; one guest gets no offer.
await say(A, sms); assert.match((await say(A, 'birthday, Divya turning 30'))!.text, /^Here's your invite: \*Divya turns 30\*/)
await say(A, sms); assert.match((await say(A, 'just dinner'))!.text, /^Here's your invite: \*Dinner with friends\*/)
assert.equal((await say(A, sms.replace('4 guests', '1 guest')))!.text.includes('occasion'), false)
assert.match((await say(B, 'make an invite'))!.text, /Forward me the table booking confirmation first/)
// Open questions expire: a details question left 3 hours ago no longer captures a short line.
await say(A, sms); await say(A, 'birthday'); clock += 3 * 3_600_000; rows.push({ ...rows[rows.length - 1], created_at: new Date(clock).toISOString() })
const realNow = Date.now; Date.now = () => clock + 10_800_000
assert.equal(await say(A, 'Nithin Kumar'), null, 'expired details question')
Date.now = realNow
console.log('✓ booking → occasion → who → card → style → correction → short share link; owner-scoped; shortcuts work')

// 4b. The short link page reads only that card, never the owner's number, and expires.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture'
const store = await import('../lib/agent/invite-card-store')
const realFetch = globalThis.fetch
let asked = ''
globalThis.fetch = (async (u: any) => { asked = String(u); const id = decodeURIComponent(asked).match(/card ([A-Za-z0-9]{10})/)?.[1]
  const row = rows.find(r => r.event_type === 'occasion_invite_card' && r.message === `card ${id}`)
  return new Response(JSON.stringify(row ? [row] : []), { status: 200 }) }) as any
const sid = n4!.followUp!.slice(-10)
const shared = await store.getSharedCard(sid)
assert.equal(shared!.spec.title, 'Divya and Gogo'); assert.equal(shared!.spec.kicker, 'Celebrating 15 years')
assert.ok(!JSON.stringify(shared).includes('918884501501'), 'the page never sees the phone number')
assert.match(asked, /event_type=eq\.occasion_invite_card&message=eq\.card%20/)
assert.equal(await store.getSharedCard('zzzzzzzzzz'), null)
assert.equal(await store.getSharedCard("x' or 1=1"), null, 'only a 10-character id is looked up')
const old = rows.find(r => r.message === `card ${sid}`); const keep = old.created_at; old.created_at = new Date(Date.now() - 61 * 86_400_000).toISOString()
assert.equal(await store.getSharedCard(sid), null, 'cards expire after 60 days'); old.created_at = keep
globalThis.fetch = realFetch
console.log('✓ /e/<id> shows only that card, with no phone number; unknown and old ids are not found')

// 5. Wiring.
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
const route = readFileSync('app/api/invite-card/route.ts', 'utf8')
assert.ok(wa.indexOf('m.tryOccasionInvite(') > 0 && wa.indexOf('m.tryOccasionInvite(') < wa.indexOf("import('@/lib/agent/brain').then(m => m.runBrain("), 'before the brain')
assert.match(wa, /if \(inv\.mediaUrl\) await sendWhatsAppMediaMessage\(from, inv\.text, inv\.mediaUrl\)/)
assert.match(wa, /if \(inv\.followUp\) \{ await saveConversation\(resolvedUser\.telegramId, 'assistant', inv\.followUp\); await sendWhatsAppMessage\(from, inv\.followUp\) \}/)
const page = readFileSync('app/e/[id]/page.tsx', 'utf8')
assert.match(page, /images: \[\{ url: image, width: 1200, height: 630/, 'wide link preview')
assert.match(route.replace(/\s+/g, ' '), /spec = \(await getSharedCard\(c\)\)\?\.spec if \(!spec\) return new NextResponse\(null, \{ status: 404 \}\)/)
assert.match(route, /if \(!\(await verifyCardToken\(kind, owner, t\)\)\) return new NextResponse\(null, \{ status: 404 \}\)/)
assert.match(readFileSync('app/api/dashboard/chat/route.ts', 'utf8'), /VERCEL_ENV\)\{\n\s*const inv=await import\('@\/lib\/agent\/occasion-invite'\)\.then\(m=>m\.INVITE_GATE\.test\(text\)\?m\.tryOccasionInvite\(\{telegramId:String\(user\.telegram_id\),text,name:user\.name\}\)/)
console.log('✓ wired into WhatsApp (card sent as an image) and dashboard chat; card route verifies the signature')
console.log('Occasion invite checks passed')
