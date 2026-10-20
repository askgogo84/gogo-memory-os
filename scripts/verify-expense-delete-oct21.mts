// 21 Oct live: "Delete the 450 lunch at Truffles expense" reached the model, which said only "the CreditIQ app"
// could delete it and added "you've asked three times". Chat now deletes the matching expense itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const legacy = readFileSync(new URL('../lib/feature-intents-legacy.ts', import.meta.url), 'utf8')
const src = legacy.match(/const expenseDelete = t\.match\((\/.*?\/i)\)/)?.[1]
assert.ok(src, 'delete matcher present')
const re = new Function(`return ${src}`)() as RegExp
const yes = ['delete the 450 lunch at truffles expense', 'remove my last expense', 'undo last expense', 'delete ₹450 expense', 'remove the uber expense']
const no = ['remove eggs from my shopping list', 'delete the reminder to call divya', 'spent 450 on lunch', 'cancel my netflix subscription']
for (const t of yes) assert.ok(re.test(t), `matches: ${t}`)
for (const t of no) assert.ok(!re.test(t), `does not match: ${t}`)
const m = 'delete the 450 lunch at truffles expense'.match(re)!
assert.equal(m[2], '450'); assert.match(String(m[3]), /lunch at truffles/)
assert.ok(legacy.indexOf('const expenseDelete') < legacy.indexOf('const isExpenseLog'), 'delete is checked before logging')
const route = readFileSync(new URL('../app/api/expenses/route.ts', import.meta.url), 'utf8')
assert.match(route, /if \(action === 'delete'\)/)
assert.match(route, /nothing was deleted/)
const store = readFileSync(new URL('../lib/bot/services/expense-storage.ts', import.meta.url), 'utf8')
assert.match(store, /\.delete\(\)\.eq\('id', match\.id\)\.eq\(column, owner\)/, 'delete is owner-bound')
const claude = readFileSync(new URL('../lib/services/claude.ts', import.meta.url), 'utf8')
assert.match(claude, /never remark on how many times the user asked/)
console.log('verify-expense-delete-oct21: ok')
