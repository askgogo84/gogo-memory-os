import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// Overnight pass over the test checklist (14 Oct). Each case below was found by running the checklist sentences
// through the real routing rules with no classifier available.
// Run: npx tsx scripts/verify-checklist-batch1.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const d: any = await import('../lib/bot/detect-intent')
const watch: any = await import('../lib/agent/watch-command')
const gmail: any = await import('../lib/bot/handlers/gmail-read')
const drive: any = await import('../lib/bot/drive-write-request')
const commodity: any = await import('../lib/bot/commodity-alert')
const ws: any = await import('../lib/agent/google-workspace-read')
const type = (t: string) => d.detectIntent(t).type

// RL-02: reading reminders is never a create claim
for (const t of ['What reminders do I have tomorrow?', 'which reminders are set for friday', 'Do I have any reminders today', 'how many reminders do I have']) {
  assert.equal(type(t), 'edit_reminder', `"${t}" reads reminders`)
}
for (const t of ['Remind me what to buy at 5pm', 'set a reminder for tomorrow', 'remind me at 9 pm to call mom']) {
  assert.equal(type(t), 'set_reminder', `"${t}" still creates`)
}
const feature = readFileSync(new URL('../lib/feature-intents.ts', import.meta.url), 'utf8')
assert.match(feature, /isNaturalReminderRead\(text\) \? 'reminder_edit' : 'reminder_create'/, 'a reminder read is gated as a read, not a create')

// G-07/08/09/12: Gmail reads
for (const t of ['Read my latest password reset email', 'Read my latest newsletter email', 'Read my latest email from Swiggy', 'Check my inbox',
  'What needs my attention in my inbox?', 'show me my unread emails', 'Open my latest email from HDFC Bank', 'Summarise my last email']) {
  assert.equal(type(t), 'read_gmail', `"${t}" reads Gmail`)
}
for (const t of ['Email Rahul saying hi', 'Send an email to my own Gmail saying Gogo test', 'Draft an email to my landlord about the leaking tap', 'Find my resume in Google Drive']) {
  assert.notEqual(type(t), 'read_gmail', `"${t}" is not a Gmail read`)
}
assert.deepEqual(gmail.parseGmailReadFilter('Read my latest email from Swiggy'), { sender: 'Swiggy', topic: null })
assert.deepEqual(gmail.parseGmailReadFilter('Read my latest password reset email'), { sender: null, topic: 'password reset' })
assert.deepEqual(gmail.parseGmailReadFilter('Check my inbox'), { sender: null, topic: null })
const src = readFileSync(new URL('../lib/bot/handlers/gmail-read.ts', import.meta.url), 'utf8')
assert.match(src, /redactEmailAuthSecrets\(String\(row\.subject/, 'subjects are redacted')
assert.match(src, /formatEmailSnippet\(row\.snippet/, 'snippets are redacted')
assert.equal(ws.redactEmailAuthSecrets('Your OTP is 482913'), 'Your OTP is [authentication detail withheld]')
assert.match(ws.redactEmailAuthSecrets('Reset: https://x.com/reset-password?token=abc'), /authentication link withheld/)
assert.match(readFileSync(new URL('../lib/bot/handlers/email-actions.ts', import.meta.url), 'utf8'), /redactEmailAuthSecrets\(/, 'reply drafting never sees raw codes')

// U-21: Drive is read-only; a Drive write is answered honestly and never filed as a list item
for (const t of ["Add a line 'Tested by Gogo' to my Gogo notes doc in Drive", 'Append this to my budget sheet in Google Drive', 'Update my resume doc in Drive']) {
  assert.ok(drive.isDriveWriteRequest(t), `"${t}" is a Drive write`)
  assert.notEqual(type(t), 'list_add', `"${t}" is not a list item`)
}
for (const t of ['Find my resume in Google Drive', 'Summarise my resume from Google Drive', 'add milk to my grocery list', 'Add a reminder to check Google Drive']) {
  assert.ok(!drive.isDriveWriteRequest(t), `"${t}" is not a Drive write`)
}
assert.match(drive.DRIVE_WRITE_REPLY, /can't edit them yet/)
const legacy = readFileSync(new URL('../lib/feature-intents-legacy.ts', import.meta.url), 'utf8')
assert.match(legacy, /!isDriveWriteRequest\(text\)/, 'the legacy list-add rule steps aside for Drive writes')

// T-11: natural price alerts create a watch; non-price levels do not
const price = (t: string) => watch.parsePriceWatchCommand(t)
assert.deepEqual([price('Tell me if Sony WH-1000XM5 drops below ₹25,000 on Amazon')?.product, price('Tell me if Sony WH-1000XM5 drops below ₹25,000 on Amazon')?.threshold], ['Sony WH-1000XM5 on Amazon', '₹25,000'])
assert.equal(price('Alert me when the price of iPhone 16 falls under 60k')?.product, 'iPhone 16')
assert.equal(price('Let me know when Sony WH-1000XM5 is below 25000 rupees')?.threshold, '25000 rupees')
assert.equal(price('Watch Sony WH-1000XM5 and tell me if it drops below ₹25,000')?.product, 'Sony WH-1000XM5')
assert.equal(price('Watch the price of Sony WH-1000XM5 and tell me if it drops below ₹25,000')?.product, 'Sony WH-1000XM5')
for (const t of ['tell me if it drops below 20 degrees tomorrow', 'Tell me if the temperature drops below 20', 'Alert me if gold goes above ₹80,000 per 10g',
  'Let me know when flights to Goa are under ₹5,000', 'Tell me when my balance is below 5000', 'Remind me to pay rent when the price is below 5000']) {
  assert.equal(price(t), null, `"${t}" is not a product price watch`)
}

// U-12: a commodity level alert is answered honestly
assert.ok(commodity.isCommodityAlertRequest('Alert me if gold goes above ₹80,000 per 10g'))
assert.ok(commodity.isCommodityAlertRequest('tell me when petrol crosses 110'.replace('110', '₹110')))
assert.ok(!commodity.isCommodityAlertRequest('gold price today'))
assert.ok(!commodity.isCommodityAlertRequest('Remind me to buy gold on Akshaya Tritiya'))
assert.match(commodity.COMMODITY_ALERT_REPLY, /no alert is set/)

// U-01: "there's news about X" becomes a news watch
for (const [t, q] of [["Alert me when there's news about KLM strikes", 'KLM strikes news'], ['Tell me if there is any news on Tipplr', 'Tipplr news'], ['Send me news updates on humanoid robots', 'humanoid robots news']] as const) {
  assert.equal(watch.parseWebWatchCommand(t)?.query, q, t)
}
for (const t of ['Alert me when there is a sale on iPhones', 'Tell me if there is a doctor nearby']) assert.equal(watch.parseWebWatchCommand(t), null, t)

console.log('checklist batch 1: reminder reads, Gmail reads + redaction, Drive writes, price/news/commodity alerts')
