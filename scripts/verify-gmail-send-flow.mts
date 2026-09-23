import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isGmailReplyCommand, parseGmailReplyCommand } from '../lib/agent/gmail-send'

assert.equal(isGmailReplyCommand('Draft a reply to the latest email from Ravi saying Thanks, I will review it.'),true)
assert.equal(isGmailReplyCommand('Reply to email from ravi@example.com saying Looks good to me.'),true)
assert.equal(isGmailReplyCommand('send it'),true)
assert.equal(isGmailReplyCommand('send'),false,'bare send must not steal unrelated message sends')

assert.deepEqual(
  parseGmailReplyCommand('Draft a reply to the latest email from Ravi saying Thanks, I will review it.'),
  {target:'Ravi',body:'Thanks, I will review it.',draftOnly:true},
)
assert.deepEqual(
  parseGmailReplyCommand('Reply to email from ravi@example.com saying Looks good to me.'),
  {target:'ravi@example.com',body:'Looks good to me.',draftOnly:false},
)

const gmail=readFileSync(new URL('../lib/agent/gmail-send.ts',import.meta.url),'utf8')
const oauth=readFileSync(new URL('../lib/services/google-gmail.ts',import.meta.url),'utf8')
const callback=readFileSync(new URL('../app/api/gmail/callback/route.ts',import.meta.url),'utf8')
const bridge=readFileSync(new URL('../lib/agent/whatsapp-bridge.ts',import.meta.url),'utf8')
const feature=readFileSync(new URL('../lib/feature-intents.ts',import.meta.url),'utf8')

assert.match(oauth,/GOOGLE_GMAIL_SEND_SCOPE/)
assert.match(oauth,/gmail\.send/)
assert.match(oauth,/purpose:'send_oauth'/)
assert.match(callback,/gmail_send_connected=true/)
assert.match(callback,/sendUpgrade&&!tokens\.refresh_token/)
assert.match(gmail,/action_type:'send_email'/)
assert.match(gmail,/risk_level:'high'/)
assert.match(gmail,/Nothing has been sent yet/)
assert.match(gmail,/verifyGmailSentMessage/)
assert.match(gmail,/gmail_send_verified/)
assert.match(gmail,/I will not retry automatically because that could duplicate the email/)
assert.match(bridge,/planType === 'gmail_send'/)
assert.match(feature,/isGmailReplyCommand\(text\)/)

const approvalPos=gmail.indexOf('stageApproval')
const sendPos=gmail.indexOf('sendGmailReply',approvalPos)
assert.ok(approvalPos>=0&&sendPos>approvalPos,'provider send must live behind staged approval flow')

console.log('Gmail Send OAuth, draft, approval and provider-verification flow passed')
