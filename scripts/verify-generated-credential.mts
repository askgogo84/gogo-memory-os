// Generated sign-up passwords: length, class coverage, no ambiguous characters, uniqueness.
import assert from 'node:assert/strict'
import { generateCredentialSecret } from '../lib/vault/generated-credential.ts'

for (let i = 0; i < 200; i++) {
  const s = generateCredentialSecret(24)
  assert.equal(s.length, 24)
  assert.match(s, /[a-z]/)
  assert.match(s, /[A-Z]/)
  assert.match(s, /[2-9]/)
  assert.match(s, /[!@#$%^&*\-_=+]/)
  assert.doesNotMatch(s, /[0OoIl1]/, 'ambiguous characters are excluded')
}
assert.equal(generateCredentialSecret(4).length, 16, 'short requests are raised to the minimum')
assert.equal(generateCredentialSecret(500).length, 64, 'long requests are capped')
assert.notEqual(generateCredentialSecret(), generateCredentialSecret(), 'secrets differ')

console.log('Generated sign-up passwords: length, class coverage, ambiguity and uniqueness checks passed')
