// Remember and suggest, Phase 1 (5 Nov): food taste the person told Gogo. Saves only what was said, never infers a
// diet, dedupes, forgets, stays owner-scoped, and falls through when the table isn't there yet.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'test'
const read = (f: string) => readFileSync(f, 'utf8')

const { supabaseAdmin } = await import('../lib/supabase-admin')
const t = await import('../lib/agent/taste')

// 1. Detection: stated facts only.
const d = t.detectTasteStatement
assert.deepEqual(d("I'm veg on Tuesdays"), { kind: 'diet_stated', value: 'Veg on Tuesdays', context: 'Tuesdays' })
assert.deepEqual(d('I am vegetarian'), { kind: 'diet_stated', value: 'Veg', context: null })
assert.deepEqual(d('remember that I am vegan'), { kind: 'diet_stated', value: 'Vegan', context: null })
assert.deepEqual(d('I eat jain food'), { kind: 'diet_stated', value: 'Jain', context: null })
assert.equal(d("I'm Jain"), null, 'a surname is not a diet')
assert.equal(d("I'm vegetarian since 2010 mostly"), null)
assert.deepEqual(d('keep lunch under ₹300'), { kind: 'budget', value: 'Lunch under ₹300', context: 'Lunch' })
assert.deepEqual(d('my food budget is 400'), { kind: 'budget', value: 'under ₹400', context: null })
assert.deepEqual(d("I don't eat mushrooms"), { kind: 'avoids', value: 'No mushrooms', context: null })
assert.deepEqual(d('no onion garlic please'), { kind: 'avoids', value: 'No onion garlic', context: null })
assert.deepEqual(d('I hate olives'), { kind: 'avoids', value: 'No olives', context: null })
assert.deepEqual(d('I love Oven Story pizza'), { kind: 'likes', value: 'Likes: Oven Story pizza', context: null })
assert.deepEqual(d('my favourite dish is biryani'), { kind: 'likes', value: 'Likes: biryani', context: null })
for (const chat of ['I like my job', "I can't stand my boss", 'avoid traffic', 'no thanks please', 'no reminders please', 'I hate Mondays',
  'never mind', "I don't have time", 'I am going home', "I'm fine", 'keep it short', 'are you veg?', 'I love you', "I'm happy", 'my name is Raj',
  'I love Bangalore', 'i prefer email', 'I love pizza, can you find one nearby', 'I love biryani find me one', 'I want pizza tonight', "I don't eat mushrooms so suggest something"])
  assert.equal(d(chat), null, `ordinary chat stays chat: ${chat}`)
console.log('✓ saves only what the person states about their food; ordinary chat and surnames are left alone')

assert.ok(t.isTasteList('what do you know about my food'))
assert.ok(t.isTasteList('What do you know about my taste?'))
assert.ok(t.isTasteList('my food preferences'))
assert.ok(!t.isTasteList('what do you know about me'), 'the memory command keeps its own phrase')
assert.ok(!t.isTasteList('my preferences'), 'standing rules keep their own phrase')
assert.deepEqual(t.detectTasteForget('forget my food taste'), { all: true })
assert.deepEqual(t.detectTasteForget('forget no mushrooms'), { match: 'no mushrooms' })
assert.deepEqual(t.detectTasteForget("forget that I'm veg on Tuesdays"), { match: 'veg on Tuesdays' })
console.log('✓ list and forget phrases')

// 2. Store behaviour against a fake that behaves like PostgREST for the calls taste.ts makes.
type Row = Record<string, any>
let rows: Row[] = []
let missing = false
let seq = 0
const calls: string[] = []
function q(table: string) {
  const f: Array<(r: Row) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select', patch: Row = {}, ins: Row | null = null, lim = 1e9
  const b: any = {
    select() { op = 'select'; return b },
    update(p: Row) { op = 'update'; patch = p; return b },
    insert(r: Row) { op = 'insert'; ins = r; return b },
    eq(k: string, v: any) { calls.push(`eq:${k}:${typeof v}`); f.push(r => r[k] === v); return b },
    is(k: string, v: any) { f.push(r => (r[k] ?? null) === v); return b },
    in(k: string, vs: any[]) { f.push(r => vs.includes(r[k])); return b },
    order() { return b },
    limit(n: number) { lim = n; return b },
    then(res: any, rej: any) {
      const err = missing ? { message: 'relation "public.taste_facts" does not exist', code: '42P01' } : null
      let out: any = { data: null, error: err }
      if (!err) {
        assert.equal(table, 'taste_facts')
        if (op === 'insert') {
          const r: Row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: '2026-11-05T06:00:00Z', forgotten_at: null, ...ins }
          const dup = rows.some(x => !x.forgotten_at && x.telegram_id === r.telegram_id && x.kind === r.kind && x.value.toLowerCase() === r.value.toLowerCase() && (x.context || '') === (r.context || ''))
          if (dup) out = { data: null, error: { message: 'duplicate key value violates unique constraint "taste_facts_live_unique"' } }
          else rows.push(r)
        } else {
          const hit = rows.filter(r => f.every(fn => fn(r)))
          if (op === 'update') hit.forEach(r => Object.assign(r, patch))
          else out = { data: hit.slice(0, lim).map(r => ({ ...r })), error: null }
        }
      }
      return Promise.resolve(out).then(res, rej)
    },
  }
  return b
}
;(supabaseAdmin as any).from = (table: string) => q(table)

