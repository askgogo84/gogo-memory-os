// Email attention (23 Oct, approved mock): only mail that needs the person, why it was picked, learning from taps,
// forwarded-mail parsing and the Gmail forwarding confirmation code.
import assert from 'node:assert/strict'
import * as A from '../lib/email/attention.ts'
import * as C from '../lib/email/attention-commands.ts'
import * as M from '../lib/email/mime.ts'

const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`) } }

const now = Date.parse('2026-10-23T10:00:00+05:30')
const H = 3600e3
const nithin = { id: '1', threadId: 't1', from: 'Nithin Rao <nithin@tipplr.in>', subject: 'Q4 vendor contract', snippet: 'Hi Divya, can you sign off on the Q4 vendor contract before Friday? Legal needs it.', internalDate: now - H, isUnread: true }
const hdfc = { id: '2', threadId: 't2', from: 'HDFC Bank <alerts@hdfcbank.net>', subject: 'Your credit card statement', snippet: 'Total amount due Rs. 18,420. Payment due date tomorrow.', internalDate: now - 20 * H }
const swiggy = { id: '3', threadId: 't3', from: 'Swiggy <noreply@swiggy.in>', subject: 'Your order is out for delivery', snippet: 'Your order from Truffles is on the way', internalDate: now - 2 * H }
const digest = { id: '4', threadId: 't4', from: 'Medium Daily Digest <noreply@medium.com>', subject: 'Top stories for you', snippet: 'Read more', internalDate: now, listUnsubscribe: '<mailto:x>' }
const promo = { id: '5', threadId: 't5', from: 'Amazon <store-news@amazon.in>', subject: '50% off sale ends tonight', snippet: 'Limited time deal', labelIds: ['CATEGORY_PROMOTIONS'], internalDate: now }
const otp = { id: '6', threadId: 't6', from: 'HDFC <alerts@hdfcbank.net>', subject: 'OTP for transaction', snippet: 'Your OTP is 123456. Do not share it.', internalDate: now }
const refund = { id: '7', threadId: 't7', from: 'Swiggy <noreply@swiggy.in>', subject: 'Refund failed for your order', snippet: 'We could not process your refund', internalDate: now }
const debit = { id: '8', threadId: 't8', from: 'HDFC <alerts@hdfcbank.net>', subject: 'Alert', snippet: 'Rs.2249.38 debited from a/c XX1234 via UPI', internalDate: now }
const fyi = { id: '9', threadId: 't9', from: 'Divya <divya@example.com>', subject: 'Photos from Saturday', snippet: 'Here are the photos from the trip, enjoy.', internalDate: now }
const all = [nithin, hdfc, swiggy, digest, promo, otp, refund, debit, fyi] as A.AttentionEmail[]

await check('picks only mail that needs the person (ask with deadline, bill due, problem) and skips the rest', () => {
  const p = A.pickAttention(all, { now })
  const picked = p.picked.map(s => s.email.id).sort()
  assert.deepEqual(picked, ['1', '2', '7'])
  for (const id of ['3', '4', '5', '6', '8', '9']) assert.ok(p.skipped.some(s => s.email.id === id), `skipped ${id}`)
})

await check('each pick says why in a few words', () => {
  const p = A.pickAttention(all, { now })
  const by = Object.fromEntries(p.picked.map(s => [s.email.id, s]))
  assert.equal(by['1'].why, 'Asks you to decide · due Fri')
  assert.equal(by['2'].why, 'Payment due tomorrow')
  assert.match(by['2'].ask, /₹18,420/)
  assert.equal(by['7'].why, 'Something went wrong')
  assert.match(by['1'].ask, /^Can you sign off on the Q4 vendor contract before Friday\?$/)
})

await check('card text is clean (no Gmail URLs, no italics) and the dashboard can parse it back', () => {
  const card = A.formatAttentionCard(A.pickAttention(all, { now }), { now })
  assert.match(card, /^📬 3 emails need you\nSkipped 6: /)
  assert.doesNotMatch(card, /https?:\/\/|_[A-Za-z]/)
  const parsed = A.parseAttentionCard(card)!
  assert.equal(parsed.count, 3)
  assert.equal(parsed.items.length, 3)
  assert.deepEqual(parsed.items.map(i => i.index), [1, 2, 3])
  assert.ok(parsed.items.every(i => i.sender && i.ask && i.why))
  assert.match(parsed.skipped, /^Skipped 6:/)
})

await check('nothing urgent gives a calm one-liner with what was skipped', () => {
  const card = A.formatAttentionCard(A.pickAttention([swiggy, digest, promo] as any, { now }), { now })
  assert.match(card, /^📬 Nothing in your email needs you right now\.\nSkipped 3:/)
  assert.equal(A.parseAttentionCard(card)!.items.length, 0)
})

await check('"not important" on routine updates silences them, but a problem from the same sender still comes through', () => {
  const rule = A.ruleFromFeedback(A.scoreEmail(swiggy as any, { now }), 'never')
  assert.equal(rule.matchType, 'sender_category'); assert.equal(rule.matchValue, 'swiggy.in'); assert.equal(rule.label, 'Swiggy order updates')
  assert.equal(A.scoreEmail(swiggy as any, { now, rules: [rule] }).ruleApplied?.kind, 'never')
  assert.equal(A.scoreEmail(refund as any, { now, rules: [rule] }).picked, true)
})

await check('"not important" on a person silences that person; "important" always flags them', () => {
  const never = A.ruleFromFeedback(A.scoreEmail(nithin as any, { now }), 'never')
  assert.equal(never.matchType, 'sender'); assert.equal(never.matchValue, 'nithin@tipplr.in')
  assert.equal(A.scoreEmail(nithin as any, { now, rules: [never] }).picked, false)
  const always = A.ruleFromFeedback(A.scoreEmail(fyi as any, { now }), 'always')
  const s = A.scoreEmail(fyi as any, { now, rules: [always] })
  assert.equal(s.picked, true); assert.match(s.why, /You flagged mail from Divya/)
})

await check('people the person writes to rank higher; own mail and week-old mail fade', () => {
  const ask = { id: 'a', from: 'Sam <sam@acme.in>', subject: 'Deck', snippet: 'Could you share the deck?', internalDate: now }
  const base = A.scoreEmail(ask as any, { now }).score
  const boosted = A.scoreEmail(ask as any, { now, repliedSenders: new Set(['sam@acme.in']) })
  assert.ok(boosted.score > base); assert.match(boosted.why, /You often reply to Sam/)
  assert.equal(A.scoreEmail({ ...ask, from: 'Me <me@acme.in>' } as any, { now, ownEmail: 'me@acme.in' }).score, 0)
  assert.equal(A.scoreEmail({ ...nithin, internalDate: now - 12 * 86400e3 } as any, { now }).picked, false)
})

await check('one item per thread: a long back-and-forth is one email', () => {
  const p = A.pickAttention([{ ...nithin, id: 'old', internalDate: now - 5 * H }, nithin] as any, { now })
  assert.equal(p.checked, 1); assert.equal(p.picked[0].email.id, '1')
})

await check('chat commands parse; numbers bind only to the card', () => {
  assert.deepEqual(C.parseAttentionCommand('Not important 2'), { type: 'not_important', index: 2 })
  assert.deepEqual(C.parseAttentionCommand('draft 1'), { type: 'draft', index: 1 })
  assert.deepEqual(C.parseAttentionCommand('remind 1 at 6pm'), { type: 'remind', index: 1, when: 'at 6pm' })
  assert.deepEqual(C.parseAttentionCommand('why 3?'), { type: 'why', index: 3 })
  assert.deepEqual(C.parseAttentionCommand('important 1'), { type: 'important', index: 1 })
  assert.deepEqual(C.parseAttentionCommand('What emails need my attention?'), { type: 'show' })
  assert.deepEqual(C.parseAttentionCommand('check my email'), { type: 'show' })
  assert.deepEqual(C.parseAttentionCommand('any important emails today?'), { type: 'show' })
  assert.deepEqual(C.parseAttentionCommand('always flag mail from my CA'), { type: 'rule_text', kind: 'always', target: 'my ca' })
  assert.deepEqual(C.parseAttentionCommand('stop flagging emails from LinkedIn'), { type: 'rule_text', kind: 'never', target: 'linkedin' })
  assert.deepEqual(C.parseAttentionCommand('what do you flag'), { type: 'rules' })
  assert.equal(C.parseAttentionCommand('what needs my attention'), null) // open loops keep this
  assert.equal(C.parseAttentionCommand('remind me to call Nithin at 5pm'), null)
  assert.equal(C.parseAttentionCommand('draft a reply to Nithin saying ok'), null)
  assert.ok(C.isUndo('undo'))
})

await check('one conversation from two sources (Gmail + forwarded) and its replies shows once', () => {
  const g = { ...nithin, id: 'g1', threadId: '19abcdef01', source: 'gmail', subject: 'Re: Q4 vendor contract', internalDate: now - 10 * 60e3 }
  const f1 = { ...nithin, id: 'f1', threadId: 'hashroot', source: 'forwarded', internalDate: now - 30 * 60e3 }
  const f2 = { ...nithin, id: 'f2', threadId: 'hashroot2', source: 'forwarded', subject: 'RE: Q4 vendor contract', internalDate: now - 10 * 60e3 }
  const p = A.pickAttention([g, f1, f2] as any, { now })
  assert.equal(p.picked.length, 1); assert.equal(p.checked, 1)
})

const forwardedRaw = [
  'Received: by mx', 'From: =?UTF-8?B?Tml0aGluIFJhbw==?= <nithin@tipplr.in>', 'To: divya@gmail.com', 'Subject: =?UTF-8?Q?Q4_vendor_contract_=E2=80=93_sign-off?=',
  'Message-ID: <abc123@mail.tipplr.in>', 'In-Reply-To: <root1@mail.tipplr.in>', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"', '',
  '--b1', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '',
  'Hi Divya,=0ACan you sign off on the contract before Friday? It=E2=80=99s =', 'urgent.', '', 'On Thu, Nithin wrote:', '> old text',
  '--b1', 'Content-Type: text/html; charset=UTF-8', '', '<p>Hi Divya</p>', '--b1--', '',
].join('\r\n')

await check('forwarded mail parses: encoded headers, quoted-printable body, quoted reply trimmed', () => {
  const mail = M.parseMail(forwardedRaw)
  assert.equal(mail.from, 'Nithin Rao <nithin@tipplr.in>')
  assert.equal(mail.subject, 'Q4 vendor contract – sign-off')
  assert.equal(mail.messageId, '<abc123@mail.tipplr.in>')
  assert.match(mail.text, /It’s urgent\./)
  const preview = M.previewText(mail.text)
  assert.match(preview, /Can you sign off/); assert.doesNotMatch(preview, /old text/)
})

await check('raw UTF-8 bytes (as the route passes them) decode correctly', () => {
  const raw = Buffer.from('From: A <a@x.com>\r\nSubject: Café ₹500\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPay ₹500 by tomorrow', 'utf8').toString('latin1')
  const mail = M.parseMail(raw)
  assert.equal(mail.subject, 'Café ₹500'); assert.equal(mail.text, 'Pay ₹500 by tomorrow')
})

await check('base64 html-only mail becomes readable text', () => {
  const html = Buffer.from('<html><body><p>Your bill of &#8377;1,200 is due on 25 Oct.</p><style>.x{}</style></body></html>').toString('base64')
  const mail = M.parseMail(`From: Airtel <noreply@airtel.in>\r\nSubject: Bill\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${html}`)
  assert.equal(mail.text, 'Your bill of ₹1,200 is due on 25 Oct.')
})

await check('Gmail forwarding confirmation code is found', () => {
  const c = M.gmailForwardingConfirmation({ from: 'Gmail Team <forwarding-noreply@google.com>', subject: '(#482917365) Gmail Forwarding Confirmation - Receive Mail from divya.k@gmail.com', text: 'divya.k@gmail.com has requested to automatically forward mail.\nConfirmation code: 482917365\nhttps://mail-settings.google.com/mail/vf-abc' })
  assert.deepEqual(c, { code: '482917365', forwarder: 'divya.k@gmail.com', link: 'https://mail-settings.google.com/mail/vf-abc' })
  assert.equal(M.gmailForwardingConfirmation({ from: 'evil <forwarding-noreply@g00gle.com>', subject: '(#1234567) Gmail Forwarding Confirmation', text: '' }), null)
})

await check('Gmail link-only forwarding confirmation (23 Oct live format) is recognised', () => {
  const c = M.gmailForwardingConfirmation({ from: 'forwarding-noreply@google.com', subject: '(Gmail Forwarding confirmation – Receive mail from goverdhan.md@gmail.com', text: 'goverdhan.md@gmail.com has requested to automatically forward mail to your email\naddress gogo-y4qtch@in.askgogo.in.\n\nhttps://mail-settings.google.com/mail/vf-%5BABC%5D-xyz\n\nThanks' })
  assert.deepEqual(c, { code: null, forwarder: 'goverdhan.md@gmail.com', link: 'https://mail-settings.google.com/mail/vf-%5BABC%5D-xyz' })
})

const aliases = await import('../lib/email/aliases.ts').catch(() => null)
await check('aliases: unguessable, only our domain', () => {
  if (!aliases) throw new Error('aliases module failed to load')
  const a = aliases.makeAlias('Divya K')
  assert.match(a, /^divyak-[a-z2-9]{6}$/)
  assert.equal(aliases.aliasFromAddress('Divya <divyak-k7q2mx@in.askgogo.in>'), 'divyak-k7q2mx')
  assert.equal(aliases.aliasFromAddress('divyak-k7q2mx+gmail@in.askgogo.in'), 'divyak-k7q2mx')
  assert.equal(aliases.aliasFromAddress('divyak-k7q2mx@evil.in'), null)
})

const RI = await import('../lib/email/resend-inbound.ts').catch(() => null)
await check('Resend webhook signatures verify; tampered, stale or unsigned ones are refused', async () => {
  if (!RI) throw new Error('resend-inbound failed to load')
  const { createHmac } = await import('node:crypto')
  const secret = 'whsec_' + Buffer.from('fixture-signing-key-0123456789').toString('base64')
  const id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000)), body = '{"type":"email.received"}'
  const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')
  assert.equal(RI.verifyResendWebhook({ secret, id, timestamp, body, signature: `v1,${sig}` }), true)
  assert.equal(RI.verifyResendWebhook({ secret, id, timestamp, body: body + ' ', signature: `v1,${sig}` }), false)
  assert.equal(RI.verifyResendWebhook({ secret, id, timestamp: String(Number(timestamp) - 900), body, signature: `v1,${sig}` }), false)
  assert.equal(RI.verifyResendWebhook({ secret: '', id, timestamp, body, signature: `v1,${sig}` }), false)
})

await check('Resend parsed email rebuilds into a message the inbound pipeline reads', () => {
  if (!RI) throw new Error('resend-inbound failed to load')
  const raw = RI.rawFromParsed({ id: 'e1', to: ['divyak-k7q2mx@in.askgogo.in'], from: 'Nithin Rao <nithin@tipplr.in>', subject: 'Contract – sign-off', html: null, text: 'Can you sign off by Friday? ₹5,000', headers: { 'List-Id': '<x>' }, message_id: '<m1@x>' } as any)
  const mail = M.parseMail(raw)
  assert.equal(mail.subject, 'Contract – sign-off'); assert.equal(mail.messageId, '<m1@x>'); assert.equal(mail.listId, '<x>'); assert.equal(mail.text, 'Can you sign off by Friday? ₹5,000')
})

await check('AskGogo\'s own digest emails never need you', () => {
  assert.equal(A.classifyEmail({ id: 'x', from: 'Gogo from AskGogo <brief@askgogo.in>', subject: '4 events · 6 reminders', snippet: 'Payment failed and shutdown coming soon — action required', date: new Date().toISOString() } as any), 'update')
  assert.equal(A.classifyEmail({ id: 'y', from: 'Gogo from AskGogo <gogo@mail.resend-sender.com>', subject: '4 events · 6 reminders', snippet: 'Something went wrong with a payment, action required, shutdown', date: new Date().toISOString() } as any), 'update')
  assert.equal(A.scoreEmail({ id: 'y2', from: 'Gogo from AskGogo <gogo@mail.resend-sender.com>', subject: '4 events · 6 reminders', snippet: 'Something went wrong: payment failed', date: new Date().toISOString() } as any).score, 0)
  assert.notEqual(A.classifyEmail({ id: 'z', from: 'Nithin <nithin@tipplr.in>', subject: 'Re: AskGogo POS', snippet: 'Can you approve this by tomorrow?', date: new Date().toISOString() } as any), 'update')
})

// Exercise actual inbound-mail handler through an inert delivery-ledger truth table.
await import('./verify-inbound-notification-outcome.mts')

if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('email attention: all checks passed')
