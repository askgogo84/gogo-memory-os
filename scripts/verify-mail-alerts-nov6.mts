// Important mail, one message at a time (owner-approved mock, 6 Nov). The emails here are the ones Dots flagged in
// the owner's screenshots: failed Browserbase payment, Runway charge to confirm, All Access renewal, HDFC autopay
// failure, a new ₹1,32,482 mandate, a Barclays link expiring, a Google "Instinct was granted access" notice.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const ma = await import('../lib/email/mail-alerts')
const { scoreEmail } = await import('../lib/email/attention')

const at = (iso: string) => ({ internalDate: Date.parse(iso), date: new Date(iso).toUTCString() })
const mail = (id: string, from: string, subject: string, snippet: string, iso: string, extra: any = {}) => ({ id, messageId: id, threadId: 'abc123def456', from, subject, snippet, labelIds: ['INBOX'], ...at(iso), ...extra })
const now = Date.parse('2026-11-06T10:00:00+05:30')
const emails = [
  mail('m1', 'Browserbase Inc <billing@browserbase.com>', '$28.93 payment to Browserbase Inc was unsuccessful again', 'Your payment of $28.93 failed again. Please update your payment method to avoid service interruption.', '2026-11-06T09:00:00+05:30'),
  mail('m2', 'Runway AI, Inc. <no-reply@runwayml.com>', 'Reminder: Confirm your $17.70 payment to Runway AI, Inc.', 'This is the second reminder. Please confirm your $17.70 payment.', '2026-11-06T10:00:00+05:30'),
  mail('m3', 'Shilpita Banerjee <shilpita@allaccess.example>', 'All Access Renewal - what to expect as your membership renews (November 2026)', 'Your All Access membership renews on 20 Nov 2026 for ₹35,841.29.', '2026-11-06T11:30:00+05:30'),
  mail('m4', 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>', 'AutoPay to Kotak Mahindra Prime failed', 'The AutoPay of Rs. 12,450.00 to Kotak Mahindra Prime could not be processed due to insufficient funds. Return charges will be recovered.', '2026-11-06T06:56:00+05:30'),
  mail('m5', 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>', 'New recurring payment mandate registered', 'A new recurring-payment mandate for MongoDB has been registered on your card with a maximum of Rs. 1,32,482.00.', '2026-11-05T13:54:00+05:30'),
  mail('m6', 'Barclays Careers <careers@barclays.com>', 'Verify your account - Director, Principal Engineer - Applied AI', 'Please verify your account using the link below. The link expires on 5 Nov at 11:24 am IST.', '2026-11-04T11:24:00+05:30'),
  mail('m7', 'Google <no-reply@accounts.google.com>', 'Security alert', 'Instinct was granted access to your Google Account goverdhan.md@gmail.com. If you did not grant access, you should check this activity.', '2026-11-06T12:32:00+05:30'),
  mail('m8', 'Nithin K L <nithin@tipplr.in>', 'Updated catalogue sheet?', 'Could you share the updated catalogue sheet before our call today? Need it for the ONDC push.', '2026-11-06T08:30:00+05:30', { isUnread: true }),
  mail('m9', 'Zepto <noreply@zeptonow.com>', 'Flat 40% off on fruits this weekend', 'Limited time offer, unsubscribe', '2026-11-06T09:10:00+05:30', { labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
  mail('m10', 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>', 'Your card was used', 'Rs. 252.00 was debited from your card at Zepto.', '2026-11-06T09:20:00+05:30'),
  mail('m11', 'Amazon.in <order-update@amazon.in>', 'Your order is out for delivery', 'PHILIPS WiZ Neo is out for delivery', '2026-11-06T09:30:00+05:30'),
]
const kinds = Object.fromEntries(emails.map(e => [e.id, ma.alertKindOf(scoreEmail(e as any, { now }))]))
assert.deepEqual(kinds, { m1: 'payment_failed', m2: 'money_leaving', m3: 'money_leaving', m4: 'payment_failed', m5: 'money_leaving', m6: 'deadline', m7: 'security', m8: 'reply_waiting', m9: 'newsletter', m10: null, m11: null })
console.log('✓ each Dots-flagged email gets its kind; a ₹252 debit and an order update are not mail alerts')

// Wording: what the email states, what Gogo cannot tell, nothing invented.
const ctx = { name: 'Goverdhan M D', timezone: 'Asia/Kolkata', now, gmailEmail: 'goverdhan.md@gmail.com',
  today: [{ summary: 'FnB daily syncup <> Tipplr', start: '2026-11-06T11:30:00+05:30', attendees: [{ email: 'nithin@tipplr.in' }] }, { summary: 'Investor call', start: '2026-11-06T15:00:00+05:30' }],
  trips: [{ fromCity: 'Bengaluru', toCity: 'Mumbai', departAt: '2026-11-09T09:55:00+05:30', returnAt: null }] }
const say = (id: string) => ma.composeAlert(kinds[id]!, scoreEmail(emails.find(e => e.id === id) as any, { now }), ctx)
assert.match(say('m1'), /^⚠️ Payment failed\nGoverdhan, Browserbase Inc says a payment of \*\$28\.93\* failed again\. ".*"\. The email says the service may be paused, so update the payment method first\./)
assert.match(say('m4'), /Payment failed\nGoverdhan, HDFC Bank InstaAlerts says a payment of \*₹12,450\.00\* failed for insufficient funds\./)
assert.match(say('m4'), /doesn't say whether it was paid another way, so check before paying again/)
assert.match(say('m2'), /💳 Money leaving\nGoverdhan, Runway AI, Inc\. is asking you to confirm a \*\$17\.70\* payment\./)
assert.match(say('m5'), /reports a new recurring-payment mandate with a \*₹1,32,482\.00\* maximum/)
assert.match(say('m3'), /renews on 20 Nov 2026 for \*₹35,841\.29\*, from Shilpita Banerjee/)
assert.match(say('m6'), /⏳ Deadline\nGoverdhan, Barclays Careers sent "Verify your account - Director, Principal Engineer - Applied AI"\. It expires 5 Nov at 11:24 am\. I can't tell whether you've already done it\./)
assert.match(say('m6'), /You fly to Mumbai on Mon, 9 Nov; best to settle this before then\./, 'trip context on a deadline')
assert.match(say('m7'), /🔐 Security\nGoverdhan, Google says \*Instinct\* was granted access to your account\. If that was you, nothing to do\./)
assert.match(say('m7'), /The email doesn't say what data was shared\./)
assert.match(say('m8'), /✉️ Reply waiting\nGoverdhan, Nithin K L is waiting on you: "Updated catalogue sheet\?"/)
assert.match(say('m8'), /You meet Nithin on the 11:30 am call today, so you could answer there\./, 'calendar context on a reply')
assert.match(say('m8'), /Say "draft a reply" and I'll show it before anything is sent\./)
assert.match(say('m1'), /https:\/\/mail\.google\.com\/mail\/u\/\?authuser=goverdhan\.md%40gmail\.com#all\/abc123def456$/, 'ends with the Gmail link')
for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']) assert.ok(say(id).length < 520, `${id} short enough: ${say(id).length}`)
console.log('✓ one short message each: the email\'s own amount and date, what Gogo cannot tell, trip or calendar context')

// Selection: wanted kinds, once each, quiet hours, daily cap.
const rules = ma.normalizeRules(undefined)
const first = ma.selectAlerts(emails as any, { rules, state: null, ctx })
assert.deepEqual(first.alerts.map(a => a.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], 'six a day, newest-first order kept')
assert.deepEqual(first.deferred, ['m7', 'm8'], 'the rest wait for the next check')
assert.equal(first.state.sentToday, 6)
const again = ma.selectAlerts(emails as any, { rules, state: first.state, ctx })
assert.equal(again.alerts.length, 0, 'cap reached: nothing more today'); assert.deepEqual(again.deferred, ['m7', 'm8'])
const tomorrow = ma.selectAlerts(emails as any, { rules, state: first.state, ctx: { ...ctx, now: now + 86_400_000 } })
assert.deepEqual(tomorrow.alerts.map(a => a.id), ['m7', 'm8'], 'next day: the deferred two, never the six again')
const night = ma.selectAlerts(emails as any, { rules, state: null, ctx: { ...ctx, now: Date.parse('2026-11-06T23:10:00+05:30') } })
assert.equal(night.alerts.length, 0); assert.equal(night.quiet, true); assert.equal(night.deferred.length, 8, 'quiet hours defer everything')
const off = ma.selectAlerts(emails as any, { rules: { ...rules, kinds: { ...rules.kinds, money_leaving: false } }, state: null, ctx })
assert.ok(!off.alerts.some(a => a.kind === 'money_leaving'))
assert.equal(ma.selectAlerts(emails as any, { rules, state: null, ctx, ownEmail: 'billing@browserbase.com' }).alerts.find(a => a.id === 'm1'), undefined, 'own mail is never an alert')
console.log('✓ once each, quiet 10 pm to 8 am, at most 6 a day, kinds can be turned off')

// Rules commands (screen 3).
let r = rules
let c = ma.applyRuleCommand('stop renewals', r)!; assert.equal(c.changed, 'Money leaving: off.'); r = c.rules
c = ma.applyRuleCommand('add newsletters', r)!; assert.equal(c.rules.kinds.newsletter, true); r = c.rules
c = ma.applyRuleCommand("don't alert me about replies", r)!; assert.equal(c.rules.kinds.reply_waiting, false)
c = ma.applyRuleCommand('quiet 11 pm to 7 am', r)!; assert.equal(c.rules.quietStart, 23); assert.equal(c.rules.quietEnd, 7)
c = ma.applyRuleCommand('at most 3 a day', r)!; assert.equal(c.rules.maxPerDay, 3)
assert.equal(ma.applyRuleCommand('stop the car', r), null)
assert.match(ma.formatRules(rules), /^One message per email, only for these\./)
assert.match(ma.formatRules(rules), /• Payments failed or declined · on\n  card declines, failed autopay, unpaid invoices/)
assert.match(ma.formatRules(rules), /• Newsletters and offers · off/)
assert.match(ma.formatRules(rules), /Quiet 10 pm to 8 am, at most 6 a day\. Anything else waits for "any important emails\?"\./)
const cmd = await import('../lib/email/mail-alert-commands')
for (const t of ['what do you alert me about?', 'stop renewals', 'add newsletters', 'quiet 11pm to 7am', 'at most 3 a day']) assert.ok(cmd.isMailAlertCommand(t), t)
for (const t of ['stop the car', 'add milk to my list', 'what do you think about Instinct', 'alert me when the price drops below 5000']) assert.equal(cmd.isMailAlertCommand(t), false, t)
console.log('✓ "what do you alert me about?", "stop renewals", "add newsletters", quiet hours and daily cap')

// Wiring: the watcher sends per-email alerts (digest only on request); commands before the brain on both surfaces.
const w = readFileSync('lib/agent/watchers.ts', 'utf8')
assert.match(w, /\(watcher\.condition_json as any\)\?\.digest!==true&&!condition\.matchTerms\?\.length\)\{\n    return processMailAlerts\(/)
assert.match(w, /const \{alerts,deferred,state,quiet\}=ma\.selectAlerts\(emails,\{rules,attention,state:prior,ctx:\{name:actor\.name,timezone:tz,now:now\.getTime\(\),today,trips,gmailEmail/)
assert.match(w, /deliverWatchAlert\(\{watcherId:String\(watcher\.id\),owner:telegramId,key,due:now\.toISOString\(\),message:a\.message,condition:watcher\.condition_json,topic:a\.topic\}\)/)
assert.match(w, /const waitingIds=new Set\(deferred\)/, 'deferred emails stay fresh for the next check')
for (const p of ['app/api/dashboard/chat/route.ts', 'lib/agent/whatsapp-bridge.ts']) assert.match(readFileSync(p, 'utf8'), /mail-alert-commands'\)\.then\(m=>m\.tryMailAlertCommand\(/, p)
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /never write as if that product were you or did something for the user/)
console.log('✓ wired: per-email alerts in the inbox watch, rule commands on WhatsApp and dashboard, brain never speaks as Dots')
console.log('Mail alerts (6 Nov) checks passed')
