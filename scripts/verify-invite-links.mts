// Invite links: the migration run for real in PGlite (grants, 10-invite cap, one invite per number, retries,
// rollback), the pure helpers (codes, join message parsing, replies, masking) and the webhook/page wiring.
// Run: npx tsx scripts/verify-invite-links.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const core = await import('../lib/invites/core.ts')

// ── SQL ──────────────────────────────────────────────────────────────────────
const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;`)
const up = readFileSync('supabase/migrations/20261023120000_invite_links.sql', 'utf8')
const down = readFileSync('supabase/migrations/20261023120000_invite_links.rollback.sql', 'utf8')
await db.exec(up); await db.exec(up) // idempotent
const fails = async (sql: string, re: RegExp, why: string) => {
  let err: any = null
  try { await db.exec(sql) } catch (e) { err = e }
  assert.ok(err, `${why}: expected failure`); assert.match(String(err?.message || err), re, why)
  await db.exec('reset role')
}
for (const role of ['anon', 'authenticated']) {
  await fails(`set role ${role}; select * from public.invite_codes;`, /permission denied/, `${role} cannot read codes`)
  await fails(`set role ${role}; select * from public.redeem_invite('goverdhan-abc234', '+919900000001', 'x');`, /permission denied/, `${role} cannot redeem`)
}
await db.exec(`set role service_role; insert into public.invite_codes (code, inviter_telegram_id) values ('goverdhan-abc234', 100);`)
await fails(`set role service_role; insert into public.invite_codes (code, inviter_telegram_id) values ('Bad Code', 101);`, /check/, 'code shape enforced')
await fails(`set role service_role; insert into public.invite_codes (code, inviter_telegram_id) values ('goverdhan-zzz234', 100);`, /duplicate|unique/, 'one code per user')
const redeem = async (phone: string, code = 'goverdhan-abc234', name: string | null = 'Divya') =>
  (await db.query<any>(`select * from public.redeem_invite($1, $2, $3)`, [code, phone, name])).rows[0]
await db.exec('set role service_role')
let r = await redeem('+919900000001')
assert.equal(r.ok, true); assert.equal(r.reason, 'joined'); assert.equal(Number(r.inviter_telegram_id), 100); assert.equal(r.remaining, 9)
r = await redeem('+919900000001')
assert.deepEqual([r.ok, r.reason, r.remaining], [true, 'already_joined', 9], 'retry is idempotent')
assert.equal((await db.query<any>(`select count(*)::int n from public.invite_redemptions`)).rows[0].n, 1)
r = await redeem('+919900000099', 'GOVERDHAN-ABC234 ')
assert.equal(r.reason, 'joined', 'code is case/space tolerant')
for (let i = 2; i < 10; i++) assert.equal((await redeem(`+9199000000${String(i).padStart(2, '0')}`)).ok, true)
r = await redeem('+919900000050')
assert.deepEqual([r.ok, r.reason, r.remaining], [false, 'used_up', 0], 'invite 11 refused')
assert.equal((await db.query<any>(`select count(*)::int n from public.invite_redemptions where code = 'goverdhan-abc234'`)).rows[0].n, 10)
assert.equal((await redeem('+919900000051', 'nobody-abc234')).reason, 'invalid')
await db.exec(`insert into public.invite_codes (code, inviter_telegram_id) values ('nithin-xyz789', 200);`)
assert.equal((await redeem('+919900000001', 'nithin-xyz789')).reason, 'used_other_invite', 'one invite per number')
await db.exec(`update public.invite_codes set active = false where code = 'nithin-xyz789'`)
assert.equal((await redeem('+919900000052', 'nithin-xyz789')).reason, 'invalid', 'deactivated code refused')
await db.exec(`insert into public.invite_codes (code, inviter_telegram_id) values ('divya-def456', 300);`)
await fails(`set role service_role; select * from public.redeem_invite('divya-def456', 'not-a-phone', null);`, /check/, 'phone shape enforced')
await db.exec('reset role')
await db.exec(down)
assert.equal((await db.query<any>(`select count(*)::int n from pg_tables where tablename like 'invite_%'`)).rows[0].n, 0, 'rollback clean')
console.log('SQL: grants, cap of 10, one invite per number, idempotent retry, rollback')

// ── Pure helpers ─────────────────────────────────────────────────────────────
let k = 0
const code = core.makeInviteCode('Goverdhan Mandyam', () => (k++ * 7) % 31)
assert.match(code, /^goverdhan-[a-z0-9]{6}$/); assert.ok(core.CODE_RE.test(code))
assert.match(core.makeInviteCode('Friend', () => 0), /^gogo-a{6}$/)
assert.match(core.makeInviteCode('दिव्या', () => 0), /^gogo-/)
assert.equal(core.extractInviteCode("Hi Gogo, I'm joining with invite goverdhan-7k2m9x"), 'goverdhan-7k2m9x')
assert.equal(core.extractInviteCode(core.joinMessage('divya-abc234')), 'divya-abc234')
assert.equal(core.extractInviteCode('invite code: Nithin-ABC234'), 'nithin-abc234')
assert.equal(core.extractInviteCode('remind me about the follow-up meeting'), null)
assert.equal(core.extractInviteCode('goverdhan-7k2m9x'), null, 'needs the word invite')
assert.equal(core.extractInviteCode('invite goverdhan-7k2m9x-extra'), null)
assert.equal(core.joinWhatsAppLink('divya-abc234'), "https://wa.me/17605483659?text=Hi%20Gogo%2C%20I'm%20joining%20with%20invite%20divya-abc234")
for (const t of ['Send me my invite link', 'send me my invite link.', 'invite friends', 'My invite link', 'Invite', 'referral']) assert.ok(core.isInviteLinkCommand(t), t)
for (const t of ['my invites', 'Who joined?', 'invite status', 'referral status']) assert.ok(core.isMyInvitesCommand(t), t)
for (const t of ['invite Divya to the meeting', 'send an invite to Nithin', 'add to calendar invite']) assert.ok(!core.isInviteLinkCommand(t) && !core.isMyInvitesCommand(t), t)
assert.deepEqual(core.inviteLinkReply({ code: 'goverdhan-7k2m9x', remaining: 10 }),
  { text: 'You have 10 invites left. Your invite link is below; share it with a friend.', link: 'https://app.askgogo.in/i/goverdhan-7k2m9x' })
assert.match(core.inviteLinkReply({ code: 'x-abc234', remaining: 1 }).text, /You have 1 invite left/)
assert.deepEqual(core.inviteLinkReply({ code: 'x-abc234', remaining: 0 }).link, null)
assert.equal(core.maskPhone('+919876543210'), '+91 98•••••210')
const mine = core.myInvitesReply({ code: 'goverdhan-7k2m9x', remaining: 8, joined: [
  { name: 'Divya Rao', phone: '+919876543210', joinedAt: '2026-10-21T06:00:00Z' }, { name: 'Friend', phone: '+919812345678', joinedAt: '2026-10-22T06:00:00Z' }] })
assert.match(mine, /^2 friends joined with your invite\. 8 invites left\./)
assert.match(mine, /• Divya, joined 21 Oct\n• \+91 98•••••678, joined 22 Oct/)
assert.ok(!mine.includes('9876543210'), 'full phone never shown')
assert.match(core.myInvitesReply({ code: 'g-abc234', remaining: 10, joined: [] }), /^No one has joined with your invite yet\. You have 10 invites left\./)
assert.equal(core.inviterJoinedText({ friendName: 'Nithin K L', friendPhone: '+919900000001', remaining: 9 }), '🎉 Nithin joined AskGogo with your invite. You have 9 invites left.')
assert.equal(core.inviteeWelcomeLine('Goverdhan M D'), "🎉 You're in. Goverdhan invited you to AskGogo.")
assert.equal(core.inviteeWelcomeLine('Friend'), "🎉 You're in. A friend invited you to AskGogo.")
console.log('Helpers: codes, join message, commands, replies, masking')

// ── Wiring ───────────────────────────────────────────────────────────────────
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.ok(wa.includes("await checkWhatsAppAccess(from, profileName, String(formData.get('Body') || ''))"), 'gate sees the message text')
const joinAt = wa.indexOf('access.invite?.ok'), cmdAt = wa.indexOf('isInviteLinkCommand(bodyText)'), menuAt = wa.indexOf('Interactive onboarding menu for new users')
assert.ok(wa.indexOf("await resolveUser({ channel: 'whatsapp'") < joinAt && joinAt < cmdAt && cmdAt < menuAt, 'invite join + commands run after resolveUser, before the onboarding menu')
const page = readFileSync('app/i/[code]/page.tsx', 'utf8')
assert.match(page, /params: Promise<\{ code: string \}>/); assert.match(page, /robots: \{ index: false/)
const flow = readFileSync('app/i/[code]/invite-flow.tsx', 'utf8')
assert.ok(!/phone/i.test(flow), 'invite page never handles phone numbers')
assert.match(flow, /<Companion state="idle"/); assert.ok(!flow.includes('gogo-figure'), 'designed Gogo, not the old meditating figure')
assert.match(wa, /if \(link\) await sendWhatsAppMessage\(from, link\)/, 'link sent on its own for the preview card')
const store = readFileSync('lib/invites/store.ts', 'utf8')
assert.match(store, /key: `invite-joined\/\$\{p\.redemptionId\}`/, 'inviter told once per join')
console.log('verify-invite-links: ok')
