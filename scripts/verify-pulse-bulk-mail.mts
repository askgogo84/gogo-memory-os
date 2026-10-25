import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAutomatedGmailMessage } from '../lib/agent/open-loops'
// 16 Oct live pulse offered three bulk mails as "Reply to …" and printed a demat account number.
const person = { from: 'Asha <asha@acme.in>', subject: 'Can you send the deck by Friday?', snippet: 'Please share the deck', labelIds: ['INBOX', 'CATEGORY_PERSONAL'] }
assert.equal(isAutomatedGmailMessage(person), false, 'a real person asking for something still counts')
assert.equal(isAutomatedGmailMessage({ ...person, from: 'ResellerClub India <care@resellerclub.com>', subject: 'Action Required: .COM Price Revision Effective 1st November 2026', labelIds: ['INBOX', 'CATEGORY_UPDATES'] }), true)
assert.equal(isAutomatedGmailMessage({ ...person, from: 'Madison Delgado <madison@startup.io>', subject: "you're signed up!", snippet: 'make sure you get 50% of your first month with us! Share your use case here to redeem it.' }), true)
assert.equal(isAutomatedGmailMessage({ ...person, from: 'dpservices@info.njindiaonline.com', subject: 'Statement of your NJ India Invest Demat Account 1206420000534238' }), true)
assert.equal(isAutomatedGmailMessage({ ...person, listUnsubscribe: '<mailto:unsub@x.com>' }), true)
assert.equal(isAutomatedGmailMessage({ ...person, labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }), true)
const gm = readFileSync(new URL('../lib/services/google-gmail.ts', import.meta.url), 'utf8')
assert.match(gm, /metadataHeaders=List-Unsubscribe/)
assert.match(gm, /listUnsubscribe:getHeader\(headers,'List-Unsubscribe'\)/)
const pulse = readFileSync(new URL('../lib/agent/autonomy-pulse.ts', import.meta.url), 'utf8')
assert.match(pulse, /\.replace\(\/\\b\\d\{9,20\}\\b\/g,\(digits:string\)=>'••••'\+digits\.slice\(-4\)\)/)
assert.equal('Demat Account 1206420000534238'.replace(/\b\d{9,20}\b/g, (d: string) => '••••' + d.slice(-4)), 'Demat Account ••••4238')
console.log('verify-pulse-bulk-mail: bulk mail is not a reply, long numbers masked')
