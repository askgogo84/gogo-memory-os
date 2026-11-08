// 8 Nov: AskGogo's own mail and sign-up welcomes are not emails to reply to; a real ask still is.
import assert from 'node:assert/strict'
import { isAutomatedGmailMessage } from '../lib/agent/open-loops'
assert.equal(isAutomatedGmailMessage({ from: 'Gogo from AskGogo <gogo@askgogo.in>', subject: 'Gogo, deadlines are cheaper before they are urgent', snippet: 'Renewals, taxes, payments' }), true)
assert.equal(isAutomatedGmailMessage({ from: 'Cooper Schoenthaler <cooper@cofounder.co>', subject: 'Want some 1:1 help with Cofounder?', snippet: "Hi Goverdhan, Thanks for signing up for Cofounder. I'm Cooper, and I meet with users 1:1" }), true)
assert.equal(isAutomatedGmailMessage({ from: 'Nithin K L <nithin@tipplr.in>', subject: 'API shapes', snippet: 'Can you share the order payload by Monday?' }), false)
assert.equal(isAutomatedGmailMessage({ from: 'Adithya Venugopal <adithya@wework.co.in>', subject: 'Re: E-Invoice', snippet: 'Request you to kindly share an update on the payment' }), false)
console.log('verify-open-loops-self-mail-nov8: 4 passed')
