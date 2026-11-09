// Inert original-router regression: an owner-initiated secondary Gmail revocation
// must never become a generic OAuth connection link. No network or real account changes.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64')
process.env.OPENAI_API_KEY ||= 'ci-placeholder'
process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder'

const { supabaseAdmin } = await import('../lib/supabase-admin')
const { routeFeatureIntent } = await import('../lib/feature-intents')
const ownerA = -4500000001, ownerB = -4500000002
const rows: any[] = [
  { id: 'a', telegram_id: String(ownerA), email: 'work@example.com', disconnected_at: null, access_token: 'sealed-a', refresh_token: 'sealed-a' },
  { id: 'b', telegram_id: String(ownerB), email: 'work@example.com', disconnected_at: null, access_token: 'sealed-b', refresh_token: 'sealed-b' },
  { id: 'c', telegram_id: String(ownerA), email: 'other@example.com', disconnected_at: null, access_token: 'sealed-c', refresh_token: 'sealed-c' },
]
const tables: string[] = []
let dbError = false
;(supabaseAdmin as any).from = (name: string) => {
  tables.push(name)
  assert.equal(name, 'gmail_accounts', 'disconnect must not first read primary Gmail or unrelated owner state')
  const filters: Array<(r: any) => boolean> = []
  let updated: any = null
  const q: any = {
    update(values: any) { updated = values; return q },
    eq(field: string, value: any) { filters.push(r => String(r[field]) === String(value)); return q },
    is(field: string, value: any) { filters.push(r => r[field] === value); return q },
    select() { return q },
    then(resolve: any, reject: any) {
      if (dbError) return Promise.resolve({ data: null, error: { message: 'synthetic database unavailable' } }).then(resolve, reject)
      assert.ok(updated && Object.hasOwn(updated, 'disconnected_at'), 'only a deliberate account revocation is allowed')
      assert.equal(updated.access_token, null)
      assert.equal(updated.refresh_token, null)
      const matched = rows.filter(r => filters.every(f => f(r)))
      for (const r of matched) Object.assign(r, updated)
      return Promise.resolve({ data: matched.map(r => ({ id: r.id })), error: null }).then(resolve, reject)
    },
  }
  return q
}
const route = (owner: number, command: string) => routeFeatureIntent('whatsapp:+919000000000', command, { telegramId: owner, surface: 'whatsapp' })

// Before this fix the actual WhatsApp feature router returned "Connect Google Workspace here"
// and the secondary account stayed readable. Exercise the ORIGINAL router, not a copy of a regex.
const removed = await route(ownerA, 'disconnect work@example.com')
assert.match(String(removed), /no longer read work@example\.com/i)
assert.doesNotMatch(String(removed), /Connect Google Workspace|accounts\.google\.com/i)
assert.ok(rows[0].disconnected_at, 'named owner A work account revoked')
assert.equal(rows[0].access_token, null)
assert.equal(rows[0].refresh_token, null)
assert.equal(rows[1].disconnected_at, null, 'same address for owner B must be untouched')
assert.equal(rows[1].access_token, 'sealed-b')
assert.equal(rows[2].disconnected_at, null, 'other account belonging to A must be untouched')
console.log('✓ WhatsApp owner A disconnects exactly their own named secondary mailbox')

// Revocation is idempotent and never claims another owner was disconnected.
const repeat = await route(ownerA, 'remove work@example.com')
assert.match(String(repeat), /isn't one of the extra accounts/i)
assert.equal(rows[1].access_token, 'sealed-b')

const stop = await route(ownerB, 'stop reading work@example.com')
assert.match(String(stop), /no longer read work@example\.com/i)
assert.ok(rows[1].disconnected_at)
const other = await route(ownerA, 'unlink other@example.com')
assert.match(String(other), /no longer read other@example\.com/i)
assert.ok(rows[2].disconnected_at)
console.log('✓ remove/unlink/stop-reading variants dispatch to owner-scoped revocation')

// A primary or nonexistent address must not be claimed as an extra account.
const unknown = await route(ownerA, 'disconnect primary@example.com')
assert.match(String(unknown), /isn't one of the extra accounts/i)
assert.doesNotMatch(String(unknown), /no longer read primary@example\.com/i)

// If persistence fails, never claim the account is disconnected or retry automatically.
dbError = true
await assert.rejects(() => route(ownerA, 'disconnect unknown@example.com'), /gmail_account_disconnect_failed:synthetic database unavailable/)
assert.ok(tables.length >= 6)
console.log('✓ missing address and DB failure fail closed; primary consent/read access not required')
console.log('Secondary Gmail disconnect routing original-module regression passed')
