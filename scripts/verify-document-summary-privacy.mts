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


// P1 image-note/receipt media egress: exercise the ACTUAL exported downloader
// and its transport with synthetic bytes and URLs only. No network or Twilio.
{
  const originalSid = process.env.TWILIO_ACCOUNT_SID
  const originalToken = process.env.TWILIO_AUTH_TOKEN
  const sid = 'AC' + 'a'.repeat(32)
  const otherSid = 'AC' + 'd'.repeat(32)
  const message = 'MM' + 'b'.repeat(32)
  const media = 'ME' + 'c'.repeat(32)
  const good = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages/' + message + '/Media/' + media
  process.env.TWILIO_ACCOUNT_SID = sid
  process.env.TWILIO_AUTH_TOKEN = 'fixture-never-send'
  const { downloadTwilioMediaAsDataUrl } = await import('../lib/services/image-note-reader')
  const { fetchTwilioImageNote, TWILIO_IMAGE_NOTE_MAX_BYTES } = await import('../lib/services/twilio-image-note-egress')
  const requests: { url: string; auth: string | null; redirect: RequestRedirect | undefined }[] = []
  const imageResponse = () => new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200, headers: { 'content-type': 'image/png', 'content-length': '4' },
  })
  const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    requests.push({ url: String(input), auth: headers.get('authorization'), redirect: init?.redirect })
    return imageResponse()
  }
  try {
    globalThis.fetch = transport as typeof fetch
    // Validate BEFORE any Basic header can be sent, even for plausible hosts.
    for (const hostile of [
      'https://169.254.169.254/latest/meta-data/',
      'http://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages/' + message + '/Media/' + media,
      'https://api.twilio.com.evil.example/2010-04-01/Accounts/' + sid + '/Messages/' + message + '/Media/' + media,
      'https://api.twilio.com@evil.example/2010-04-01/Accounts/' + sid + '/Messages/' + message + '/Media/' + media,
      good.replace(sid, otherSid),
      good + '?target=https://169.254.169.254/',
      good + '#fragment',
      good + '/extra',
      good.replace(message, 'bad-message'),
    ]) {
      await assert.rejects(() => downloadTwilioMediaAsDataUrl({ mediaUrl: hostile, contentType: 'image/png' }))
      assert.equal(requests.length, 0, 'hostile origin/account/query must not cause a fetch')
    }
    const valid = await downloadTwilioMediaAsDataUrl({ mediaUrl: good, contentType: 'image/jpeg' })
    assert.equal(valid, 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64'),
      'real image-note entrypoint uses checked response MIME and synthetic bytes')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, good)
    assert.equal(requests[0].auth, 'Basic ' + Buffer.from(sid + ':fixture-never-send').toString('base64'))
    assert.equal(requests[0].redirect, 'manual')

    // One explicit CDN hop, stripped of ALL credentials; no follow-on redirects.
    const cdn = 'https://mms.twiliocdn.com/fixture/asset.jpg?signature=fixture'
    requests.length = 0
    const redirectTransport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({
        url: String(input), auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect,
      })
      return requests.length === 1
        ? new Response(null, {status:302,headers:{location:cdn}})
        : imageResponse()
    }
    const redirected = await fetchTwilioImageNote(good, sid, 'fixture-never-send', { fetchImpl: redirectTransport as typeof fetch })
    assert.equal(redirected.contentType, 'image/png')
    assert.equal(requests.length, 2)
    assert.equal(requests[0].auth?.startsWith('Basic '), true)
    assert.equal(requests[1].url, cdn)
    assert.equal(requests[1].auth, null, 'never disclose SID/token to CDN')
    assert.ok(requests.every(request => request.redirect === 'manual'))

    for (const location of [
      'https://169.254.169.254/latest/meta-data/',
      'https://mms.twiliocdn.com.evil.example/image',
      'http://mms.twiliocdn.com/fixture',
      'https://mms.twiliocdn.com@evil.example/fixture',
    ]) {
      let count = 0
      await assert.rejects(() => fetchTwilioImageNote(good, sid, 'fixture-never-send', {
        fetchImpl: (async () => { count++; return new Response(null, {status:302,headers:{location}}) }) as typeof fetch,
      }))
      assert.equal(count, 1, 'hostile redirect never receives a second fetch')
    }
    let secondHops = 0
    await assert.rejects(() => fetchTwilioImageNote(good, sid, 'fixture-never-send', {
      fetchImpl: (async () => {
        secondHops++
        return new Response(null, {status:302,headers:{location:cdn}})
      }) as typeof fetch,
    }))
    assert.equal(secondHops, 2, 'second redirect is never followed')
    await assert.rejects(() => fetchTwilioImageNote(good, sid, 'fixture-never-send', {
      fetchImpl: (async () => new Response('<html>not an image</html>', {
        status:200,headers:{'content-type':'text/html'},
      })) as typeof fetch,
    }))
    await assert.rejects(() => fetchTwilioImageNote(good, sid, 'fixture-never-send', {
      fetchImpl: (async () => new Response('tiny', {
        status:200,headers:{'content-type':'image/jpeg','content-length':String(TWILIO_IMAGE_NOTE_MAX_BYTES + 1)},
      })) as typeof fetch,
    }), /too_large/)

    // No Content-Length is not a size bypass: count real streaming bytes.
    let pullCount = 0
    const chunk = new Uint8Array(2 * 1024 * 1024)
    const oversized = () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount++ >= 10) controller.close()
        else controller.enqueue(chunk)
      },
    }), {status:200,headers:{'content-type':'image/jpeg'}})
    await assert.rejects(() => fetchTwilioImageNote(good, sid, 'fixture-never-send', {
      fetchImpl: (async () => oversized()) as typeof fetch,
    }), /too_large/)
    assert.ok(pullCount > 1, 'stream limit tested beyond the first chunk')
    console.log('P1 image note/receipt egress: actual entrypoint and inert URL, Basic stripping, MIME, redirect and 18MiB streamed limits passed')
  } finally {
    globalThis.fetch = originalFetch
    if (originalSid === undefined) delete process.env.TWILIO_ACCOUNT_SID
    else process.env.TWILIO_ACCOUNT_SID = originalSid
    if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
    else process.env.TWILIO_AUTH_TOKEN = originalToken
  }
}
