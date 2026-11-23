import assert from 'node:assert/strict'
import {generateDoc} from '../lib/make/generate'

// Real Make generator, inert model/search dependencies; no connected-app reads.
const exact = 'Create a private sheet titled Demo Acceptance Scratch 23 Nov with columns Check and Status, and exactly two rows: Reminder delivery, Verified; Cross-channel memory, Pending. Use only this text; do not read connected apps, share it or send anything. Save it in Make and give me its link.'
const sheet = {title: 'Demo Acceptance Scratch 23 Nov', columns: ['Check', 'Status'], rows: [['Reminder delivery', 'Verified'], ['Cross-channel memory', 'Pending']], totalColumn: null}
for (const request of [exact,
  'Create a sheet. Use only the provided data.',
  'Create a sheet; please use only supplied text.',
  'Create a sheet. Do not use external sources.',
  "Create a sheet. Don't search the web.",
  'Create a sheet. Never consult outside information.',
  'Create a sheet, use only this text: Check, Status; Delivery, Verified.',
  'Create a sheet\nDo not search the web.',
  'Create a sheet\r\nPlease use only the supplied content.',
  'Create a sheet from my bank account statements.',
]) {
  let searches = 0
  const out = await generateDoc('sheet', request, {
    search: async () => { searches++; return [{title: 'unrelated template', snippet: 'MUST NOT reach prompt', url: 'https://example.com/unrelated'}] },
    model: async (prompt, scanText) => {
      assert.equal(scanText, request)
      assert.doesNotMatch(prompt, /MUST NOT|unrelated template/)
      return JSON.stringify(sheet)
    },
  })
  assert.equal(searches, 0, request)
  assert.deepEqual(out?.sources, [])
  assert.deepEqual(out?.doc, {...sheet, format: 'sheet', rows: sheet.rows, estimateRows: [], notes: ''})
}
// A normal research request still has public evidence; negation is not a source-only instruction.
for (const request of ['Create a sheet of public park names.', 'Create a sheet. Do not use only this text; research public park names.', 'Create a sheet, do not use only this text; research public park names.']) {
  let searches = 0
  const out = await generateDoc('sheet', request, {
    search: async () => { searches++; return [{title: 'Park authority', snippet: 'Known public park', url: 'https://example.com/parks'}] },
    model: async prompt => { assert.match(prompt, /Known public park/); return JSON.stringify(sheet) },
  })
  assert.equal(searches, 1)
  assert.deepEqual(out?.sources, ['https://example.com/parks'])
}
const deck = await generateDoc('deck', 'Create a deck. Use only this text.', {
  search: async () => {throw Error('unexpected web search')},
  model: async prompt => {assert.match(prompt, /may be empty/); return JSON.stringify({title: 'Test', slides: [{title: 'One'}, {title: 'Two'}]})},
})
assert.equal(deck?.doc.format, 'deck')
assert.deepEqual(deck?.sources, [])
console.log('verify-make-source-only-nov23: real generator skips external search, retains content and public research controls PASS (offline)')
