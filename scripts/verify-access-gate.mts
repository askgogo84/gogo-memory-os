// Behaviour of the WhatsApp access gate against a fake database.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.ADMIN_WHATSAPP_NUMBERS = '+918310441698'
const { supabaseAdmin } = await import('../lib/supabase-admin.ts')
const { checkWhatsAppAccess, WAITLIST_REPLY, BLOCKED_REPLY, INVITE_USED_UP_REPLY, INVITE_INVALID_REPLY, e164 } = await import('../lib/access/gate.ts')

type DB = { users: any[]; waitlist: any[]; fail?: string }
let db: DB
const writes: any[] = []
function table(name: string) {
  const filters: [string, string, any][] = []
  let op = 'select', payload: any = null
  const q: any = {
    select() { return q }, in(col: string, vals: any[]) { filters.push(['in', col, vals]); return q }, eq(col: string, v: any) { filters.push(['eq', col, v]); return q },
    limit() { return q }, insert(p: any) { op = 'insert'; payload = p; return q }, update(p: any) { op = 'update'; payload = p; return q },
    maybeSingle() { return run(true) }, then(res: any, rej: any) { return run(false).then(res, rej) },
  }
  async function run(single: boolean) {
    if (db.fail === `throw-${name}`) throw new Error('fixture database outage')
    if (db.fail === name) return { data: null, error: { code: '42703', message: 'column does not exist' } }
    if (db.fail === 'waitlist-insert' && name === 'waitlist' && op === 'insert') return { data: null, error: { code: 'DB_DOWN', message: 'fixture waitlist insert failed' } }
    const rows = (db as any)[name].filter((r: any) => filters.every(([k, c, v]) => k === 'in' ? v.includes(r[c]) : r[c] === v))
    if (op === 'insert') { if (rows.length && name === 'waitlist') return { error: { code: '23505' } }; (db as any)[name].push({ id: 'new', ...payload }); writes.push([name, 'insert', payload]); return { error: null } }
    if (op === 'update') { rows.forEach((r: any) => Object.assign(r, payload)); writes.push([name, 'update', payload]); return { error: null } }
    return { data: single ? rows[0] || null : rows, error: null }
  }
  return q
}
;(supabaseAdmin as any).from = table
// redeem_invite stand-in: 'goverdhan-abc234' has invites left, 'full-abc234' is used up, anything else is invalid.
const redeemed: any[] = []
;(supabaseAdmin as any).rpc = async (fn: string, args: any) => {
  assert.equal(fn, 'redeem_invite'); redeemed.push(args)
  if (args.p_code === 'goverdhan-abc234') return { data: [{ ok: true, reason: 'joined', redemption_id: 'r1', inviter_telegram_id: 100, remaining: 9 }], error: null }
  if (args.p_code === 'full-abc234') return { data: [{ ok: false, reason: 'used_up', redemption_id: null, inviter_telegram_id: 100, remaining: 0 }], error: null }
  return { data: [{ ok: false, reason: 'invalid', redemption_id: null, inviter_telegram_id: null, remaining: 0 }], error: null }
}
const JOIN = "Hi Gogo, I'm joining with invite goverdhan-abc234"

