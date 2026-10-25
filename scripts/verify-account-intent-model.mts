// Model-read account intent: the rules miss phrasings, so a message that may be an account request
// is read by the model once. These checks use a scripted model; they verify the guard rails, not
// the model's judgement. The result still needs details and an explicit APPROVE before anything runs.
import assert from 'node:assert/strict'
import { mayBeAccountRequest, readAccountRequestWithModel } from '../lib/agent/account-intent-model.ts'

const answer = (obj: unknown) => async () => JSON.stringify(obj)

// Prefilter: account-ish words or a link; never a bare "create".
for (const t of ['get me on manus', 'join huggingface for me', 'Login to https://manus.im/ and set it up', 'sign me up on notion', 'https://manus.im/'])
  assert.ok(mayBeAccountRequest(t), `prefilter passes: ${t}`)
for (const t of ['create a reminder for 6pm', 'what is the weather', ''])
  assert.ok(!mayBeAccountRequest(t), `prefilter skips: ${t}`)

// Phrasings the rules do not know are read by the model.
{
  const r = await readAccountRequestWithModel('pls get me onto manus.im, use goverdhan.md@gmail.com', answer({ intent: 'create_account', service: 'manus.im', url: null, email: 'goverdhan.md@gmail.com', username: null, fullName: null }))
  assert.deepEqual(r, { service: 'manus.im', email: 'goverdhan.md@gmail.com', url: null, username: null, fullName: null })
}
{
  const r = await readAccountRequestWithModel('Login to https://manus.im/ and set one up for me', answer({ intent: 'create_account', service: null, url: 'https://manus.im/', email: null, username: null, fullName: null }))
  assert.equal(r?.service, 'manus.im', 'a link alone gives the service host')
  assert.equal(r?.url, 'https://manus.im/')
}

// Invented values are dropped: only text in the message survives.
{
  const r = await readAccountRequestWithModel('join huggingface for me', answer({ intent: 'create_account', service: 'huggingface', url: 'https://evil.example/join', email: 'someone@else.com', username: 'invented', fullName: 'Made Up' }))
  assert.equal(r?.service, 'huggingface')
  assert.equal(r?.url, null, 'an invented link is dropped')
  assert.equal(r?.email, null, 'an invented email is dropped')
  assert.equal(r?.username, null, 'an invented username is dropped')
  assert.equal(r?.fullName, null)
}
{
  const r = await readAccountRequestWithModel('join for me', answer({ intent: 'create_account', service: 'Netflix', url: null, email: null }))
  assert.equal(r, null, 'a service that is not in the message is never used')
}

// The model saying "other", failing, or returning junk means no account request.
assert.equal(await readAccountRequestWithModel('login to gmail and check my mail', answer({ intent: 'other' })), null)
assert.equal(await readAccountRequestWithModel('join the meeting', async () => { throw new Error('down') }), null)
assert.equal(await readAccountRequestWithModel('join the meeting', async () => 'not json'), null)

// Exclusions apply before the model is asked.
let asked = 0
const counting = async () => { asked++; return JSON.stringify({ intent: 'create_account', service: 'SBI' }) }
assert.equal(await readAccountRequestWithModel('open a savings account in SBI', counting), null)
assert.equal(await readAccountRequestWithModel('how do I sign up on notion?', counting), null)
assert.equal(asked, 0, 'excluded requests never reach the model')

console.log('Account intent model: prefilter, verbatim-value guard, failure and exclusion checks passed (scripted model)')
