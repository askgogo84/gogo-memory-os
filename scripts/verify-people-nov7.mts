// Entity resolution (7 Nov): Nithin in memory = nithin@tipplr.in in Gmail = "Nithin K L" on the calendar = the saved
// WhatsApp number. One directory, one answer, and "which one?" when two people share a first name.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const pp = await import('../lib/agent/people')

// 1. Merging: email and phone are identity; a bare first name joins only when unambiguous.
const people = pp.mergePeople([
  { name: 'Nithin', phone: '+91 98450 12345', source: 'contacts' },
  { name: 'Nithin K L', email: 'nithin@tipplr.in', source: 'calendar', at: '2026-11-10T06:00:00Z' },
  { name: null, email: 'nithin@tipplr.in', source: 'gmail', at: '2026-11-05T03:00:00Z' },
  { name: 'Nithin', source: 'memory', note: 'Nithin works from home on Fridays' },
  { name: 'Divya S', email: 'divya.s@gmail.com', source: 'gmail' },
  { name: 'Divya', phone: '9900011111', source: 'contacts' },
  { name: 'Divya Rao', email: 'divya.rao@flipkart.com', source: 'calendar' },
  { name: 'Divya', source: 'memory', note: 'Divya likes filter coffee' },
  { name: 'Swiggy', email: 'no-reply@swiggy.in', source: 'gmail' },
  { name: 'Rishi', email: 'rishi@ondc.org', source: 'gmail' },
  { name: 'Rishi', source: 'memory', note: 'Rishi keeps the Phase 1 tracker sheet' },
])
const nithin = people.find(p => p.emails.includes('nithin@tipplr.in'))!
assert.deepEqual([nithin.names.sort(), nithin.phones, nithin.notes, nithin.sources.sort(), nithin.lastSeen], [['Nithin', 'Nithin K L'], ['9845012345'], ['Nithin works from home on Fridays'], ['calendar', 'contacts', 'gmail', 'memory'], '2026-11-10T06:00:00Z'], JSON.stringify(nithin))
const divyas = people.filter(p => p.names.some(n => /^divya/i.test(n)))
assert.equal(divyas.length, 3, 'Divya S, Divya Rao and a phone-only Divya stay apart until something links them')
assert.deepEqual(divyas.map(p => p.notes.length), divyas.map(p => p.phones.length ? 1 : 0), 'the bare-name note goes to the contact saved as exactly "Divya", not to Divya S or Divya Rao')
const rishi = people.find(p => p.emails.includes('rishi@ondc.org'))!
assert.deepEqual(rishi.notes, ['Rishi keeps the Phase 1 tracker sheet'])
console.log('✓ merge: Nithin is one person across four sources; Divyas with different surnames stay apart; notes never guessed onto the wrong one')

// 2. Resolution by name, email, number; ambiguity is reported, not guessed.
assert.equal(pp.resolvePerson('nithin', people).person, nithin)
assert.equal(pp.resolvePerson('Nithin K L', people).person, nithin)
assert.equal(pp.resolvePerson('nithin@tipplr.in', people).person, nithin)
assert.equal(pp.resolvePerson('98450 12345', people).person, nithin)
const d = pp.resolvePerson('Divya', people); assert.equal(d.person?.phones[0], '9900011111', 'the exact saved name wins')
const d2 = pp.resolvePerson('Divya', people.filter(p => !p.phones.length)); assert.equal(d2.person, null); assert.equal(d2.candidates.length, 2, 'with no exact match, two Divyas is a question')
assert.equal(pp.resolvePerson('Divya Rao', people).person?.emails[0], 'divya.rao@flipkart.com')
assert.equal(pp.resolvePerson('Mathew', people).person, null); assert.equal(pp.resolvePerson('Mathew', people).candidates.length, 0)
assert.equal(pp.personMailQuery(nithin), '(from:nithin@tipplr.in OR to:nithin@tipplr.in) newer_than:90d -in:spam -in:trash')
assert.equal(pp.personMailQuery(people.find(p => p.emails.includes('no-reply@swiggy.in'))!), null, 'service addresses are not people')
assert.ok(pp.localPartHasName('nithin.kl@tipplr.in', 'Nithin') && pp.localPartHasName('kl.nithin@x.com', 'Nithin K L') && !pp.localPartHasName('nit@x.com', 'Nithin') && !pp.localPartHasName('divya@x.com', 'Nithin'))
console.log('✓ resolve: name, full name, address, number; exact saved name wins; otherwise "which one?"; services excluded from mail queries')

// 3. The ask, and what never counts as one.
for (const [t, who] of [['what do I know about Nithin?', 'Nithin'], ['Who is Rishi', 'Rishi'], ["what's pending with Nithin", 'Nithin'], ['catch me up on Divya Rao', 'Divya Rao'], ['when do I next meet Nithin?', 'Nithin'], ['tell me about chetan.kaul@ondc.org', 'chetan.kaul@ondc.org']] as const)
  assert.equal(pp.personAsk(t), who, t)
