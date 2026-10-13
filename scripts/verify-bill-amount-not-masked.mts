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
console.log('Documents: money amounts such as 29900.00 are shown; identifier numbers are still hidden')
