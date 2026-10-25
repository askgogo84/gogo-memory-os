// 21 Oct live: "Remove milk from my shopping list" (items "milk and eggs", "milk") changed nothing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { applyRemove } = await import('../lib/data/lists-core')
const items = [{ text: 'milk and eggs', done: false }, { text: 'bananas', done: false }, { text: 'milk', done: false }, { text: 'bread', done: true }] as any
let r = applyRemove(items, 'milk')
assert.equal(r.matched, 'milk'); assert.equal(r.next.length, 3); assert.ok(r.next.some((i: any) => i.text === 'milk and eggs'), 'the exact item goes, the longer one stays')
r = applyRemove(items, 'ban'); assert.equal(r.matched, 'bananas')
r = applyRemove([{ text: 'green tea' }, { text: 'black tea' }] as any, 'tea'); assert.equal(r.matched, null); assert.deepEqual(r.ambiguous, ['green tea', 'black tea'])
r = applyRemove(items, 'rice'); assert.equal(r.matched, null); assert.equal(r.next.length, 4)
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const re = new Function(`return ${pm.match(/const listRemove = incomingText\.trim\(\)\.match\((\/.*?\/i)\)/)![1]}`)() as RegExp
assert.deepEqual('Remove milk from my shopping list'.match(re)!.slice(1, 3), ['milk', 'shopping'])
assert.deepEqual('take bread off the grocery list'.match(re)!.slice(1, 3), ['bread', 'grocery'])
assert.ok(!re.test('remove eggs'), 'needs a list')
assert.ok(!re.test('delete the reminder to call divya'))
console.log('verify-list-remove-oct21: ok')
