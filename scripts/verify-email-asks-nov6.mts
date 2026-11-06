// 6 Nov live: Gmail was connected, but "emails waiting 3 days for my reply", "subscriptions renewing soon" and
// "free trials I forgot" got "I don't have access to your Gmail"; "Book a dentist for Thursday afternoon" listed
// dentists from all over India. Read-only Gmail answers, and the saved home area for appointments.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const ea = await import('../lib/agent/email-asks')
const { emailBillingAmounts } = await import('../lib/agent/google-workspace-read')

// 1. Reply-wait questions, with the age they ask for.
assert.deepEqual(ea.replyWaitAsk('Which emails have waited more than 3 days for my reply?'), { minAgeDays: 3 })
assert.deepEqual(ea.replyWaitAsk("what emails haven't I replied to"), { minAgeDays: 0 })
assert.deepEqual(ea.replyWaitAsk('any unreplied emails from the last week?'), { minAgeDays: 0 })
assert.deepEqual(ea.replyWaitAsk('emails waiting on my reply for over a week'), { minAgeDays: 7 })
assert.deepEqual(ea.replyWaitAsk('show messages that need my reply'), { minAgeDays: 0 })
for (const t of ['send a reply to Nithin', 'draft a reply to the ONDC email', 'remind me to reply to Rishi tomorrow at 5', 'what is the weather']) assert.equal(ea.replyWaitAsk(t), null, t)
// A 14-day bounded scan cannot verify emails older than the window: preserve intent,
// reject before touching the Gmail provider and do not report "none found".
assert.deepEqual(ea.replyWaitAsk('Which emails have waited over three weeks for my reply?'), { minAgeDays: 21 })
assert.deepEqual(ea.replyWaitAsk('Which emails have waited over two weeks for my reply?'), { minAgeDays: 14 })
assert.deepEqual(ea.replyWaitAsk('Which emails have waited more than 14 days for my reply?'), { minAgeDays: 14 })
let readActor = false
const noGmailActor = new Proxy({}, { get() { readActor = true; throw Error('Gmail actor must not be touched for unsupported age') } })
for (const [ask, age] of [
  ['Which emails have waited over three weeks for my reply?', 21],
  ['Which emails have waited more than 14 days for my reply?', 14],
] as const) {
  const response = await ea.tryEmailAsk(noGmailActor as any, ask)
  assert.equal(response?.handledBy, 'inbox-reply-read')
  assert.match(response?.text || '', /last 14 days/)
  assert.ok(response?.text?.includes(`${age}+ days`), 'requested threshold was not preserved')
  assert.match(response?.text || '', /cannot verify/i)
  assert.match(response?.text || '', /did not read Gmail/i)
  assert.doesNotMatch(response?.text || '', /no likely reply requests|found no/i)
}
assert.equal(readActor, false, 'unsupported window must not call Gmail or inspect credentials')
console.log('✓ requested 14+ day reply age preserved; honest unsupported-window response without Gmail access')
console.log('✓ "waited more than 3 days for my reply" and similar read Gmail; send/draft/remind are not caught')

// 2. Billing questions.
assert.equal(ea.billingAsk('Any subscriptions renewing soon?'), 'renewals')
assert.equal(ea.billingAsk('Any free trials or subscriptions I forgot about?'), 'trials')
assert.equal(ea.billingAsk('Do I have any unpaid invoices or bills due?'), 'bills')
assert.equal(ea.billingAsk('which memberships renew this month'), 'renewals')
for (const t of ['cancel my Netflix subscription', 'remind me to pay the electricity bill on 15th', 'pay my Airtel bill', 'I love my Spotify subscription']) assert.equal(ea.billingAsk(t), null, t)
console.log('✓ renewals, trials and bills questions are recognised; cancel/pay/remind commands are not')

// 3. The answer only states what the email states.
const note = ea.formatBilling('renewals', [
  { subject: 'Your Google One plan renews soon', from: 'Google <payments-noreply@google.com>', evidence: 'Your 2 TB plan renews on 12 Nov 2026 for ₹650.00.' },
  { subject: 'Receipt for your payment', from: '"Vercel Inc." <billing@vercel.com>', evidence: 'Amount paid USD 20.00' },
], emailBillingAmounts, 60)
assert.match(note, /^Subscriptions and renewals in your Gmail · last 60 days\n\n1\. \*Google\* · Your Google One plan renews soon\n   ₹650\.00 · date 12 Nov 2026\n2\. \*Vercel Inc\.\* · Receipt for your payment\n   USD 20\.00\n/)
assert.match(note, /amounts and dates only where the email states them/)
assert.match(ea.formatBilling('trials', [], emailBillingAmounts, 60), /found no free-trial emails\. This is an email check, not your bank statement\./)
console.log('✓ compact list: service, subject, the amount and date the email shows; nothing guessed')

// 4. Wiring: before the brain on both surfaces; the reply-needed reader takes an age.
const dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8'), bridge = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8')
assert.ok(dash.indexOf("lib/agent/email-asks") > 0 && dash.indexOf("lib/agent/email-asks") < dash.indexOf("same-brain"), 'dashboard: before the brain')
assert.match(bridge, /VERCEL_ENV\?await import\('\.\/email-asks'\)\.then\(m=>m\.tryEmailAsk\(actor,params\.text\)/)
const loops = readFileSync('lib/agent/open-loops.ts', 'utf8')
assert.match(loops, /if\(params\.minAgeDays&&!\(Number\(last\.internalDate\)>0&&Date\.now\(\)-Number\(last\.internalDate\)>=params\.minAgeDays\*86_400_000\)\)return \[\]/)
console.log('✓ wired before the brain on dashboard and WhatsApp')

// 5. Appointments use the saved home area when no place is named.
const ar = readFileSync('lib/agent/appointment-research.ts', 'utf8')
assert.match(ar, /if \(!locationRaw\) \{\n    const home = await import\('\.\/places-context'\)\.then\(m => m\.savedPlaces\(String\(params\.actor\.legacyTelegramId\)\)\)/)
console.log('✓ "book a dentist" with no place named searches the saved home area')
console.log('Email asks + dentist area (6 Nov) checks passed')