// Admin always passes, even with no row.
db = { users: [], waitlist: [] }
assert.deepEqual(await checkWhatsAppAccess('+918310441698'), { allow: true, reason: 'admin' })
// Existing user (stored as whatsapp:+91…) keeps access.
db = { users: [{ telegram_id: 1, whatsapp_id: 'whatsapp:+919900000001', access_status: 'active' }], waitlist: [] }
assert.equal((await checkWhatsAppAccess('+919900000001')).reason, 'user')
// Blocked user is held with the blocked reply.
db.users[0].access_status = 'blocked'
assert.deepEqual(await checkWhatsAppAccess('+919900000001'), { allow: false, reason: 'blocked', reply: BLOCKED_REPLY })
// New number: added to the waitlist, told once.
db = { users: [], waitlist: [] }
const first = await checkWhatsAppAccess('+919900000002', 'Divya')
assert.deepEqual(first, { allow: false, reason: 'waitlist', reply: WAITLIST_REPLY })
assert.equal(db.waitlist[0].phone_e164, '+919900000002'); assert.equal(db.waitlist[0].source, 'whatsapp'); assert.equal(db.waitlist[0].country, 'IN'); assert.equal(db.waitlist[0].profile_name, 'Divya')
// Second message the same day: held silently.
assert.deepEqual(await checkWhatsAppAccess('+919900000002'), { allow: false, reason: 'waitlist', reply: null })
// A day later: reminded once more.
db.waitlist[0].last_notified_at = new Date(Date.now() - 25 * 3600_000).toISOString()
assert.equal((await checkWhatsAppAccess('+919900000002')).reply, WAITLIST_REPLY)
// Approved: gets in, and the row becomes joined.
db.waitlist[0].status = 'invited'
assert.deepEqual(await checkWhatsAppAccess('+919900000002'), { allow: true, reason: 'approved' })
assert.equal(db.waitlist[0].status, 'joined')
// Website signup that was never approved is held too.
db = { users: [], waitlist: [{ id: 'w', phone_e164: '+971501234567', status: 'waiting', last_notified_at: null }] }
assert.equal((await checkWhatsAppAccess('+971501234567')).reason, 'waitlist')
// Authorization cannot be inferred from a failed users or waitlist read, even
// when a legacy migration has not been applied. No reply/send for unknown owner.
const unavailable = { allow: false, reason: 'gate_error', reply: null }
db = { users: [{ telegram_id: 7, whatsapp_id: '+919900000003', access_status: 'blocked' }], waitlist: [], fail: 'users' }
assert.deepEqual(await checkWhatsAppAccess('+919900000003'), unavailable, 'a blocked owner cannot bypass the gate during users lookup failure')
db = { users: [], waitlist: [], fail: 'waitlist' }
assert.deepEqual(await checkWhatsAppAccess('+919900000003'), unavailable, 'unapproved owner cannot bypass the gate during waitlist lookup failure')
db = { users: [], waitlist: [] }
assert.deepEqual(await checkWhatsAppAccess('not-a-number'), unavailable, 'unverifiable From must not be admitted')
assert.deepEqual(await checkWhatsAppAccess(''), unavailable, 'empty From must not be admitted')
db = { users: [], waitlist: [], fail: 'throw-users' }
assert.deepEqual(await checkWhatsAppAccess('+919900000003'), unavailable, 'exceptional DB outage must also fail closed')
db = { users: [], waitlist: [], fail: 'waitlist-insert' }
assert.deepEqual(await checkWhatsAppAccess('+919900000003'), unavailable, 'failed waitlist insert cannot accidentally authorize a new number')
// Kill switch.
process.env.ACCESS_GATE_ENABLED = 'false'
db = { users: [], waitlist: [] }
assert.deepEqual(await checkWhatsAppAccess('+919900000004'), { allow: true, reason: 'gate_off' })
delete process.env.ACCESS_GATE_ENABLED
// Invite links: a new number with a live code skips the waitlist; its waitlist row says how it joined.
db = { users: [], waitlist: [] }
const inv = await checkWhatsAppAccess('+919900000010', 'Divya', JOIN)
assert.equal(inv.allow, true); assert.equal(inv.reason, 'invited'); assert.equal(inv.invite?.inviterTelegramId, 100); assert.equal(inv.invite?.remaining, 9)
assert.deepEqual(redeemed.at(-1), { p_code: 'goverdhan-abc234', p_phone: '+919900000010', p_name: 'Divya' })
assert.equal(db.waitlist[0].status, 'joined'); assert.equal(db.waitlist[0].approved_by, 'invite:goverdhan-abc234')
// A number already waiting gets in with an invite too.
db = { users: [], waitlist: [{ id: 'w2', phone_e164: '+919900000011', status: 'waiting', last_notified_at: new Date().toISOString() }] }
assert.equal((await checkWhatsAppAccess('+919900000011', 'Friend', JOIN)).reason, 'invited')
assert.equal(db.waitlist[0].status, 'joined'); assert.equal(redeemed.at(-1).p_name, null, 'placeholder name not stored')
// Used-up / wrong code: waitlist, told why.
db = { users: [], waitlist: [] }
assert.deepEqual(await checkWhatsAppAccess('+919900000012', 'Nithin', "I'm joining with invite full-abc234"), { allow: false, reason: 'waitlist', reply: INVITE_USED_UP_REPLY })
db = { users: [], waitlist: [] }
assert.deepEqual(await checkWhatsAppAccess('+919900000013', 'Nithin', 'invite nobody-abc234'), { allow: false, reason: 'waitlist', reply: INVITE_INVALID_REPLY })
// Codes never change anything for existing users, admins or blocked numbers.
const before = redeemed.length
db = { users: [{ telegram_id: 1, whatsapp_id: '+919900000001', access_status: 'active' }], waitlist: [] }
assert.deepEqual(await checkWhatsAppAccess('+919900000001', 'Divya', JOIN), { allow: true, reason: 'user' })
assert.deepEqual(await checkWhatsAppAccess('+918310441698', 'Gogo', JOIN), { allow: true, reason: 'admin' })
db = { users: [], waitlist: [{ id: 'b', phone_e164: '+919900000014', status: 'blocked', last_notified_at: new Date().toISOString() }] }
assert.equal((await checkWhatsAppAccess('+919900000014', 'x', JOIN)).reason, 'blocked')
assert.equal(redeemed.length, before, 'no redemption attempted for user/admin/blocked')
// Gate off: still recorded for new numbers.
process.env.ACCESS_GATE_ENABLED = 'false'
db = { users: [], waitlist: [] }
const off = await checkWhatsAppAccess('+919900000015', 'Divya', JOIN)
assert.equal(off.reason, 'gate_off'); assert.equal(off.invite?.redemptionId, 'r1')
delete process.env.ACCESS_GATE_ENABLED
assert.equal(e164('whatsapp:+91 98450 12345'), '+919845012345')
assert.equal(e164('9845012345'), '+919845012345')
console.log('verify-access-gate: ok')
