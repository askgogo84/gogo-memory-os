import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/20260921171000_session_vault_v1.sql','utf8')
for(const required of ['vault_sessions','sandbox_name','profile_generation','human_challenge','vault_credential']) {
  assert.ok(migration.includes(required),required+' missing')
}
assert.doesNotMatch(migration,/cookie_value|cookie_json|localstorage_value|sessionstorage_value|secret_ciphertext|token_ciphertext/i)

const store=readFileSync('lib/vault/session-store.ts','utf8')
assert.match(store,/VaultSessionMetadata/)
assert.match(store,/sandboxName/)
assert.match(store,/profileGeneration/)
assert.doesNotMatch(store,/cookie|localStorage|sessionStorage|refreshToken|accessToken/i)

const browser=readFileSync('lib/agent/secure-computer.ts','utf8')
assert.match(browser,/upsertVaultSession/)
assert.match(browser,/SANDBOX_GENERATION/)
assert.match(browser,/status:'active'/)
assert.match(browser,/status:'human_challenge'/)

console.log('Session Vault verification passed')
