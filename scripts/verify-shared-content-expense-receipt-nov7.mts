// Inert regression against original shared-content module; no Supabase, WhatsApp, or provider calls.
// The actual saveExpense module returns null on a failed insert even when it doesn't throw.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expenseSaveReceiptReply } from '../lib/agent/shared-content'

const fail = (receipt: any) => {
  const reply = expenseSaveReceiptReply(receipt, '₹2,450', 'Swiggy')
  assert.match(reply, /couldn't confirm the expense was saved/i)
  assert.match(reply, /check "expenses today" before trying again/i)
  assert.doesNotMatch(reply, /^Logged\b/i)
}

for (const noReceipt of [null, undefined, {}, { id: null }, { id: '' }, { id: '   ' }, { id: 0 }, { id: NaN }, { id: 1.1 }, { id: Number.MAX_SAFE_INTEGER + 2 }]) fail(noReceipt)
assert.equal(
  expenseSaveReceiptReply({ id: 'f3ee470a-e28f-41ab-a4c1-7809598746c4' }, '₹2,450', 'Swiggy'),
  'Logged ₹2,450 as Swiggy. Say "expenses today" to see the day.',
)
assert.equal(
  expenseSaveReceiptReply({ id: 123 }, '₹1,250', 'Amazon'),
  'Logged ₹1,250 as Amazon. Say "expenses today" to see the day.',
)

// Bind pure regression to the original live handler's actual call site.
const source = readFileSync('lib/agent/shared-content.ts', 'utf8')
const storage = readFileSync('lib/bot/services/expense-storage.ts', 'utf8')
assert.match(source, /const saved = await saveExpense\(\{/)
assert.match(source, /return expenseSaveReceiptReply\(saved, r\.amount\.text, description\)/)
assert.doesNotMatch(source, /await saveExpense\(\{[^\n]+\}\)\s*\n\s*return `Logged /)
assert.match(storage, /if \(!error\) return data/)
assert.match(storage, /return null/)
console.log('PASS: synthetic expense save receipt, no false success or blind retry (original module)')
