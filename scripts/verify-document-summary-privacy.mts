import assert from 'node:assert/strict'
import { safeDocumentSummary, redactDocumentMetadata } from '../lib/services/document-summary-privacy'

const legacy = 'Indian passport for Example Person · Passport number Z1234567 · Date of birth 12 March 1985 · expires March 2028'
for (const docType of ['passport', 'id_document', 'generic_document', undefined]) {
  const safe = safeDocumentSummary(legacy, docType)
  assert.ok(!safe.includes('Z1234567') && !safe.includes('1985'), `legacy ${docType} does not leak identity values`)
}
assert.equal(safeDocumentSummary('Z1234567 12/03/1985', 'generic_document', {privacyClass:'sensitive'}), 'Sensitive document details are hidden.')
assert.equal(safeDocumentSummary('Z1234567 12/03/1985', 'generic_document', {detectedAssetType:'passport'}), 'Sensitive document details are hidden.')
for (const label of ['DOB:', 'D.O.B.', 'Date of birth:', 'Birth date:']) {
  assert.ok(!redactDocumentMetadata(`${label} 12/03/1985; saved`).includes('1985'))
}
for (const value of ['Z1234567', 'ABCDE1234F', '1234 5678 9012']) {
  assert.ok(!redactDocumentMetadata(`Saved document ${value}`).includes(value))
}
const invoice = 'Example shop · ₹29,900.00 · 18/09/2026 · MRP 29900.00'
assert.equal(safeDocumentSummary(invoice, 'invoice'), invoice, 'ordinary invoice amounts and dates stay readable')
assert.equal(safeDocumentSummary(null, 'generic_document'), '')
assert.equal(safeDocumentSummary(safeDocumentSummary(legacy, 'passport'), 'passport'), safeDocumentSummary(legacy, 'passport'))
console.log('Document metadata privacy: legacy passport/DOB, misclassification, and ordinary invoices passed')

// Exercise the real storage boundary with an inert transport. No provider call
// or live database is allowed in this regression.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://privacy-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'
process.env.OPENAI_API_KEY = 'fixture-only'
process.env.METER_ENABLED = 'false'
const originalFetch = globalThis.fetch
const writes: any[] = []
globalThis.fetch = async (input, init) => {
  assert.equal(String(input).split('?')[0], 'https://privacy-fixture.supabase.co/rest/v1/documents')
  assert.equal(init?.method, 'POST')
  writes.push(JSON.parse(String(init?.body)))
  return new Response(JSON.stringify({id:'fixture-document'}), {status:201, headers:{'Content-Type':'application/json'}})
}
try {
  const {storeDocument} = await import('../lib/services/document-store')
  await storeDocument({telegramId:123, docType:'generic_document', docAction:'document_save', title:'Passport Z1234567', summary:legacy,
    extracted:{text:legacy}, indexContent:'{"fixture":true}'})
  assert.equal(writes.length, 1)
  assert.equal(writes[0].telegram_id, 123)
  assert.ok(!writes[0].summary.includes('1985') && !writes[0].summary.includes('Z1234567'))
  assert.ok(!writes[0].title.includes('Z1234567'))
  assert.equal(writes[0].extracted.text, legacy, 'private extraction remains intact')
} finally { globalThis.fetch = originalFetch }
console.log('Document storage: owner-bound metadata is masked, private extraction preserved')