const A = '919900000001234567', B = '919900000007654321' // longer than 2^53: must stay strings
assert.equal(await t.tryTasteCommand({ telegramId: A, text: "I'm veg on Tuesdays" }) !== null, true)
assert.match(String(await t.tryTasteCommand({ telegramId: A, text: "I don't eat mushrooms" })), /^Got it: No mushrooms/)
assert.match(String(await t.tryTasteCommand({ telegramId: A, text: 'remember I do not eat mushrooms' })), /^Noted again: No mushrooms/, 'dedupe')
assert.equal(rows.filter(r => r.telegram_id === A && r.kind === 'avoids').length, 1)
assert.equal(rows.find(r => r.value === 'No mushrooms')!.evidence_count, 2)
await t.tryTasteCommand({ telegramId: A, text: 'keep lunch under ₹300' })
await t.tryTasteCommand({ telegramId: A, text: 'keep lunch under ₹350' })
assert.deepEqual(rows.filter(r => r.kind === 'budget' && !r.forgotten_at).map(r => r.value), ['Lunch under ₹350'], 'a new budget replaces the old one')
await t.tryTasteCommand({ telegramId: B, text: 'I love biryani' })
assert.ok(rows.every(r => typeof r.telegram_id === 'string' && [A, B].includes(r.telegram_id)), 'ids saved exactly, as text')
assert.ok(rows.every(r => r.source === 'said'), 'Phase 1 only saves what was said')
assert.ok(!calls.some(c => c.startsWith('eq:telegram_id:') && !c.endsWith('string')), 'owner filter is always a string')

const listA = String(await t.tryTasteCommand({ telegramId: A, text: 'what do you know about my food' }))
assert.match(listA, /Veg on Tuesdays/); assert.match(listA, /No mushrooms/); assert.match(listA, /Lunch under ₹350/)
assert.doesNotMatch(listA, /biryani/, "another person's taste never shows")
assert.doesNotMatch(listA, /₹300/, 'the replaced budget is gone')

