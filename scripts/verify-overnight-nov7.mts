// Overnight live pass, 7 Nov (36 dashboard cases). The replays here are the failures it found.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'

// 1. "plan a goa trip 12 to 15 dec with Divya and Nithin" asked "what should it include?" though place and dates were given.
const tp = await import('../lib/agent/trip-plan')
const now = new Date('2026-11-07T00:00:00+05:30')
assert.deepEqual(tp.tripAsk('plan a goa trip 12 to 15 dec with Divya and Nithin', now), { destination: 'Goa', start: '2026-12-12', end: '2026-12-15', nights: 3, companions: ['Divya', 'Nithin'], from: 'Bengaluru' })
assert.deepEqual(tp.tripAsk('Plan a trip to Coorg 20-22 Nov', now)?.destination, 'Coorg')
assert.equal(tp.tripAsk('organise a 3 day trip to Hampi from 5 to 7 Jan with Nithin', now)?.start, '2027-01-05', 'January rolls to next year')
assert.equal(tp.tripAsk('plan our Dubai holiday Dec 24 to 28 with my wife', now)?.companions.length, 0, '"my wife" is not a name')
for (const t of ['plan my day', 'plan a wedding in goa 12 to 15 dec', 'plan a goa trip', 'book a goa trip 12 to 15 dec', 'plan my week']) assert.equal(tp.tripAsk(t, now), null, t)
const plan = tp.formatTripPlan(tp.tripAsk('plan a goa trip 12 to 15 dec with Divya and Nithin', now)!, { flights: 'Searching Bengaluru to Goa, 12 Dec 2026, back 15 Dec.', stays: null })
assert.match(plan, /^🧳 \*Goa, Sat, 12 Dec – Tue, 15 Dec\* · 3 nights with Divya and Nithin\n\n\*Flights\* \(Bengaluru → Goa, back Tue, 15 Dec\)\nSearching Bengaluru to Goa/)
assert.match(plan, /say "split it 3 ways" when you book\. I won't book or hold anything without your approval\.$/)
const brain = readFileSync('lib/agent/brain.ts', 'utf8'), wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.match(brain, /\|\| !!tripAsk\(t\)/); assert.match(wa, /m\.tryTripPlan\(prepActor, 'whatsapp', text\)/); assert.match(dash, /m\.tryTripPlan\(actor,'web',text\)/)
console.log('✓ trip plan: place + dates → plan skeleton with flights and stays; wired on both surfaces; off the brain')

// 2. "connect gmail" on the dashboard handed out a fresh link while Gmail was connected.
const fi = readFileSync('lib/feature-intents.ts', 'utf8')
assert.match(fi, /if \(isWorkspaceConnect\(text\)\) \{\n[\s\S]{0,400}buildGmailConnectReply\(user\.telegramId, text\)/, 'feature-intents defers to the shared Gmail connect reply')
console.log('✓ dashboard "connect gmail" uses the shared connected-state reply')
console.log('Overnight (7 Nov) replays passed')

// 3. "Got it, boss." / "…so far, boss." reached WhatsApp and the dashboard from paths that skip stripUnrequestedAddress.
{
  const { sanitizeWhatsAppReply } = await import('../lib/channels/whatsapp')
  assert.equal(sanitizeWhatsAppReply("Got it, boss. Divya's birthday is 14 Feb — saved."), "Got it. Divya's birthday is 14 Feb — saved.")
  assert.equal(sanitizeWhatsAppReply("Nithin is vegetarian — that's all you've told me so far, boss."), "Nithin is vegetarian — that's all you've told me so far.")
  assert.equal(sanitizeWhatsAppReply('Your boss emailed about the review.'), 'Your boss emailed about the review.', 'the word boss in content stays')
  assert.match(dash, /noBoss = text\.replace/, 'dashboard outbound strips it too')
  console.log('✓ no unrequested "boss" on either surface')
}
