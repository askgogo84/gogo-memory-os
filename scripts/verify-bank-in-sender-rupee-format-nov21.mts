// 21 Nov, owner screenshot 08:15: "💳 Money leaving — Gogo, Bank: ₹123991.00 "A payment was made using your Credit Card"."
// The sender was alerts@hdfcbank.bank.in. ".bank.in" was treated as the whole sender, so the alert said "Bank", and every
// bank on .bank.in / .fin.in was one sender for mute and learning rules. The amount had no digit grouping.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const at: any = await import('../lib/email/attention')
const ma: any = await import('../lib/email/mail-alerts')

assert.equal(at.senderDomainOf('alerts@hdfcbank.bank.in'), 'hdfcbank.bank.in')
assert.equal(at.senderDomainOf('alerts@mail.icicibank.bank.in'), 'icicibank.bank.in')
assert.notEqual(at.senderDomainOf('alerts@hdfcbank.bank.in'), at.senderDomainOf('alerts@icicibank.bank.in'), 'two banks are two senders')
assert.equal(at.senderDomainOf('noreply@bajaj.fin.in'), 'bajaj.fin.in')
// Unchanged: the older forms.
assert.equal(at.senderDomainOf('alerts@alerts.hdfcbank.net'), 'hdfcbank.net')
assert.equal(at.senderDomainOf('nithin@tipplr.in'), 'tipplr.in')
assert.equal(at.senderDomainOf('x@mail.example.co.in'), 'example.co.in')
for (const [from, name] of [['alerts@hdfcbank.bank.in', 'HDFC Bank'], ['alerts@icicibank.bank.in', 'ICICI Bank'], ['alerts@kotakbank.bank.in', 'Kotak Bank'], ['alerts@axisbank.com', 'Axis Bank'], ['no-reply@sbi.bank.in', 'SBI'],
  ['HDFC Bank InstaAlerts <alerts@hdfcbank.net>', 'HDFC Bank InstaAlerts'], ['Nithin K L <nithin@tipplr.in>', 'Nithin K L'], ['divya@example.com', 'Divya'], ['alerts@zomato.com', 'Zomato']] as const)
  assert.equal(at.senderNameOf(from), name, from)
// Review: the bank name comes only from the domain of a known bank, never from a local part or a look-alike word.
for (const [from, name] of [['hdfcbank@gmail.com', 'Hdfcbank'], ['bob@example.com', 'Bob'], ['sbi@evil.example', 'Sbi'], ['eubank@example.com', 'Eubank'], ['alerts@foodbank.org', 'Foodbank'], ['alerts@evilbank.bank.in', 'Evilbank'],
  ['alerts@hdfcbank.phish.example', 'Phish'], ['alerts@idfcfirstbank.com', 'IDFC First Bank'], ['alerts@citibank.com', 'Citi Bank']] as const)
  assert.equal(at.senderNameOf(from), name, from)
// A rule saved under the old "bank.in" key still matches.
{ const now = Date.now(); const e = ma.toAttentionEmail({ id: 'r1', from: 'alerts@hdfcbank.bank.in', subject: 'Offer for you', snippet: 'A new offer on your card.', date: new Date(now - 60_000).toUTCString() })!
  const muted = at.scoreEmail(e, { now, rules: [{ kind: 'never', matchType: 'domain', matchValue: 'bank.in', label: 'bank mail' }] } as any)
  const plainS = at.scoreEmail(e, { now } as any)
  assert.ok(muted.ruleApplied && !plainS.ruleApplied, 'the legacy bank.in rule is still applied') }
console.log('✓ a .bank.in sender is its own bank, by name')

for (const [raw, out] of [['123991.00', '1,23,991.00'], ['35841.29', '35,841.29'], ['1,23,991.00', '1,23,991.00'], ['24,000', '24,000'], ['999', '999'], ['1000', '1,000'], ['100000', '1,00,000'], ['12345678.5', '1,23,45,678.5'], ['0.50', '0.50'], ['17.70', '17.70'], ['abc', 'abc']] as const)
  assert.equal(ma.rupees(raw), out, raw)
assert.deepEqual(ma.amountOf('Rs. 123991.00 was debited'), { value: 123991, text: '₹1,23,991.00' })
assert.equal(ma.amountOf('charged $17.70 today')?.text, '$17.70', 'dollars are untouched')

// The alert as it should have read.
const now = Date.parse('2026-11-21T08:15:00+05:30')
const s = at.scoreEmail(ma.toAttentionEmail({ id: 'h1', threadId: 't1', from: 'alerts@hdfcbank.bank.in', subject: 'A payment was made using your Credit Card', snippet: 'Dear Customer, Rs. 123991.00 has been debited from your HDFC Bank Credit Card ending 1234 towards a merchant on 21 Nov, 2026 at 08:10:11.', date: new Date(now - 300_000).toUTCString(), labelIds: ['INBOX', 'CATEGORY_UPDATES', 'UNREAD'] })!, { now })
const kind = ma.alertKindOf(s)
assert.equal(kind, 'money_leaving')
const msg = ma.composeAlert(kind, s, { name: 'Gogo', now } as any)
assert.match(msg, /HDFC Bank/, msg); assert.match(msg, /\*₹1,23,991\.00\*/, msg); assert.doesNotMatch(msg, /Gogo, Bank:|123991\.00/, msg)
// Review: a bill alert does not repeat itself because the amount is now grouped.
{ const b = at.scoreEmail(ma.toAttentionEmail({ id: 'b1', threadId: 't2', from: 'billing@bescom.example', subject: 'Your electricity bill is due', snippet: 'Total amount due: Rs. 35841.29. Pay by 25 Nov 2026 to avoid late fee.', date: new Date(now - 300_000).toUTCString() })!, { now })
  const k = ma.alertKindOf(b); assert.equal(k, 'money_leaving')
  const m = ma.composeAlert(k, b, { name: 'Gogo', now } as any)
  assert.match(m, /\*₹35,841\.29\*/, m); assert.equal((m.match(/35,?841\.29/g) || []).length, 1, m); assert.equal((m.match(/Your electricity bill is due/g) || []).length, 1, m) }
console.log('✓ the alert names HDFC Bank and reads ₹1,23,991.00')
