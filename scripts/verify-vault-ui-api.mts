import assert from 'node:assert/strict'
import fs from 'node:fs'

const api=fs.readFileSync('app/api/dashboard/vault/route.ts','utf8')
const list=fs.readFileSync('app/dashboard/(app)/you/vault/page.tsx','utf8')
const add=fs.readFileSync('app/dashboard/(app)/you/vault/add/[provider]/page.tsx','utf8')
const form=fs.readFileSync('components/dashboard/vault-credential-form.tsx','utf8')
const store=fs.readFileSync('lib/vault/credential-store.ts','utf8')

assert.match(api,/getSession\(\)/)
assert.match(api,/verifySameOrigin\(request\)/)
assert.match(api,/saveVaultCredential/)
assert.match(api,/removeVaultCredential/)
assert.doesNotMatch(list,/secret_ciphertext|username_ciphertext/)
assert.doesNotMatch(add,/secret_ciphertext|username_ciphertext/)
assert.match(form,/type=\{show\?'text':'password'\}/)
assert.match(form,/Gogo never puts this password into chat, memory, Activity, or model prompts/)
assert.match(store,/usernameHint/)
assert.match(store,/allowedDomains/)
assert.match(store,/vaultDomainAllowed/)
assert.ok(!api.includes("select('username_ciphertext"),'dashboard API must never select ciphertext directly')

console.log('Vault UI/API security contract passed')
