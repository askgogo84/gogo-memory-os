// /api/splitbill and /api/test-gmail must not act on a caller-supplied phone or telegramId without the internal
// Bearer secret (24 Oct sweep). Offline. Run: npx tsx scripts/verify-security-sweep-oct24.mts
import assert from 'node:assert/strict'
process.env.CRON_SECRET = 'synthetic-internal'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'
let dbCalls = 0
globalThis.fetch = (async () => { dbCalls++; return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) }) as any
const { NextRequest } = await import('next/server')
const split = await import('../app/api/splitbill/route')
const gmail = await import('../app/api/test-gmail/route')
const u = (p: string) => new URL(p, 'https://app.askgogo.in')
const anon = await split.GET(new NextRequest(u('/api/splitbill?phone=919999999999&action=balance&group=goa')))
assert.equal(anon.status, 401, 'GET without the secret is refused')
const anonPost = await split.POST(new NextRequest(u('/api/splitbill'), { method: 'POST', body: JSON.stringify({ phone: '919999999999', text: 'Add expense 500 dinner paid by me split with Divya' }) }))
assert.equal(anonPost.status, 401, 'POST without the secret is refused')
const wrong = await split.GET(new NextRequest(u('/api/splitbill?phone=919999999999&secret=nope')))
assert.equal(wrong.status, 401, 'wrong secret refused')
assert.equal(dbCalls, 0, 'nothing read or written for refused calls')
const authed = await split.GET(new NextRequest(u('/api/splitbill?phone=919999999999'), { headers: { authorization: 'Bearer synthetic-internal' } }))
assert.notEqual(authed.status, 401, 'the bot pipeline (Bearer secret) still works')
delete process.env.VERCEL_ENV
const g = await gmail.GET(new NextRequest(u('/api/test-gmail?telegramId=123')))
assert.equal(g.status, 401, 'test-gmail on a preview needs the secret')
// Nutrition cards: signed, owner-bound, expiring links.
const C = await import('../lib/security/card-link')
const card = await import('../app/api/nutrition/daily-card/[telegramId]/route')
const OWNER = '-884501501'
const t = await C.signCardToken('nutrition-daily', OWNER)
assert.ok(t)
assert.ok(await C.verifyCardToken('nutrition-daily', OWNER, t), 'own link verifies')
assert.ok(!(await C.verifyCardToken('nutrition-daily', '-884501502', t)), 'token for another id fails')
assert.ok(!(await C.verifyCardToken('nutrition-weekly', OWNER, t)), 'token for another card kind fails')
assert.ok(!(await C.verifyCardToken('nutrition-daily', OWNER, t, Date.now() + 8 * 864e5)), 'expired token fails')
assert.ok(!(await C.verifyCardToken('nutrition-daily', OWNER, null)), 'no token fails')
dbCalls = 0
const ctx = { params: Promise.resolve({ telegramId: OWNER }) }
assert.equal((await card.GET(new NextRequest(u(`/api/nutrition/daily-card/${OWNER}`)), ctx)).status, 404, 'bare id link refused')
assert.equal(dbCalls, 0, 'no data read for a bare id link')
const other = await C.signCardToken('nutrition-daily', '-111111111')
assert.equal((await card.GET(new NextRequest(u(`/api/nutrition/daily-card/${OWNER}?t=${other}`)), { params: Promise.resolve({ telegramId: OWNER }) })).status, 404, 'someone else\'s token refused')
const pm = (await import('node:fs')).readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
assert.doesNotMatch(pm, /nutrition\/(daily|weekly)-card\/\$\{tid\}`/, 'bot never sends an unsigned card link')
for (const k of ['daily', 'weekly', 'report']) assert.match((await import('node:fs')).readFileSync(new URL(`../app/api/nutrition/${k}-card/[telegramId]/route.ts`, import.meta.url), 'utf8'), /verifyCardToken\('nutrition-/, `${k} card verifies its token`)
// Pitch upload: no hard-coded key; env key required; fixed paths; served deck is sandboxed.
{
  const fs = await import('node:fs')
  for (const f of ['app/api/pitch-assets/upload/route.ts', 'app/pitch-upload/page.tsx']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /AGP-2026-/, `${f} has no hard-coded key`)
  const pitch = await import('../app/api/pitch-assets/upload/route')
  const post = (key: string | null, body: any) => pitch.POST(new NextRequest(u('/api/pitch-assets/upload'), { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-pitch-upload-key': key } : {}) }, body: JSON.stringify(body) }))
  const good = { path: 'askgogo-2026/AskGogo-Pitch-Deck.html', contentType: 'text/html' }
  delete process.env.PITCH_UPLOAD_KEY
  assert.equal((await post('AGP-2026-09-14-d570c78f1b0846c8915fcaa8e74e79c1', good)).status, 403, 'old public key refused; route disabled without env')
  process.env.PITCH_UPLOAD_KEY = 'synthetic-pitch-upload-key-0123456789'
  assert.equal((await post(null, good)).status, 403, 'missing key refused')
  assert.equal((await post('synthetic-pitch-upload-key-012345678X', good)).status, 403, 'wrong key refused')
  assert.equal((await post(process.env.PITCH_UPLOAD_KEY, { path: 'evil/login.html', contentType: 'text/html' })).status, 400, 'arbitrary path refused even with the key')
  assert.equal((await post(process.env.PITCH_UPLOAD_KEY, { path: 'askgogo-2026/AskGogo-Pitch-Deck.html', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).status, 400, 'path/type mismatch refused')
  assert.match(fs.readFileSync('app/pitch/content/route.ts', 'utf8'), /sandbox allow-scripts/, 'served deck has an opaque origin')
  assert.doesNotMatch(fs.readFileSync('app/pitch/content/route.ts', 'utf8'), /allow-same-origin/, 'sandbox never grants same-origin')
}
console.log('splitbill, test-gmail, nutrition cards, pitch upload: no public key or caller-supplied id is authorization')