for (const t of ['what is the weather', 'who is the PM of India', 'what do I know about Swiggy', 'tell me about Bangalore', 'what about tomorrow', 'remind me about Nithin at 5', 'what is pending', 'email Nithin about the sheet'])
  assert.equal(pp.personAsk(t), null, `not a person ask: ${t}`)
console.log('✓ ask: people by name or address; places, brands, generic questions and actions excluded')

// 4. The brief.
const brief = pp.formatPersonBrief(nithin, { nextEvent: { summary: 'FnB sync', when: 'Mon, 10 Nov, 11:30 am' }, emails: [{ subject: 'Updated catalogue sheet', from: 'Nithin K L <nithin@tipplr.in>', date: 'Mon, 3 Nov' }] })
assert.equal(brief, '*Nithin K L* · nithin@tipplr.in · +91 9845012345\n\n• Nithin works from home on Fridays\n\nNext with Nithin: FnB sync, Mon, 10 Nov, 11:30 am.\n\n*Latest emails*\n• Updated catalogue sheet · Mon, 3 Nov', brief)
assert.match(pp.formatPersonBrief(rishi, { emails: null }), /Connect Gmail and I can add/)
assert.match(pp.formatPersonBrief({ key: 'x', names: ['Mathew'], emails: [], phones: [], sources: ['contacts'], notes: [], lastSeen: null }, { emails: [] }), /That's all I have on Mathew/)
console.log('✓ brief: identities, your notes, next meeting, latest emails; honest when empty')

// 5. Meeting prep shows what you told Gogo about a guest.
const mp = await import('../lib/agent/meeting-prep-ask')
const ev: any = { summary: 'FnB sync', start: new Date(Date.now() + 3_600_000).toISOString(), label: 'Mon 11:30 am', attendees: [{ email: 'nithin@tipplr.in', displayName: 'Nithin K L', responseStatus: 'accepted' }, { email: 'me@x.com', self: true }] }
const prep = mp.formatPrep(ev, [], Date.now(), new Map([['nithin@tipplr.in', ['Nithin works from home on Fridays']]]))
assert.match(prep, /• Nithin K L · ✓\n  Nithin works from home on Fridays/, prep)
assert.ok(!/works from home/.test(mp.formatPrep(ev, [], Date.now())), 'no notes, no extra line')
console.log('✓ meeting prep: "Nithin works from home on Fridays" under the guest line')

// 6. The directory gathers from a fake DB and fake Google; a failing source never loses the others.
const { supabaseAdmin } = await import('../lib/supabase-admin')
let seq = 1000
const tables: Record<string, any[]> = {
  friend_contacts: [{ owner_telegram_id: 777, name: 'Nithin', whatsapp_id: '919845012345' }],
  memories: [{ telegram_id: 777, content: 'Nithin works from home on Fridays', created_at: '2026-11-01T00:00:00Z' }, { telegram_id: 777, content: 'My office is in Rajajinagar', created_at: '2026-11-01T00:00:00Z' }, { telegram_id: 777, content: 'Divya likes filter coffee', created_at: '2026-11-01T00:00:00Z' }],
  users: [{ telegram_id: 777, google_calendar_connected: false, google_refresh_token: null, gmail_connected: false }],
}
;(supabaseAdmin as any).from = (name: string) => {
  const rows = tables[name]; const f: [string, any][] = []
  let patch: any = null
  const b: any = { select() { return b }, eq(k: string, v: any) { f.push([k, v]); return b }, gte() { return b }, order() { return b }, limit() { return b }, ilike() { return b },
    insert(row: any) { (tables[name] ||= []).push({ id: ++seq, created_at: new Date().toISOString(), ...row }); return b },
    update(pp: any) { patch = pp; return b },
    maybeSingle() { return Promise.resolve({ data: hit()[0] || null, error: null }) },
    then(res: any, rej: any) { if (!tables[name]) return Promise.resolve({ data: null, error: { message: `relation "${name}" does not exist` } }).then(res, rej); if (patch) hit().forEach(r => Object.assign(r, patch)); return Promise.resolve({ data: hit().slice().reverse(), error: null }).then(res, rej) } }
  const hit = () => (tables[name] || []).filter(r => f.every(([k, v]) => String(r[k]) === String(v)))
  return b
}
const actor: any = { userId: 'u', legacyTelegramId: 777, whatsappId: '918884501501', timezone: 'Asia/Kolkata' }
const dir = await pp.peopleDirectory(actor)
const n2 = pp.resolvePerson('Nithin', dir).person!
assert.deepEqual([n2.phones, n2.notes, n2.sources.sort()], [['9845012345'], ['Nithin works from home on Fridays'], ['contacts', 'memory']])
assert.ok(!dir.some(p => p.names.includes('My')), 'memory lines about places are not people')
const ask = await pp.tryPersonAsk(actor, 'what do I know about Nithin?')
assert.match(ask!, /^\*Nithin\* · \+91 9845012345\n\n• Nithin works from home on Fridays/, ask!)
assert.match((await pp.tryPersonAsk(actor, 'who is Mathew'))!, /^I don't have anything on Mathew yet/)
console.log('✓ directory: contacts + memory with calendar and Gmail unavailable; brief and honest miss')

// 6b. Live 7 Nov 11:21: two Nithins by address only → numbered candidates, the reply picks one, and the bare-name note still shows.
const two = pp.mergePeople([
  { name: null, email: 'nithin@tipplr.in', source: 'calendar' }, { name: null, email: 'nithin@tipplr.in', source: 'gmail' },
  { name: null, email: 'nithin.mdn@gmail.com', source: 'gmail' },
  { name: 'Nithin', source: 'memory', note: 'Nithin is vegetarian' },
])
assert.equal(two.length, 2); assert.deepEqual(pp.looseNotes(two, 'Nithin'), ['Nithin is vegetarian'])
const r2 = pp.resolvePerson('Nithin', two); assert.equal(r2.person, null); assert.equal(r2.candidates.length, 2)
assert.deepEqual(r2.candidates.map(pp.candidateLine), ['1. nithin@tipplr.in — Tipplr; on your calendar, emails you', '2. nithin.mdn@gmail.com; emails you'])
for (const [reply, expect] of [['1', 'nithin@tipplr.in'], ['2', 'nithin.mdn@gmail.com'], ['the first one', 'nithin@tipplr.in'], ['tipplr', 'nithin@tipplr.in'], ['work', 'nithin@tipplr.in'], ['gmail', 'nithin.mdn@gmail.com'], ['the gmail one', 'nithin.mdn@gmail.com'], ['nithin.mdn@gmail.com', 'nithin.mdn@gmail.com']] as const)
  assert.equal(pp.pickCandidate(reply, r2.candidates)?.emails[0], expect, `reply "${reply}"`)
assert.equal(pp.pickCandidate('Nithin', r2.candidates, 'Nithin'), null, 'the same first name is not an answer')
assert.equal(pp.pickCandidate('yes', r2.candidates), null)
// End to end through the fake DB: contacts without Nithin, memory note, Gmail unavailable → the two addresses come from "calendar" rows we seed via contacts? No: seed friend_contacts with both addresses is not real; instead run the pure pieces above and the choice persistence below.
tables.agent_activity = []
tables.friend_contacts = []
tables.memories = [{ telegram_id: 777, content: 'Nithin is vegetarian', created_at: '2026-11-05T00:00:00Z' }]
const miss = await pp.tryPersonAsk(actor, 'what do I know about Nithin?')
assert.match(miss!, /^\*Nithin\*\n\n• Nithin is vegetarian/, 'one Nithin (memory only) is answered directly')
// Persisted question → reply picks → brief with loose note labelled.
tables.agent_activity.push({ id: ++seq, telegram_id: '777', event_type: pp.PERSON_CHOICE_EVENT, created_at: new Date().toISOString(), message: 'Nithin', metadata_json: { who: 'Nithin', open: true, candidates: r2.candidates } })
const picked = await pp.tryPersonAsk(actor, '1')
assert.match(picked!, /^\*Nithin\* · nithin@tipplr\.in\n\n\*Your notes on Nithin\*\n• Nithin is vegetarian/, picked!)
assert.match(picked!, /No emails with Nithin in the last 90 days in the inboxes I can read\.$/, 'an empty email search is said, not hidden')
assert.equal(tables.agent_activity[0].metadata_json.open, false, 'the question closes after a pick')
assert.equal(await pp.tryPersonAsk(actor, '1'), null, 'a closed question does not fire again')
tables.agent_activity.push({ id: ++seq, telegram_id: '777', event_type: pp.PERSON_CHOICE_EVENT, created_at: new Date().toISOString(), message: 'Nithin', metadata_json: { who: 'Nithin', open: true, candidates: r2.candidates } })
assert.match((await pp.tryPersonAsk(actor, 'Nithin'))!, /^Reply with the number:\n1\. nithin@tipplr\.in/, 'the same first name re-asks with numbers')
assert.equal(await pp.tryPersonAsk(actor, 'remind me to call mum'), null, 'an unrelated message closes the question and falls through')
assert.equal(tables.agent_activity[1].metadata_json.open, false)
console.log('✓ two Nithins: numbered candidates, number/word/address replies pick one, bare-name note shown, question closes')

// 7. Wiring: both surfaces, and the brain leaves these alone.
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8'), brain = readFileSync('lib/agent/brain.ts', 'utf8')
assert.match(wa, /m\.tryPersonAsk\(prepActor, text\)/); assert.match(wa, /text\.trim\(\)\.length <= 60\)\) \{/, 'short replies reach the choice handler'); assert.match(dash, /m\.tryPersonAsk\(actor,text\)/); assert.match(brain, /personAsk\(t\) !== null/)
console.log('✓ wired on WhatsApp and the dashboard; exact command for the brain')
console.log('People (7 Nov) checks passed')
