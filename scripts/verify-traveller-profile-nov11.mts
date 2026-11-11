// 11 Nov (owner): "it should remember everything about me, should not ask every time". Saved one-traveller booking
// details: opt-in, exact owner, validated, used only with the person's YES, deletable with "forget my travel details".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const rows = new Map<string, any>()
const ops: string[] = []
const table = (name: string) => {
  assert.equal(name, 'gogo_traveller_profiles')
  const q: any = { _f: {} as any }
  q.select = () => q; q.eq = (k: string, v: any) => { q._f[k] = v; return q }
  q.maybeSingle = async () => ({ data: rows.get(String(q._f.telegram_id)) || null, error: null })
  q.upsert = async (row: any) => { ops.push('upsert'); rows.set(String(row.telegram_id), row); return { error: null } }
  q.delete = () => ({ eq: async (_k: string, v: any) => { ops.push('delete'); rows.delete(String(v)); return { error: null } } })
  return q
}
const exports: any = {}
const src = ts.transpileModule(readFileSync('lib/agent/traveller-profile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const env: any = { GOGO_TRAVELLER_PROFILE: '-884501501' }
runInNewContext(src, { exports, process: { env }, String, Number, Set, Date, require: (n: string) => n === '@/lib/supabase-admin' ? { supabaseAdmin: { from: table } } : (() => { throw Error(n) })() })
const T = exports
const owner = { userId: 'u1', legacyTelegramId: -884501501 }, other = { userId: 'u2', legacyTelegramId: 12345 }
const p = { title: 'Mr', name: 'Goverdhan M D', email: 'goverdhan.md@gmail.com', mobile: '8310441698', seat: 'free' }

assert.equal(T.exactOwner({ legacyTelegramId: 2 ** 60 }), null, 'unsafe ids never read or write')
assert.equal(T.exactOwner({ legacyTelegramId: '0123' }), null)
assert.equal(T.travellerProfileEnabled(owner, env), true); assert.equal(T.travellerProfileEnabled(other, env), false)
assert.equal(T.travellerProfileEnabled(owner, { GOGO_TRAVELLER_PROFILE: 'on' }), false, 'no blanket switch')
assert.equal(T.validProfile({ ...p, full_name: p.name })?.name, 'Goverdhan M D')
assert.equal(T.validProfile({ ...p, full_name: p.name, mobile: '12345' }), null)
assert.equal(T.validProfile({ ...p, full_name: p.name, title: 'Dr' }), null)

assert.equal(await T.saveTravellerProfile(other, p), false, 'not opted in: nothing saved'); assert.equal(rows.size, 0)
assert.equal(await T.saveTravellerProfile(owner, p), true)
assert.deepEqual(JSON.parse(JSON.stringify(await T.loadTravellerProfile(owner))), p)
assert.equal(await T.loadTravellerProfile(other), null)
assert.equal(await T.loadTravellerProfile({ userId: 'someone-else', legacyTelegramId: -884501501 }), null, 'row bound to its user id')
for (const say of ['forget my travel details', 'Delete my booking details', 'please remove my saved traveller details.', 'forget my travel details please', 'forget my details']) assert.ok(T.FORGET_TRAVEL_DETAILS.test(say), say)
assert.equal(T.FORGET_TRAVEL_DETAILS.test('forget my dentist appointment'), false)
assert.equal(await T.forgetTravellerProfile(owner), true); assert.equal(await T.loadTravellerProfile(owner), null)

// Wiring: booking reads it first for one traveller, saves after details, and says so only when saved.
const fb = readFileSync('lib/agent/flight-booking.ts', 'utf8')
assert.match(fb, /if \(count === 1 && opts\.domestic === true\) \{\n    const durable = await loadTravellerProfile\(actor\)/, 'domestic only: no date of birth is saved')
assert.match(fb, /gender: genderOf\(durable\.title\)/)
assert.match(fb, /const remembered = travellers\.length === 1 && isDomesticIndiaTrip\(last\.context\) && travellerProfileEnabled\(actor\)/)
assert.match(fb, /export async function forgetBookingDetails[\s\S]{0,1600}profile: null, pii_purged: true/, 'forget also clears the recent booking copy')
assert.match(fb, /remembered \? 'I’ve saved your name, email, mobile and seat choice for next time; say \*forget my travel details\* to remove them\.' : 'Your details are deleted after 24 hours\.'/)
// Using saved details still needs YES (reuse path) and the booking still needs APPROVE.
assert.match(fb, /Use the same details as your last booking\?/)
for (const route of ['app/api/webhooks/whatsapp/route.ts', 'app/api/dashboard/chat/route.ts']) {
  const r = readFileSync(route, 'utf8')
  assert.match(r, /forgetBookingDetails\(/)
  const forget = r.indexOf('FORGET_TRAVEL_DETAILS'), memory = r.indexOf('memoryTurn')
  assert.ok(forget > 0 && forget < memory, `${route}: forget is checked before the memory handler`)
}
// Migration: service role only, rollback present.
const sql = readFileSync('supabase/migrations/20261111120000_gogo_traveller_profiles.sql', 'utf8')
assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on table public\.gogo_traveller_profiles from public, anon, authenticated/)
assert.match(readFileSync('supabase/migrations/20261111120000_gogo_traveller_profiles.rollback.sql', 'utf8'), /drop table if exists public\.gogo_traveller_profiles/)
console.log('PASS traveller profile: opt-in, exact owner, validated, forgettable, wired')
