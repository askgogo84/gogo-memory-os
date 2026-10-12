import assert from 'node:assert/strict'
// 12 Oct: "Pradip Kumar card saved show me" → "I don't see a saved card". The card had been read as
// a generic document (only passports/IDs/payment proofs auto-saved), stored as an image note titled
// "Business card for SkyHi Technologies" (no name), the name search looked at titles only, and
// "card" wasn't a retrieval word. Now: cards save themselves, and names are searched in what was read.
// Run: npx tsx scripts/verify-business-card-memory.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.ANTHROPIC_API_KEY ||= 'dummy'

const A = await import('../lib/services/asset-memory')
const N = await import('../lib/services/asset-natural-retrieval')

// ── Save: tonight's classifier output (generic_document) becomes a saved business card ──
const tonight = A.normalizeExtraction({ assetType: 'generic_document', displayTitle: 'Business Card - Pradip Kumar, SkyHi Technologies',
  fields: { title: 'Business Card', summary: 'Business card for Pradip Kumar, Director at SkyHi Technologies Pvt Ltd, Singapore.' } })!
assert.equal(tonight.assetType, 'business_card')
assert.equal(tonight.privacyClass, 'normal')
assert.equal(tonight.displayTitle, 'Business card · Pradip Kumar (SkyHi Technologies)')
assert.ok(A.isStructuredAsset('business_card'), 'cards are saved without being asked')

const card = A.normalizeExtraction({ assetType: 'business_card', displayTitle: 'x', fields: { name: 'Pradip Kumar', designation: 'Director', company: 'SkyHi Technologies Pvt Ltd',
  phones: '+91 98862 26040, +65 9350 0281', emails: 'pradip.kumar@skyhitechs.com', address: '1 Fullerton Road, Singapore 049213' } })!
assert.equal(card.displayTitle, 'Business card · Pradip Kumar (SkyHi Technologies Pvt Ltd)')
const lines = A.businessCardLines(card.fields, "📇 Saved Pradip Kumar's card")
assert.match(lines, /Director · SkyHi Technologies Pvt Ltd/)
assert.match(lines, /📞 \+91 98862 26040, \+65 9350 0281/, 'phone numbers are shown in full: they are the point of a card')
assert.match(lines, /✉️ pradip\.kumar@skyhitechs\.com/)

// ── Retrieve ────────────────────────────────────────────────────────────────────────────
const savedCard = { id: 'c1', doc_type: 'business_card', title: 'Business card · Pradip Kumar (SkyHi Technologies)', summary: 'Business card · Pradip Kumar · Director', extracted: { assetType: 'business_card', fields: card.fields }, created_at: '2026-10-12T15:57:00Z' }
// An OLD save: an image note whose title lacks the name; the name is only in the read text.
const oldNote = { id: 'n1', doc_type: 'document', title: 'Image note — Business card for SkyHi Technologies Pvt Ltd', summary: 'Business card for SkyHi Technologies Pvt Ltd',
  extracted: { text: 'Pradip Kumar\nDirector\nSKYHI TECHNOLOGIES\nMob: +91 98862 26040' }, created_at: '2026-07-01T10:00:00Z' }
const receipt = { id: 'r1', doc_type: 'receipt', title: 'Receipt · Cult HSR Layout', summary: 'Cult fit HSR Layout badminton court', extracted: {}, created_at: '2026-09-01T10:00:00Z' }
const rahul1 = { id: 'k1', doc_type: 'business_card', title: 'Business card · Rahul Mehta (Acme)', summary: '', extracted: { assetType: 'business_card', fields: { name: 'Rahul Mehta' } }, created_at: '2026-09-01T10:00:00Z' }
const rahul2 = { id: 'k2', doc_type: 'business_card', title: 'Business card · Rahul Shah (Beta)', summary: '', extracted: { assetType: 'business_card', fields: { name: 'Rahul Shah' } }, created_at: '2026-09-02T10:00:00Z' }
const docs = [savedCard, oldNote, receipt, rahul1, rahul2]
const pick = (q: string, list = docs) => N.matchSavedByName(q, list, { verbOk: N.shouldAttemptNaturalAssetRetrieval(q) })?.id ?? null

assert.equal(pick('Pradip Kumar card saved show me'), 'c1', "tonight's exact question")
assert.equal(pick("Pradip's number"), 'c1', 'no verb needed for a contact question')
assert.equal(pick('what is pradip kumar email'), 'c1')
assert.equal(pick('Pradip Kumar card saved show me', [oldNote, receipt]), 'n1', 'old image notes are found by the name inside them')
assert.equal(pick('SkyHi Technologies contact', [oldNote]), 'n1', 'by company too')
assert.equal(pick("Rahul's number"), null, 'one first name on two different cards is not guessed')
assert.equal(pick('Rahul Shah card'), 'k2')
assert.equal(pick('find a badminton court in HSR Layout'), null, 'a booking search never pulls up an old receipt')
assert.equal(pick('what is my HDFC card limit'), null)
assert.equal(pick('show me my cards'), null, 'reserved list command untouched')

// Notes-list fallback (saves from before the documents table) — contact-like notes only.
const notes = [
  { text: 'Image note — SkyHi Technologies card. Pradip Kumar, Director. Mob +91 98862 26040', added_at: '2026-06-01T00:00:00Z' },
  { text: 'HDFC Regalia card statement due on 5th' },
]
assert.match(N.matchNoteByName('Pradip Kumar card', notes)!.text, /Pradip Kumar, Director/)
assert.equal(N.matchNoteByName('HDFC card number', notes), null, 'credit-card questions never hit notes')
assert.equal(N.isContactQuestion('Pradip Kumar card saved show me'), true)
assert.equal(N.isContactQuestion('remind me to call mom'), false)

console.log('Business card memory: visiting cards save themselves with contact details, and "Pradip Kumar card" / "Pradip\'s number" find it — including older saves where the name is only in the text read from the card')
