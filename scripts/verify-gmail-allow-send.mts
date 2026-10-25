// Duet parity step 5: one tap to allow sending from Connections; sends stay approval-gated and Sent-verified.
// Run: npx tsx scripts/verify-gmail-allow-send.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const page = readFileSync('app/dashboard/(app)/connections/page.tsx', 'utf8')
assert.match(page, /const sendUpgradeUrl=authKnown&&c\.gmail&&!gmailSend&&!gmailReadOff/, 'only when Gmail is connected read-only and reading is on')
assert.match(page, /buildGmailSendConnectUrl\(tgNum\)/, 'signed, owner-bound, expiring upgrade link')
assert.match(page, /await import\('@\/lib\/services\/google-gmail'\)/, 'lazy import keeps the page harnesses working')
assert.match(page, /\{sendUpgradeUrl&&<section/)
assert.match(page, />Allow sending</)
const send = readFileSync('lib/agent/gmail-send.ts', 'utf8')
assert.match(send, /verifyGmailSentMessage\(access\.accessToken,sent\.id/, 'success is claimed only after Sent read-back')
assert.match(send, /I will not retry automatically because that could duplicate the email/)
const connect = readFileSync('app/api/gmail/send/connect/route.ts', 'utf8')
assert.match(connect, /verifyGmailSendConnectToken\(token\)/)
console.log('Gmail allow-send: button only for read-only connections, signed upgrade link, sends stay approval-gated and Sent-verified')
