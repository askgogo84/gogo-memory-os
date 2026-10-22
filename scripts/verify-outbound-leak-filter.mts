// Outbound leak filter (Duet brief, 23 Oct). Run: npx tsx scripts/verify-outbound-leak-filter.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { maskOutboundIdentifiers as m } from '../lib/security/outbound-identifiers'

assert.equal(m('Card 4111 1111 1111 1111 saved'), 'Card card ending 1111 saved')
assert.equal(m('4111-1111-1111-1111'), 'card ending 1111')
assert.equal(m('Order 4111111111111112 shipped'), 'Order 4111111111111112 shipped', 'non-Luhn numbers (order ids) stay')
assert.equal(m('Aadhaar 2341 2341 2346'), 'Aadhaar Aadhaar ending 2346')
assert.equal(m('Ref 234123412345'), 'Ref 234123412345', 'a 12-digit number that fails Verhoeff is not Aadhaar')
assert.equal(m('PAN ABCPE1234F'), 'PAN PAN ending 234F')
assert.equal(m('PNR ABC123, flight 6E 1004, call +91 98450 12345'), 'PNR ABC123, flight 6E 1004, call +91 98450 12345', 'PNRs, flights and phones untouched')
assert.equal(m(''), '')
assert.match(readFileSync('lib/whatsapp.ts', 'utf8'), /sanitizeMarkdownForWhatsApp\(maskOutboundIdentifiers\(text \|\| ''\)\)/)
console.log('Outbound leak filter: card (Luhn), Aadhaar (Verhoeff), PAN masked to last 4; other numbers untouched')
