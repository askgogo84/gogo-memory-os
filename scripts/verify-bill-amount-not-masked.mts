import assert from 'node:assert/strict'
// 13 Oct 19:30: "Show me my Samsonite bill" printed the total and MRP as "••••.00".
// Run: npx tsx scripts/verify-bill-amount-not-masked.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const m: any = await import('../lib/services/asset-memory')
const fn = m.__test_stripLongDigits
assert.equal(typeof fn, 'function')
assert.equal(fn('Total 29900.00 paid'), 'Total 29900.00 paid', 'a decimal amount stays readable')
assert.equal(fn('MRP: 29900.00, GST18'), 'MRP: 29900.00, GST18')
assert.equal(fn('₹51,000 paid'), '₹51,000 paid')
assert.equal(fn('Card 4111111111111111'), 'Card ••••', 'a long card number is still hidden')
assert.equal(fn('Account 123456789012.00'), 'Account ••••.00', 'an identifier-length run is hidden even with a fraction')
assert.equal(fn('Ref 270355290'), 'Ref ••••', 'a bare long number is still hidden')
const old = {doc_type: 'invoice', title: 'Samsonite Tax Invoice', summary: 'Samsonite South Asia Pvt Ltd · ••••.00 · 18/09/2026 · MRP: ••••.00, GST18',
  extracted: {assetType: 'invoice', privacyClass: 'normal', fields: {vendor: 'Samsonite South Asia Pvt Ltd', amount: '29900.00', date: '18/09/2026', summary: 'SBL CUBELITE DLX SP76 GRAPHITE - Qty 1, MRP: 29900.00, GST18'}}}
const rebuilt = m.refreshedStoredSummary(old)
assert.match(rebuilt, /29900\.00/, 'an already-saved bill shows its amount')
assert.ok(!/••••\./.test(rebuilt))
assert.equal(m.refreshedStoredSummary({...old, extracted: {...old.extracted, privacyClass: 'sensitive'}}), old.summary, 'sensitive documents are left as saved')
assert.equal(m.refreshedStoredSummary({summary: 'Plain ok', extracted: null}), 'Plain ok')
console.log('Documents: money amounts such as 29900.00 are shown; identifier numbers are still hidden')
