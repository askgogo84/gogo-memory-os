import assert from 'node:assert/strict'
import fs from 'node:fs'

const browser=fs.readFileSync('lib/agent/secure-computer.ts','utf8')
const store=fs.readFileSync('lib/vault/credential-store.ts','utf8')

assert.match(browser,/resolveVaultCredentialForBrowser/)
assert.match(browser,/GOGO_VAULT_USERNAME/)
assert.match(browser,/GOGO_VAULT_SECRET/)
assert.match(browser,/env:\s*\{[\s\S]*GOGO_LOGIN_URL:[\s\S]*GOGO_VAULT_USERNAME:[\s\S]*GOGO_VAULT_SECRET:/)
assert.doesNotMatch(browser,/args:\[[^\]]*GOGO_VAULT_SECRET/s,'vault secret must never be passed in process arguments')
assert.doesNotMatch(browser,/objective:[^\n]*credential\.secret/,'vault secret must never enter an LLM/browser objective')
assert.match(browser,/pageLooksLikeLogin/)
assert.match(browser,/authGate\.reason==='password'/)
assert.match(browser,/recordVaultBrowserOutcome/)
assert.match(browser,/canonicalBrowserOwnerId/)
assert.match(browser,/telegram_id/)
assert.match(store,/vaultDomainAllowed/)
assert.match(store,/credential_domain_denied/)
assert.match(store,/status:'needs_reauth'/)
assert.match(store,/vault_credential_ambiguous/)
assert.match(store,/\.delete\(\)/)

console.log('Vault secure-browser broker contract passed')

assert.doesNotMatch(browser,/explicitFailure=\/[^\n]*try\\s\+again/,'generic retry copy must not invalidate a saved credential')
assert.match(browser,/credentials\?\\s\+\(\?:do\\s\+not\\s\+match\|not\\s\+recognized\)/)
