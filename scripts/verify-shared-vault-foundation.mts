import assert from 'node:assert/strict'

process.env.VAULT_MASTER_KEY_V1=Buffer.alloc(32,9).toString('base64')

const crypto=await import('../lib/security/vault-crypto')
const domain=await import('../lib/vault/domain-policy')

const secret='correct horse battery staple'
const encrypted=crypto.encryptVaultValue(secret)
assert.ok(encrypted.startsWith('vault:v1:'))
assert.notEqual(encrypted,secret)
assert.equal(crypto.decryptVaultValue(encrypted),secret)
assert.throws(()=>crypto.decryptVaultValue(encrypted.slice(0,-1)+'x'))
assert.equal(crypto.vaultHint('person@example.com'),'pe***@example.com')

assert.equal(domain.normalizeVaultDomain('https://www.instagram.com/accounts/login/'),'instagram.com')
assert.equal(domain.vaultDomainAllowed('instagram.com',['instagram.com']),true)
assert.equal(domain.vaultDomainAllowed('www.instagram.com',['instagram.com']),true)
assert.equal(domain.vaultDomainAllowed('evil-instagram.com',['instagram.com']),false)
assert.equal(domain.vaultDomainAllowed('instagram.com.evil.example',['instagram.com']),false)

console.log('shared vault foundation regression passed')
