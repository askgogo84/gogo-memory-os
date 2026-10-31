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


// P1 asset-memory PDF transport — inert MediaUrl0/Twilio Basic credential
// boundary regression, using the REAL fetchTwilioBase64 entry point.
// No provider credentials, real media, network, user files, DB writes or sends.
const assetSid = 'AC' + 'a'.repeat(32)
const assetToken = 'fixture-only-token'
const assetUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + assetSid +
  '/Messages/SM' + 'b'.repeat(32) + '/Media/ME' + 'c'.repeat(32)
const oldSid = process.env.TWILIO_ACCOUNT_SID
const oldToken = process.env.TWILIO_AUTH_TOKEN
const oldFetch = globalThis.fetch
const expectedBasic = 'Basic ' + Buffer.from(assetSid + ':' + assetToken).toString('base64')
type Attempt = { url: string; authorization: string | null; redirect?: RequestRedirect }
let attempts: Attempt[] = []
function setAssetTransport(reply: (url: string, attempt: Attempt) => Response | Promise<Response>) {
  attempts = []
  globalThis.fetch = (async (url: any, init: any) => {
    const attempt: Attempt = {
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization'),
      redirect: init?.redirect,
    }
    attempts.push(attempt)
    return reply(attempt.url, attempt)
  }) as typeof fetch
}
process.env.TWILIO_ACCOUNT_SID = assetSid
process.env.TWILIO_AUTH_TOKEN = assetToken
try {
  assert.equal(A.trustedAssetTwilioMediaUrl(assetUrl, assetSid), assetUrl)
  assert.equal(A.trustedAssetTwilioCdnUrl('https://mms.twiliocdn.com/asset/path?sig=fixture'),
    'https://mms.twiliocdn.com/asset/path?sig=fixture')
  setAssetTransport(() => { throw new Error('Hostile media URL caused network fetch') })
  for (const hostile of [
    'http://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/internal',
    assetUrl.replace('https:', 'http:'),
    assetUrl.replace('api.twilio.com/', 'api.twilio.com.evil.test/'),
    assetUrl.replace('api.twilio.com/', 'attacker:pass@api.twilio.com/'),
    assetUrl.replace('api.twilio.com/', 'api.twilio.com:8443/'),
    assetUrl.replace('/Accounts/' + assetSid, '/Accounts/AC' + 'd'.repeat(32)),
    assetUrl.replace('/Media/ME' + 'c'.repeat(32), '/Media/other'),
    assetUrl + '?next=https://169.254.169.254/',
    assetUrl + '#leak',
    'https://mms.twiliocdn.com/asset/path',
  ]) {
    assert.equal(A.trustedAssetTwilioMediaUrl(hostile, assetSid), null)
    await assert.rejects(A.fetchTwilioBase64(hostile, 'application/pdf'),
      /Untrusted Twilio asset media URL/)
  }
  assert.equal(attempts.length, 0, 'untrusted source never reaches network')
  setAssetTransport(() => new Response('%PDF-fixture', { status: 200 }))
  const first = await A.fetchTwilioBase64(assetUrl, 'application/pdf')
  assert.equal(Buffer.from(first.b64, 'base64').toString('utf8'), '%PDF-fixture')
  assert.equal(first.isPdf, true)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].url, assetUrl)
  assert.equal(attempts[0].authorization, expectedBasic, 'Basic only on exact Twilio account origin')
  assert.equal(attempts[0].redirect, 'manual', 'never follow redirect with Basic auth')

  const cdn = 'https://mms.twiliocdn.com/safe-document/asset?sig=fixture'
  setAssetTransport(url => url === assetUrl
    ? new Response(null, { status: 302, headers: { location: cdn } })
    : new Response('%PDF-cdn-fixture', { status: 200 }))
  const redirected = await A.fetchTwilioBase64(assetUrl, 'application/pdf')
  assert.equal(Buffer.from(redirected.b64, 'base64').toString('utf8'), '%PDF-cdn-fixture')
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1].url, cdn)
  assert.equal(attempts[0].authorization, expectedBasic)
  assert.equal(attempts[1].authorization, null, 'never send SID/token on the CDN hop')
  assert.ok(attempts.every(x => x.redirect === 'manual'))

  for (const maliciousLocation of [
    'http://169.254.169.254/latest/meta-data/',
    'https://mms.twiliocdn.com.evil.test/steal',
    'https://mms.twiliocdn.com@evil.test/path',
    'http://mms.twiliocdn.com/file',
    'https://mms.twiliocdn.com:8443/path',
    'https://mms.twiliocdn.com/',
  ]) {
    setAssetTransport(() => new Response(null, {
      status: 302, headers: { location: maliciousLocation },
    }))
    await assert.rejects(A.fetchTwilioBase64(assetUrl, 'application/pdf'),
      /Untrusted Twilio asset media redirect/)
    assert.equal(attempts.length, 1, 'malicious redirect must not trigger second fetch')
  }
  setAssetTransport(() => new Response(null, { status: 302, headers: { location: cdn } }))
  await assert.rejects(A.fetchTwilioBase64(assetUrl, 'application/pdf'),
    /Twilio asset media unavailable/)
  assert.equal(attempts.length, 2, 'second redirect must not trigger a third fetch')

  setAssetTransport(() => new Response('oversize', {
    status: 200, headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
  }))
  await assert.rejects(A.fetchTwilioBase64(assetUrl, 'application/pdf'),
    /exceeds size limit/)
  setAssetTransport(() => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(11 * 1024 * 1024))
      controller.enqueue(new Uint8Array(11 * 1024 * 1024))
      controller.close()
    },
  }), { status: 200 }))
  await assert.rejects(A.fetchTwilioBase64(assetUrl, 'application/pdf'),
    /exceeds size limit/, 'streamed payload must be bounded without a Content-Length header')
  delete process.env.TWILIO_AUTH_TOKEN
  setAssetTransport(() => { throw new Error('missing credentials should never fetch') })
  await assert.rejects(A.fetchTwilioBase64(assetUrl, 'application/pdf'),
    /missing credentials/)
  assert.equal(attempts.length, 0)
  console.log('Asset PDF Twilio auth egress: hostile URL/redirect, 20MiB streaming cap, missing token rejected; exact account and auth-stripped CDN accepted (synthetic only)')
} finally {
  globalThis.fetch = oldFetch
  if (oldSid === undefined) delete process.env.TWILIO_ACCOUNT_SID
  else process.env.TWILIO_ACCOUNT_SID = oldSid
  if (oldToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
  else process.env.TWILIO_AUTH_TOKEN = oldToken
}
