// 8 Nov: AskGogo's own mail and sign-up welcomes are not emails to reply to; a real ask still is.
import assert from 'node:assert/strict'
import { isAutomatedGmailMessage } from '../lib/agent/open-loops'
assert.equal(isAutomatedGmailMessage({ from: 'Gogo from AskGogo <gogo@askgogo.in>', subject: 'Gogo, deadlines are cheaper before they are urgent', snippet: 'Renewals, taxes, payments' }), true)
assert.equal(isAutomatedGmailMessage({ from: 'Cooper Schoenthaler <cooper@cofounder.co>', subject: 'Want some 1:1 help with Cofounder?', snippet: "Hi Goverdhan, Thanks for signing up for Cofounder. I'm Cooper, and I meet with users 1:1" }), true)
assert.equal(isAutomatedGmailMessage({ from: 'Nithin K L <nithin@tipplr.in>', subject: 'API shapes', snippet: 'Can you share the order payload by Monday?' }), false)
assert.equal(isAutomatedGmailMessage({ from: 'Adithya Venugopal <adithya@wework.co.in>', subject: 'Re: E-Invoice', snippet: 'Request you to kindly share an update on the payment' }), false)
console.log('verify-open-loops-self-mail-nov8: 4 passed')

// 9 Nov: loops already created from such mail are picked for dismissal; real ones are not.
import { automatedGmailLoopIds } from '../lib/agent/open-loops'
const ids = automatedGmailLoopIds([
  { id: 1, title: 'Reply to Gogo from AskGogo — Gogo, deadlines are cheaper before they are urgent', summary: 'Renewals, taxes…', evidence_json: { last_message_from: 'Gogo from AskGogo <gogo@askgogo.in>' } },
  { id: 2, title: 'Reply to Cooper Schoenthaler — Want some 1:1 help with Cofounder?', summary: "Hi Goverdhan, Thanks for signing up for Cofounder. I'm Cooper, and I meet with users 1:1", evidence_json: { last_message_from: 'Cooper <cooper@cofounder.co>' } },
  { id: 3, title: 'Reply to IndiaFilings Team — Important: Annual Accounts (Form AOC-4) Filing Deadline', summary: 'Compliance Notice Hi Goverdhan MD', evidence_json: { last_message_from: 'IndiaFilings Team <compliance@indiafilings.com>' } },
  { id: 4, title: 'Reply to Adithya Venugopal — Re: Wework India | E-Invoice', summary: 'Request you to kindly share an update on the payment', evidence_json: { last_message_from: 'Adithya <adithya@wework.co.in>' } },
])
assert.deepEqual(ids, ['1', '2'])
console.log('verify-open-loops-self-mail-nov8: stale-loop selection passed')