// Forget: by words, by id (only the owner's), and all.
assert.equal(await t.tryTasteCommand({ telegramId: A, text: 'forget my sister' }), null, 'no food match: memory forget handles it')
assert.match(String(await t.tryTasteCommand({ telegramId: A, text: 'forget no mushrooms' })), /forgotten: No mushrooms/)
assert.doesNotMatch(String(await t.tryTasteCommand({ telegramId: A, text: 'what do you know about my food' })), /mushrooms/)
const bId = rows.find(r => r.telegram_id === B)!.id
assert.deepEqual(await t.forgetTaste(A, { id: bId }), [], "can't forget another person's line")
assert.equal(rows.find(r => r.id === bId)!.forgotten_at, null)
assert.match(String(await t.tryTasteCommand({ telegramId: A, text: "I don't eat mushrooms" })), /^Got it/, 'saying it again after forgetting starts fresh')
assert.match(String(await t.tryTasteCommand({ telegramId: A, text: 'forget my food taste' })), /forgotten/)
assert.match(String(await t.tryTasteCommand({ telegramId: A, text: 'what do you know about my food' })), /haven't saved anything/)
assert.match(String(await t.tryTasteCommand({ telegramId: B, text: 'my food taste' })), /biryani/, "forgetting all of A's leaves B alone")

const block = await t.getTasteBlock(B)
assert.match(block, /Likes: biryani/); assert.match(block, /never order or pay on your own/); assert.match(block, /never assume a diet they did not state/)
assert.equal(await t.getTasteBlock(A), '')
console.log('✓ save, dedupe, replace budget/diet, list, forget (words, id, all); owner-scoped with ids kept as text')

// 3. Table not there yet: everything falls through to normal chat.
missing = true
assert.equal(await t.tryTasteCommand({ telegramId: A, text: "I don't eat mushrooms" }), null)
assert.equal(await t.tryTasteCommand({ telegramId: A, text: 'what do you know about my food' }), null)
assert.equal(await t.tryTasteCommand({ telegramId: A, text: 'forget no mushrooms' }), null)
assert.equal(await t.getTasteBlock(A), '')
missing = false
console.log('✓ safe before the migration: missing table means normal chat')

// 4. Wiring and migration.
const pm = read('lib/bot/process-message.ts')
assert.match(pm, /TASTE_PREFILTER\.test\(incomingText\)\s*\n\s*\?await import\('@\/lib\/agent\/taste'\)\.then\(m=>m\.tryTasteCommand\(\{telegramId:String\(resolvedUser\.telegramId\),text:incomingText\}\)/)
const wa = read('app/api/webhooks/whatsapp/route.ts')
assert.ok(wa.indexOf("m.tryTasteCommand({ telegramId: String(resolvedUser.telegramId), text })") < wa.indexOf('if (isMemoryControlCommand(text)) {'), 'taste forget runs before memory forget')
assert.match(read('lib/bot/handlers/preferences.ts'), /getTasteBlock\(String\(telegramId\)\)/)
const api = read('app/api/dashboard/taste/route.ts')
assert.match(api, /if \(!sameOrigin\(req\)\) return NextResponse\.json\(\{ error: 'forbidden' \}, \{ status: 403 \}\)/)
assert.match(api, /forgetTaste\(String\(session\.telegramId\), \{ id \}\)/)
assert.doesNotMatch(api + read('app/dashboard/(app)/taste/page.tsx') + read('lib/agent/taste.ts'), /parseInt|Number\(\s*(?:session|telegramId|tg|p\.telegramId)/, 'ids never pass through Number')
const sql = read('supabase/migrations/20261105100000_taste_facts.sql')
assert.match(sql, /DO NOT RUN WITHOUT OWNER APPROVAL/)
assert.match(sql, /telegram_id text not null/)
assert.match(sql, /enable row level security/)
assert.match(sql, /revoke all on table public\.taste_facts from public, anon, authenticated/)
assert.match(sql, /drop table if exists public\.taste_facts/)
console.log('✓ wired into WhatsApp (before memory forget), dashboard chat and suggestions; reviewed migration with rollback')
// 5. Live follow-ups (5 Nov): taste runs before the brain; "nearby" uses the saved home area; food results show taste.
assert.ok(wa.indexOf('m.tryTasteCommand({ telegramId: String(resolvedUser.telegramId), text })') < wa.indexOf("import('@/lib/agent/brain').then(m => m.runBrain("), 'WhatsApp: taste before the brain')
const chat = read('app/api/dashboard/chat/route.ts')
assert.ok(chat.indexOf("m.tryTasteCommand({telegramId:String(user.telegram_id),text})") > 0 && chat.indexOf("m.tryTasteCommand({telegramId:String(user.telegram_id),text})") < chat.indexOf("import('@/lib/agent/brain').then(m=>m.runBrain("), 'dashboard: taste before the brain')
assert.match(wa, /answerPlacesWithContext\(\{ text, telegramId: String\(resolvedUser\.telegramId\) \}\)/)
assert.match(chat, /answerPlacesWithContext\(\{text,telegramId:String\(user\.telegram_id\)\}\)/)
const ps = await import('../lib/agent/places-search')
assert.equal(ps.homeAreaFrom(['My gym locker is 42', 'I live in Rajajinagar, near the metro']), 'Rajajinagar')
assert.equal(ps.homeAreaFrom(['remember I stay in HSR Layout']), 'HSR Layout')
assert.equal(ps.homeAreaFrom(['I live in a flat']), null)
assert.equal(ps.homeAreaFrom(['I love pizza']), null)
assert.deepEqual(ps.nearbyRewrite('Find pizza nearby', 'Rajajinagar'), { text: 'Find pizza in Rajajinagar' })
assert.deepEqual(ps.nearbyRewrite('suggest cafes near me', 'Indiranagar'), { text: 'suggest cafes in Indiranagar' })
assert.deepEqual(ps.nearbyRewrite('Find pizza nearby', null), { needArea: true })
assert.equal(ps.nearbyRewrite('Find pizza in Rajajinagar', 'X'), null, 'an area already named is left alone')
assert.equal(ps.nearbyRewrite('what is nearby', 'X'), null)
assert.match(ps.nearbyNeedsArea('Find pizza nearby'), /^Which area should I look in\? Reply like "pizza in Rajajinagar"/)
assert.equal(ps.placeAsk('Find pizza in Rajajinagar')?.area, 'Rajajinagar', 'the rewrite is a normal place ask')
const pc = await import('../lib/agent/places-context')
assert.equal(pc.tasteNote(['No mushrooms', 'Lunch under ₹350', 'Likes: biryani']), '\n\nKept in mind: No mushrooms · Lunch under ₹350. Check the menu before ordering.')
assert.equal(pc.tasteNote(['Likes: biryani']), '')
// No home area saved: one question, no search. (memories read returns nothing in the fake.)
const fetchCalls: string[] = []
const fakeFetch: any = async (u: string) => { fetchCalls.push(String(u)); return { ok: true, json: async () => ({ places: [] }) } }
;(supabaseAdmin as any).from = (table: string) => table === 'memories'
  ? { select() { return this }, eq() { return this }, or() { return this }, order() { return this }, limit() { return Promise.resolve({ data: [], error: null }) } }
  : q(table)
assert.match(String(await pc.answerPlacesWithContext({ text: 'Find pizza nearby', telegramId: A }, fakeFetch)), /^Which area should I look in/)
assert.equal(fetchCalls.length, 0, 'no wrong-city search')
console.log('✓ taste runs before the brain; "nearby" uses the saved home area or asks once; food picks show the taste kept in mind')
console.log('Taste facts checks passed')
