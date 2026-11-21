// 21 Nov (handoff calling gap): "call Toit and ask if they're open Sunday" has no business word, so it was read as a note
// to self. A venue the person already called through an approved call plan is recognised, and that plan's number is
// reused. A person's name, a time, a test call or another branch of the venue is never matched.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const v: any = await import('../lib/agent/voice-call')

// Matching a typed name to a saved venue.
assert.equal(v.sameVenue('Toit', 'Toit Indiranagar'), true)
assert.equal(v.sameVenue('toit indiranagar', 'Toit Indiranagar'), true)
assert.equal(v.sameVenue('Toit Koramangala', 'Toit Indiranagar'), false, 'another branch')
assert.equal(v.sameVenue('To', 'Toit'), false, 'too short')
assert.equal(v.sameVenue('Toi', 'Toit'), false, 'a word prefix, not a word')
assert.equal(v.sameVenue("Truffles", "Truffles St. Marks Road"), true)

// Which messages even ask: "call <name> and/to <ask>" that the parser did not already take.
assert.equal(v.parseCallCommand("call Toit and ask if they're open on Sunday"), null, 'before: not a call')
assert.equal(v.unknownCallee("call Toit and ask if they're open on Sunday"), 'Toit')
assert.equal(v.unknownCallee('Can you call Truffles and check if they have parking?'), 'Truffles')
for (const t of ['call Toit and ask if he is coming tonight', 'call Toit and tell her I am late', 'call mom and ask about lunch', 'call Divya tomorrow and ask about the docs', 'call Toit on 080 1234 5678 and ask if they are open', 'remind me to call Toit', 'call Novotel hotel and ask for a late checkout', 'test call me'])
  assert.equal(v.unknownCallee(t), null, t)

// Owner-bound lookup in the person's own call runs.
// Review (PR #1561): WhatsApp-created owners are negative ids.
const OWNER = '-3902574319362690'
const typed = 'the number you gave'
const runs = [
  { telegram_id: OWNER, type: 'voice_call', status: 'completed', started_at: '2026-11-17T08:18:00Z', metadata_json: { plan: { venue: 'Toit Indiranagar', to: '+918012345678', test: false, source: typed } } },
  { telegram_id: OWNER, type: 'voice_call', status: 'completed', started_at: '2026-11-18T08:18:00Z', metadata_json: { plan: { venue: 'your phone', to: '+918884501501', test: true, source: typed } } },
  { telegram_id: OWNER, type: 'voice_call', status: 'completed', started_at: '2026-11-16T08:18:00Z', metadata_json: { plan: { venue: 'Divya Dental', to: 'not-a-number', test: false, source: typed } } },
  { telegram_id: OWNER, type: 'voice_call', status: 'completed', started_at: '2026-11-15T08:18:00Z', metadata_json: { plan: { venue: 'Meghana Foods', to: '+918022222222', test: false, source: 'justdial.com' } } },
  { telegram_id: OWNER, type: 'voice_call', status: 'failed', started_at: '2026-11-14T08:18:00Z', metadata_json: { plan: { venue: 'Truffles', to: '+918033333333', test: false, source: typed } } },
  { telegram_id: OWNER, type: 'voice_call', status: 'completed', started_at: '2026-11-13T08:18:00Z', metadata_json: { plan: { venue: 'Hari Super Sandwich', to: '+918044444444', test: false, source: typed } } },
  { telegram_id: '999', type: 'voice_call', status: 'completed', started_at: '2026-11-19T08:18:00Z', metadata_json: { plan: { venue: 'Corner House', to: '+918099999999', test: false, source: typed } } },
]
const friends = [{ owner_telegram_id: OWNER, name: 'Hari Prasad' }]
const seen: any[] = []
const db = { from: (table: string) => {
  assert.ok(['agent_runs', 'friend_contacts'].includes(table), table); const f: any[] = []
  const rowsOf = table === 'agent_runs' ? runs : friends
  const q: any = { select: () => q, eq: (k: string, val: any) => { seen.push([table, k, val]); f.push((r: any) => String(r[k]) === String(val)); return q }, order: () => q, limit: () => q,
    then: (res: any) => Promise.resolve({ data: rowsOf.filter((r: any) => f.every(fn => fn(r))), error: null }).then(res) }
  for (const w of ['insert', 'update', 'upsert', 'delete']) q[w] = () => { throw new Error('write') }
  return q
} }
assert.deepEqual(await v.knownCallVenue(OWNER, 'Toit', db), { venue: 'Toit Indiranagar', phone: '+918012345678', source: 'the number you gave for Toit Indiranagar earlier' })
assert.equal(await v.knownCallVenue(OWNER, 'Meghana Foods', db), null, 'a web-looked-up number is never reused')
assert.equal(await v.knownCallVenue(OWNER, 'Truffles', db), null, 'a call the provider rejected never vouches for its number')
assert.equal(await v.knownCallVenue(OWNER, 'Hari', db), null, 'a friend called Hari is a person, not Hari Super Sandwich')
assert.equal(await v.knownCallVenue('4205611234567', 'Toit', db), null, 'a different (positive) owner sees nothing')
assert.ok(seen.some(([t, k, val]) => t === 'agent_runs' && k === 'telegram_id' && val === OWNER), 'exact owner string')
assert.equal(await v.knownCallVenue(OWNER, 'Corner House', db), null, "another person's call is never matched")
assert.equal(await v.knownCallVenue(OWNER, 'your phone', db), null, 'test calls never count')
assert.equal(await v.knownCallVenue(OWNER, 'Divya Dental', db), null, 'a plan without a valid +91 number never counts')
assert.equal(await v.knownCallVenue(OWNER, 'mom', db), null)
assert.equal(await v.knownCallVenue('12abc', 'Toit', db), null, 'malformed owner')
assert.equal(await v.knownCallVenue(OWNER, 'Toit', { from: () => { throw new Error('down') } }), null, 'a failed read is not a match')
console.log('✓ a venue called before is recognised by name; other people, test calls and bad numbers are not')

