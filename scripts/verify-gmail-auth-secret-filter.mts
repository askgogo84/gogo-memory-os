import assert from 'node:assert/strict'
import { redactEmailAuthSecrets } from '../lib/agent/google-workspace-read'

const cases:[string,string][]=[
  ['Your OTP is 123456. Do not share it.','Your OTP is [authentication detail withheld]. Do not share it.'],
  ['Verification code: AB12CD','Verification code: [authentication detail withheld]'],
  ['Use code 778899 to sign in','Use code [authentication detail withheld] to sign in'],
  ['Reset here https://example.com/reset-password?token=abc123','Reset here [authentication link withheld]'],
  ['Magic login: https://example.com/magic-link/abc?x=1','Magic login: [authentication link withheld]'],
  ['Normal article https://example.com/news/story','Normal article https://example.com/news/story'],
]
for(const [input,want] of cases) assert.equal(redactEmailAuthSecrets(input),want,input)
const output=redactEmailAuthSecrets('Sign in https://example.com/login?token=secret123')
assert.equal(output,'Sign in [authentication link withheld]')
assert.ok(!/123456|AB12CD|abc123|secret123/.test(cases.map(([x])=>redactEmailAuthSecrets(x)).join(' ')+' '+output))
console.log('gmail authentication-secret filter regression passed')
