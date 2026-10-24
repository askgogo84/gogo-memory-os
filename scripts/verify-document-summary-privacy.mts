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

 
// P1 Twilio image transport boundary — fixtures only; never call Twilio or a model.
// A hostile MediaUrl0 must not induce server SSRF or carry Twilio Basic credentials.
const twilioSid = 'AC' + 'a'.repeat(32)
const twilioMessage = 'MM' + 'b'.repeat(32)
const twilioMedia = 'ME' + 'c'.repeat(32)
const trustedMediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages/${twilioMessage}/Media/${twilioMedia}`
const priorSid = process.env.TWILIO_ACCOUNT_SID
const priorToken = process.env.TWILIO_AUTH_TOKEN
const priorMediaFetch = globalThis.fetch
process.env.TWILIO_ACCOUNT_SID = twilioSid
process.env.TWILIO_AUTH_TOKEN = 'inert-media-auth-fixture'
try {
  const { downloadTwilioMediaAsDataUrl, trustedTwilioMediaUrl } = await import('../lib/services/image-note-reader')
  assert.equal(trustedTwilioMediaUrl(trustedMediaUrl, twilioSid), trustedMediaUrl)
  const attempts: Array<{ url: string; redirect: RequestRedirect; authorization: string | null }> = []
  globalThis.fetch = (async (url, init) => {
    attempts.push({
      url: String(url),
      redirect: init?.redirect || 'follow',
      authorization: new Headers(init?.headers).get('authorization'),
    })
    return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })
  }) as typeof fetch

  for (const hostileUrl of [
    'http://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/admin',
    'https://api.twilio.com.evil.test/2010-04-01/Accounts/x',
    trustedMediaUrl.replace('https:', 'http:'),
    trustedMediaUrl.replace('api.twilio.com/', 'api.twilio.com:8443/'),
    trustedMediaUrl.replace('/Accounts/' + twilioSid, '/Accounts/AC' + 'e'.repeat(32)),
    trustedMediaUrl + '?next=http://169.254.169.254/',
    trustedMediaUrl + '#redirect',
    trustedMediaUrl.replace('api.twilio.com/', 'api.twilio.com@evil.test/'),
    trustedMediaUrl.replace('/Media/' + twilioMedia, '/Media/arbitrary'),
  ]) {
    assert.equal(trustedTwilioMediaUrl(hostileUrl, twilioSid), null, 'no unsafe media source is trusted')
    await assert.rejects(
      downloadTwilioMediaAsDataUrl({ mediaUrl: hostileUrl, contentType: 'image/png' }),
      /Untrusted Twilio media URL/,
    )
  }
  assert.equal(attempts.length, 0, 'invalid URL fails BEFORE any request or Basic credential')

  const verified = await downloadTwilioMediaAsDataUrl({ mediaUrl: trustedMediaUrl, contentType: 'image/png' })
  assert.equal(verified, 'data:image/png;base64,iVBORw==', 'valid account-bound Twilio media is still usable')
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].url, trustedMediaUrl)
  assert.equal(attempts[0].redirect, 'manual', 'never forward Basic auth across HTTP redirects')
  assert.equal(attempts[0].authorization,
    'Basic ' + Buffer.from(twilioSid + ':inert-media-auth-fixture').toString('base64'))

  globalThis.fetch = (async (url, init) => {
    attempts.push({ url: String(url), redirect: init?.redirect || 'follow', authorization: new Headers(init?.headers).get('authorization') })
    return Response.redirect('http://169.254.169.254/latest/meta-data/', 302)
  }) as typeof fetch
  await assert.rejects(downloadTwilioMediaAsDataUrl({ mediaUrl: trustedMediaUrl, contentType: 'image/jpeg' }),
    /Twilio image download failed: 302/)
  assert.equal(attempts.length, 2, 'redirect is rejected without a second server fetch')

  globalThis.fetch = (async () => new Response('fixture', {
    status: 200, headers: { 'content-length': String(18 * 1024 * 1024 + 1) },
  })) as typeof fetch
  await assert.rejects(downloadTwilioMediaAsDataUrl({ mediaUrl: trustedMediaUrl, contentType: 'image/jpeg' }),
    /Image is too large/)
  console.log('Twilio media credential egress: hostile, redirect and oversized fixtures blocked; exact signed-account media allowed')
} finally {
  globalThis.fetch = priorMediaFetch
  if (priorSid === undefined) delete process.env.TWILIO_ACCOUNT_SID
  else process.env.TWILIO_ACCOUNT_SID = priorSid
  if (priorToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
  else process.env.TWILIO_AUTH_TOKEN = priorToken
}