// The flow: tryVoiceCall builds the general plan with the earlier number (still needs the explicit yes).
const ts: any = (await import('typescript')).default
const { runInNewContext } = await import('node:vm')
const src = readFileSync(new URL('../lib/agent/voice-call.ts', import.meta.url), 'utf8')
async function run(text: string, iso = '2026-11-22T06:30:00Z') {
  const exports: any = {}; const saved: any[] = []; let provider = 0
  const Real = Date
  class FixedDate extends Real { constructor(...a: any[]) { super(...(a.length ? a : [iso]) as []) } static now() { return new Real(iso).getTime() } }
  const mocks: any = {
    'node:crypto': await import('node:crypto'), '@/lib/supabase-admin': { supabaseAdmin: db },
    './voice-call-execution': { voicePlanHash: () => 'h', voiceAttemptId: () => 'a', beginApprovedVoiceCall: async () => { provider++; return { status: 'blocked' } } },
    './policy': { capabilityPaused: () => false, capabilityPausedText: () => '' },
    '@/lib/agent/restaurant-reservation': {},
    '@/lib/bot/handlers/followup-state': { getLatestFollowupState: async () => null, saveFollowupState: async (_t: any, _k: any, p: any) => { saved.push(p) }, clearFollowupState: async () => {} },
  }
  runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (n: string) => { if (!(n in mocks)) throw Error('Unexpected dependency ' + n); return mocks[n] }, console, Date: FixedDate, Intl, URL, AbortSignal,
      process: { env: {} }, fetch: async () => { provider++; return new Response('{}') } })
  const reply = await exports.tryVoiceCall({ actor: { userId: 'u', legacyTelegramId: Number(OWNER), whatsappId: '+918884501501', name: 'Nithin' }, text, surface: 'whatsapp' })
  return { reply, saved, provider }
}
{
  const r = await run("call Toit and ask if they're open on Sunday")
  assert.match(r.reply.text, /CALL PLAN/); assert.equal(r.reply.handledBy, 'voice-call-plan')
  assert.equal(r.saved.length, 1); assert.equal(r.saved[0].plan.to, '+918012345678'); assert.equal(r.saved[0].plan.venue, 'Toit Indiranagar')
  assert.equal(r.saved[0].plan.source, 'the number you gave for Toit Indiranagar earlier'); assert.equal(r.saved[0].plan.kind, 'general')
  assert.match(r.reply.text, /To: Toit Indiranagar · .*\(the number you gave for Toit Indiranagar earlier\)/, 'the card shows the venue, the number and where it came from')
  assert.equal(r.provider, 0, 'a plan is only shown; the call waits for the yes')
  assert.equal((await run('call Divya and ask if she is free')).reply, null, 'a person is still not a call')
  assert.equal((await run("call Toit Koramangala and ask if they're open")).reply, null, 'an unknown branch is still not a call')
  const night = await run("call Toit and ask if they're open on Sunday", '2026-11-21T17:00:00Z')
  assert.match(night.reply.text, /^It's 10:30 pm in India, so I won't call now/); assert.equal(night.saved.length, 0)
}
console.log('✓ "call Toit and ask…" shows a call plan with the earlier number; people and unknown branches are untouched')

// Both routes count a known venue as a call request, so goal intake and the brain leave it to the call flow.
for (const f of ['../app/api/dashboard/chat/route.ts', '../app/api/webhooks/whatsapp/route.ts']) {
  const r = readFileSync(new URL(f, import.meta.url), 'utf8')
  assert.match(r, /isCallRequestFor\(String\((?:user\.telegram_id|resolvedUser\.telegramId)\), ?text\)/, f)
  assert.doesNotMatch(r, /parseCallCommand\(text\)\?\.kind ?=== ?'book'/, f)
}
console.log('✓ both surfaces route a known venue to the call flow')
