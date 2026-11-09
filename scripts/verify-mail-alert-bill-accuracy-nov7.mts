// Synthetic regression: neither Gmail nor WhatsApp nor the database is accessed.
import assert from 'node:assert/strict'
const mailAlerts = await import('../lib/email/mail-alerts')
const { scoreEmail } = await import('../lib/email/attention')
const now = Date.parse('2026-11-06T10:00:00+05:30')
const mail = (id: string, subject: string, snippet: string) => ({
  id, messageId: id, threadId: id, from: 'Billing Notices <billing@synthetic.example>',
  subject, snippet, labelIds: ['INBOX'], internalDate: now - 60_000,
  date: new Date(now - 60_000).toUTCString(),
})
const alert = (id: string, subject: string, snippet: string, ctx: Record<string, unknown> = {}) => {
  const scored = scoreEmail(mail(id, subject, snippet) as any, { now })
  return { scored, kind: mailAlerts.alertKindOf(scored), message: mailAlerts.composeAlert('money_leaving', scored, { now, timezone: 'Asia/Kolkata', ...ctx }) }
}
// Issue: statement date is not the payment date, even if it occurs first.
const statement = alert('statement', 'Statement for 1 Nov 2026', 'Your bill of ₹2,400 is due on 15 Nov 2026.')
assert.equal(statement.scored.category, 'bill_due')
assert.equal(statement.kind, 'money_leaving')
assert.match(statement.message, /₹2,400.*due 15 Nov 2026/)
assert.doesNotMatch(statement.message, /overdue|was due 1 Nov/i)
assert.equal(mailAlerts.paymentDueDateInText('Statement for 1 Nov 2026. Payment due on 15 Nov 2026'), '15 Nov 2026')
// Trip shouldn't attach to a statement date; only a payment deadline within the trip counts.
const withTrip = alert('statement-trip', 'Statement for 8 Nov 2026',
  'Your bill of ₹2,400 is due on 15 Nov 2026.',
  { trips: [{ departAt: '2026-11-07T09:00:00+05:30', returnAt: '2026-11-12T19:00:00+05:30', toCity: 'Mumbai' }] })
assert.doesNotMatch(withTrip.message, /You fly|falls while you're away/)
// Issue: a small late fee first must not silence a large amount due.
const fee = alert('fee', 'Payment Reminder', 'A late fee of ₹100 applies. Your total amount due is ₹24,000. Pay by 15 Nov 2026.')
assert.equal(fee.scored.category, 'bill_due')
assert.equal(fee.kind, 'money_leaving')
assert.equal(mailAlerts.billAmountOf('A late fee of ₹100 applies. Your total amount due is ₹24,000.')?.text, '₹24,000')
assert.match(fee.message, /₹24,000.*due 15 Nov 2026/)
assert.doesNotMatch(fee.message, /\*₹100\*/)
// Multiple unlabeled amounts: keep the alert without presenting an invented total.
const ambiguous = alert('ambiguous', 'Payment Reminder', 'Late fee ₹100. Current balance ₹24,000. Your bill is due on 15 Nov 2026.')
assert.equal(ambiguous.kind, 'money_leaving')
assert.equal(mailAlerts.billAmountOf('Late fee ₹100. Current balance ₹24,000.'), null)
assert.doesNotMatch(ambiguous.message, /\*₹100\*|\*₹24,000\*/)
// Keep tiny bills quiet, and only call a genuinely past, explicit due date potentially overdue.
const small = alert('small', 'Payment Reminder', 'Your payment of ₹15 is due on 5 Nov. Pay now to avoid fees.')
assert.equal(small.kind, null)
const past = alert('past', 'Payment Reminder', 'Your bill of ₹2,400 is due on 5 Nov.')
assert.match(past.message, /was due 5 Nov, so it's overdue unless you've paid/)
console.log('PASS synthetic mail alert bill accuracy (no external calls)')
