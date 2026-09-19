import assert from 'node:assert/strict'
import { redactEmailAuthSecrets, formatEmailSnippet } from '../lib/agent/google-workspace-read'

const cases:[string,string][]=[
  ['Your OTP is 123456. Do not share it.','Your OTP is [authentication detail withheld]. Do not share it.'],
  ['Verification code: AB12CD','Verification code: [authentication detail withheld]'],
  ['Use code 778899 to sign in','Use code [authentication detail withheld] to sign in'],
  ['Reset here https://example.com/reset-password?token=abc123','Reset here [authentication link withheld]'],
  ['Magic login: https://example.com/magic-link/abc?x=1','Magic login: [authentication link withheld]'],
  ['Normal article https://example.com/news/story','Normal article https://example.com/news/story'],
]
for(const [input,want] of cases) assert.equal(redactEmailAuthSecrets(input),want,input)
assert.equal(redactEmailAuthSecrets('Sign in https://example.com/login?token=secret123'),'Sign in [authentication link withheld]')
const snippet=formatEmailSnippet('Your security code = 445566. Keep it private.')
assert.ok(snippet.includes('[authentication detail withheld]'))
assert.ok(!snippet.includes('445566'))
console.log('gmail authentication-secret filter regression passed')
