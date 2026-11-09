// Synthetic, no-provider regression: large incoming bank credits must never be
// announced as money leaving. Exercises the original classifier and daily cap.
import assert from 'node:assert/strict'
import { alertKindOf, selectAlerts, normalizeRules } from '../lib/email/mail-alerts'
import { classifyEmail, scoreEmail } from '../lib/email/attention'

const now = Date.parse('2026-11-06T12:00:00+05:30')
const mock = (id: string, subject: string, snippet: string) => ({
  id, messageId: id, threadId: 'inert-thread-' + id,
  from: 'Example Bank <alerts@bank.example.test>', to: 'user@example.test',
  subject, snippet, internalDate: now - 60_000,
  date: new Date(now - 60_000).toUTCString(), labelIds: ['INBOX'],
  isUnread: true, source: 'gmail' as const,
})
const cases = [
  { id: 'credit', subject: 'Your account has been credited with Rs. 50,000.00', text: 'INR 50,000.00 credited to your account today.', expected: null },
  { id: 'salary', subject: 'Salary credited to your account', text: 'Your account has been credited with Rs. 81,000.00 salary.', expected: null },
  { id: 'refund', subject: 'Refund credited to your account', text: 'Your account has been credited Rs. 19,000.00 as a refund.', expected: null },
  { id: 'cashback', subject: 'Cashback credited to your account', text: 'Rs. 11,000.00 cashback credited to your account.', expected: null },
  { id: 'mixed', subject: 'Account debit and credit adjustment', text: 'Your account has been debited Rs. 25,000.00 and credited Rs. 25,000.00 after reversal.', expected: null },
  { id: 'large-debit', subject: 'Your account has been debited', text: 'Your account was debited Rs. 25,000.00 for an outgoing card payment.', expected: 'money_leaving' },
  { id: 'small-debit', subject: 'Your card was debited', text: 'Rs. 252.00 debited from your card at the grocery shop.', expected: null },
] as const

const emails = cases.map(t => mock(t.id, t.subject, t.text))
for (const [i, t] of cases.entries()) {
  const e = emails[i] as any
  assert.equal(classifyEmail(e), 'transaction_alert', `${t.id}: attention groups incoming and outgoing`)
  const s = scoreEmail(e, { now })
  assert.equal(s.category, 'transaction_alert')
  assert.equal(alertKindOf(s), t.expected, `${t.id}: preserve financial direction`)
}
// A signed mandate must still alert even without a debit transaction notification.
const mandateEmail = mock('mandate', 'New recurring payment mandate registered', 'New recurring-payment mandate registered for Rs. 1,32,482.00.')
assert.equal(alertKindOf({ email: mandateEmail as any, category: 'transaction_alert', score: 0, senderEmail: '', senderName: '' } as any), 'money_leaving', 'explicit mandate control')

// Classifier alone must not burn the daily quota on salary/refund/credit events.
const selected = selectAlerts(emails as any, {
  rules: normalizeRules(undefined), state: null,
  ctx: { now, timezone: 'Asia/Kolkata' }, ownEmail: 'user@example.test',
})
assert.deepEqual(selected.alerts.map(a => a.id), ['large-debit'], 'only real large outflow creates alert')
assert.equal(selected.state.sentToday, 1, 'incoming credits do not consume daily cap')
assert.equal(selected.alerts[0].kind, 'money_leaving')
assert.ok(!selected.alerts[0].message.includes('credited'), 'outgoing alert does not invent credit')
console.log('Mail transaction-direction controls passed: credited/salary/refund/cashback/mixed fail closed; large debit and mandate retained; cap untouched by incoming funds.')
