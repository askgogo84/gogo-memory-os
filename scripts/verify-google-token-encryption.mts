import assert from 'node:assert/strict'

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
const crypto = await import('../lib/security/google-token-crypto.ts')

const token='1//0g-example-refresh-token'
const encrypted=crypto.encryptGoogleToken(token)
assert.ok(encrypted.startsWith('enc:v1:'))
assert.notEqual(encrypted,token)
assert.equal(crypto.decryptGoogleToken(encrypted),token)
assert.equal(crypto.decryptGoogleToken(token),token,'legacy plaintext stays readable during migration')
assert.equal(crypto.isEncryptedGoogleToken(encrypted),true)
assert.equal(crypto.isEncryptedGoogleToken(token),false)
assert.equal(crypto.hasGoogleTokenEncryptionKey(),true)

const tampered=encrypted.slice(0,-1)+(encrypted.endsWith('A')?'B':'A')
assert.throws(()=>crypto.decryptGoogleToken(tampered))

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=''
assert.equal(crypto.hasGoogleTokenEncryptionKey(),false)
assert.throws(()=>crypto.encryptGoogleToken('new-token'),/google_token_encryption_key_missing/)
assert.equal(crypto.decryptGoogleToken('legacy-plaintext'),'legacy-plaintext')

console.log('google token encryption regression passed')
