import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Allow importing the store (which eagerly constructs the Supabase admin client)
// without real credentials. No network is performed by these assertions.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const { canonicalSiteKey } = await import('../lib/vault/browser-identity-store')

// --- canonical site-key map (collapses www./m./login-path variants) ---
assert.equal(canonicalSiteKey('https://www.amazon.in/ap/signin'), 'amazon.in')
assert.equal(canonicalSiteKey('m.amazon.in'), 'amazon.in')
assert.equal(canonicalSiteKey('amazon.in'), 'amazon.in')
assert.equal(canonicalSiteKey('https://www.flipkart.com/account/login'), 'flipkart.com')
assert.equal(canonicalSiteKey('m.flipkart.com'), 'flipkart.com')
assert.equal(canonicalSiteKey('https://www.swiggy.com/instamart'), 'swiggy.com')
assert.equal(canonicalSiteKey('irctc.co.in'), 'irctc.co.in')
assert.equal(canonicalSiteKey('https://www.irctc.co.in/nget/train-search'), 'irctc.co.in')
assert.equal(canonicalSiteKey('https://www.example.com/x'), 'example.com', 'unknown host → www-stripped host')
assert.equal(canonicalSiteKey('not a url'), '', 'invalid input → empty key')

// --- migration DDL ---
const migration = readFileSync('supabase/migrations/20261006120000_browser_identity_v1.sql', 'utf8')
for (const required of ['vault_browser_identities', 'external_identity_id', 'last_verified_at', 'lease_until', 'lease_owner', 'browserbase', 'steel']) {
  assert.ok(migration.includes(required), required + ' missing from migration')
}
assert.match(migration, /telegram_id\s+text\s+not null/i, 'telegram_id must be text (negative WhatsApp ids)')
assert.match(migration, /unique\s*\(telegram_id,\s*domain,\s*provider\)/i)
assert.match(migration, /enable row level security/i)
assert.doesNotMatch(migration, /cookie_value|cookie_json|cookie_ciphertext|localstorage_value|sessionstorage_value|storage_state|secret_ciphertext|token_ciphertext/i, 'never store a cookie/session-state column')

// --- store shape ---
const store = readFileSync('lib/vault/browser-identity-store.ts', 'utf8')
for (const fn of ['upsertBrowserIdentity', 'getBrowserIdentity', 'markBrowserIdentityStatus', 'deleteBrowserIdentity', 'canonicalSiteKey']) {
  assert.match(store, new RegExp(fn), fn + ' missing from store')
}
assert.match(store, /onConflict:\s*'telegram_id,domain,provider'/)
assert.doesNotMatch(store, /cookie|localStorage|sessionStorage|accessToken|refreshToken/i, 'store must not handle cookies')

console.log('Browser identity store verification passed')
