import assert from 'node:assert/strict'
import {generateDoc} from '../lib/make/generate'
import {sheetPrompt} from '../lib/make/documents'

const request = 'Create a private sheet titled Demo Source Only 23 Nov with columns Check and Status, and exactly two rows: Reminder delivery, Verified; Cross-channel memory, Pending phone check. Use only this text; do not read connected apps, share it or send anything. Save it in Make and give me its link.'
const correct = {title: 'Demo Source Only 23 Nov', columns: ['Check', 'Status'], rows: [['Reminder delivery', 'Verified'], ['Cross-channel memory', 'Pending phone check']], totalColumn: null}
const wrong = {title: correct.title, columns: ['Item', 'Amount'], rows: [['Flights', 36000], ['Hotel', 72000], ['Car', 7500], ['Tour', 25000], ['Insurance', 3000]]}

// Actual production failure: valid JSON of an unrelated five-row budget must not be saved.
let attempts = 0
assert.equal(await generateDoc('sheet', request, {
  search: async () => {throw Error('source-only search forbidden')},
  model: async () => {attempts++; return JSON.stringify(wrong)},
}), null)
assert.equal(attempts, 2, 'bounded retry, then honest failure')
const strengths: boolean[] = []
const repaired = await generateDoc('sheet', request, {
  search: async () => {throw Error('source-only search forbidden')},
  model: async (prompt, scanText, opts) => {
    strengths.push(Boolean(opts?.strong))
    assert.equal(scanText, request)
    assert.match(prompt, /Follow explicitly requested columns, row count and supplied values exactly/)
    assert.doesNotMatch(prompt, /Rules: 5-20 rows|\[\["Flights"|9000,36000/)
    return JSON.stringify(opts?.strong ? correct : wrong)
  },
})
assert.deepEqual(strengths, [false, true])
assert.deepEqual(repaired?.doc, {...correct, format: 'sheet', notes: '', estimateRows: []})
assert.deepEqual(repaired?.sources, [])
for (const count of ['2', 'two', 'TWO']) {
  assert.equal(await generateDoc('sheet', `Create a sheet with exactly ${count} rows. Use only this text.`, {model: async () => JSON.stringify(wrong)}), null)
}
for (const ask of ['Create a budget sheet.', 'Create a sheet, not exactly two rows.']) {
  const out = await generateDoc('sheet', ask, {search: async () => [], model: async () => JSON.stringify(wrong)})
  assert.equal(out?.doc.format, 'sheet', 'unspecified/negated count retains existing generation')
}
assert.match(sheetPrompt('Create a budget sheet.', ''), /For cost\/budget sheets only/)
console.log('verify-make-explicit-sheet-nov23: real generator rejects wrong count, retries primary and respects explicit shape prompt PASS (offline)')
