/**
 * Independent negative fixture for deployed planner reminder wording.
 * Executes the original shipped helper bodies in an inert VM.
 * No DB, external providers, accounts, environment keys, network, or reminder writes.
 * A deliberately failing safety check is evidence ONLY if the controls execute.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/mission-tools.ts', 'utf8')
const start = source.indexOf('function reminderMessage(')
const finish = source.indexOf('function normalizeReminderIdentity(', start)
assert.ok(start >= 0 && finish > start, 'required original helper definitions missing')

const shippedHelperSource = source.slice(start, finish)
const js = ts.transpileModule(
  shippedHelperSource + '\nexports.__message = reminderMessage;\n',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mockExports: Record<string, any> = {}
runInNewContext(js, {
  exports: mockExports,
  // Pure placeholder for the two unrelated presentation helpers.
  safe: (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim(),
  destinationLabel: () => 'trip',
}, { timeout: 2000, filename: 'shipped-reminder-helper-inert.js' })

const parseTask = mockExports.reminderTaskFromRequest as (text: string) => string | null
const reminderMessage = mockExports.__message as (
  step: { tool: string, title: string, instruction: string }, missionText: string, hours?: number,
) => string

assert.equal(typeof parseTask, 'function')
assert.equal(typeof reminderMessage, 'function')
let passed = 0
let failed = 0
const errors: string[] = []
function check(kind: 'CONTROL' | 'SAFETY', name: string, run: () => void) {
  try {
    run()
    passed++
    console.log('PASS ' + kind + ': ' + name)
  } catch (error) {
    failed++
    errors.push(kind + ' ' + name + ': ' + (error instanceof Error ? error.message : String(error)))
    console.error('FAIL ' + kind + ': ' + name)
  }
}
const step = (title: string, instruction = '') => ({ tool: 'reminder', title, instruction })

check('CONTROL', 'single grocery reminder preserves referent list', () => {
  assert.equal(parseTask('Make a grocery list with milk, eggs and bread and remind me to buy them at 6 pm today'), 'buy milk, eggs and bread')
})
check('CONTROL', 'single named reminder respects request', () => {
  assert.equal(parseTask('Plan my week and remind me to call Nithin tomorrow at 11 am'), 'call Nithin')
})
check('CONTROL', 'no reminder intent does not manufacture one', () => {
  assert.equal(parseTask('Plan my packing'), null)
})
check('CONTROL', 'original mission helper retains single generic request', () => {
  assert.equal(reminderMessage(step('Set purchase reminder'), 'Make a grocery list with milk, eggs and bread and remind me to buy them at 6 pm today'), 'buy milk, eggs and bread')
})
check('CONTROL', 'step-specific quoted user message outranks mission parsing', () => {
  assert.equal(reminderMessage(step('Set reminder', "with message 'Wear a jacket'"), 'remind me to check packing tomorrow'), 'Wear a jacket')
})
check('CONTROL', 'named non-generic step title remains unchanged', () => {
  assert.equal(reminderMessage(step('Review packing checklist'), 'plan my trip'), 'Review packing checklist')
})
check('CONTROL', 'explicit departure lead-time keeps its specialized behavior', () => {
  assert.match(reminderMessage(step('Set travel reminder'), 'Plan my trip', 3), /trip departure in 3 hours/)
})

check('SAFETY', 'ordinary preposition on is not interpreted as a reminder date boundary', () => {
  assert.equal(parseTask('remind me to turn on the oven at 6 pm today'), 'turn on the oven')
})
check('SAFETY', 'ordinary preposition on in follow-up task is retained', () => {
  assert.equal(parseTask('remind me to follow up on the invoice tomorrow at 11 am'), 'follow up on the invoice')
})
check('SAFETY', 'ordinary by in a task does not erase its object', () => {
  assert.equal(parseTask('remind me to send the update by email at 9 am today'), 'send the update by email')
})
check('SAFETY', 'two differently named reminder steps retain separate original instructions', () => {
  const text = 'remind me to call Alice tomorrow at 9 am and remind me to buy milk tomorrow at 6 pm'
  assert.equal(reminderMessage(step('Set call reminder', 'Remind me to call Alice tomorrow at 9 am'), text), 'call Alice')
  assert.equal(reminderMessage(step('Set milk reminder', 'Remind me to buy milk tomorrow at 6 pm'), text), 'buy milk')
})

console.log('Executed actual shipped helper functions: ' + passed + ' PASS, ' + failed + ' FAIL')
if (failed) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
