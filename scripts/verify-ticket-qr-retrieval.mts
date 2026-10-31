// 19 Oct live: "Jailer qr code" went to general chat ("I don't have a QR code saved") although the PVR ticket
// screenshot with the QR was saved the day before.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
const am = await import('../lib/services/asset-memory')
for (const q of ['Jailer qr code', 'jailer ticket', 'show my Jailer 2 ticket', 'send the movie QR', 'my boarding pass', 'where is my e-ticket for tonight', 'Jailer 2 tickets'])
  assert.equal(am.isAssetRetrievalCommand(q), true, q)
for (const q of ['book tickets for Jailer 2', 'buy 2 tickets for the match', 'cancel my ticket', 'how much are Jailer tickets', 'Book a table for 2 at Toit Indiranagar tomorrow at 7pm', 'what are you working on', 'tickets for coldplay next month available?'])
  assert.equal(am.isAssetRetrievalCommand(q), false, q)
const ticketDoc = {title: 'Jailer 2', doc_type: 'image', summary: 'PVR Orion Mall M-Ticket, AUDI 04, seats K18, K19, K20, booking ID TSAJKDX, QR code', extracted: {}}
const invoice = {title: 'Jailer Traders invoice', doc_type: 'invoice', summary: 'GST invoice', extracted: {}}
assert.equal(am.ticketDocumentBoost('Jailer qr code', ticketDoc), 2)
assert.equal(am.ticketDocumentBoost('Jailer qr code', invoice), 0, 'a non-ticket document with the same word gets no boost')
assert.equal(am.ticketDocumentBoost('Jailer invoice', ticketDoc), 0, 'no boost unless the ask names a ticket/QR')
const src = readFileSync('lib/services/asset-memory.ts', 'utf8')
assert.match(src, /score \+= ticketDocumentBoost\(text, doc\)/)
process.stdout.write('Ticket/QR retrieval: short ticket asks route to saved documents; booking/buying asks do not; ticket docs get a metadata boost.\n')


// P1 VAULT_DOCUMENT_SSRF — private documents cannot leak Twilio Basic auth to
// user-supplied hosts/redirects, or download unlimited bytes into Vault storage.
// Synthetic in-memory transport only: no real provider requests or production DB.
const docTransport = await import('../lib/services/twilio-document-store-egress.ts')
const configuredSid = 'AC' + 'a'.repeat(32)
const otherSid = 'AC' + 'd'.repeat(32)
const messageSid = 'MM' + 'b'.repeat(32)
const mediaSid = 'ME' + 'c'.repeat(32)
const validMediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${configuredSid}/Messages/${messageSid}/Media/${mediaSid}`
const syntheticToken = 'synthetic-test-token'
const authExpected = 'Basic ' + Buffer.from(configuredSid + ':' + syntheticToken).toString('base64')
const validBody = '%PDF-1.7 synthetic only'
const calls: { url: string; init: RequestInit | undefined }[] = []
const successfulFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init })
  return new Response(validBody, {status: 200, headers: {'Content-Type': 'application/pdf'}})
}) as typeof fetch
const fetched = await docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid,
  authToken: syntheticToken, fetchImpl: successfulFetch,
})
assert.equal(fetched.toString(), validBody, 'expected genuine synthetic document bytes')
assert.equal(calls.length, 1)
assert.equal(calls[0].url, validMediaUrl)
assert.equal(calls[0].init?.redirect, 'manual', 'never implicitly follow first-hop redirects')
assert.equal((calls[0].init?.headers as Record<string, string>)?.Authorization, authExpected)

// No malformed host, wrong account or lookalike path may perform ANY network fetch.
for (const url of [
  validMediaUrl.replace('https:', 'http:'),
  validMediaUrl.replace('api.twilio.com', '169.254.169.254'),
  validMediaUrl.replace('api.twilio.com', 'api.twilio.com.attacker.example'),
  validMediaUrl.replace('api.twilio.com', 'attacker@api.twilio.com'),
  validMediaUrl.replace('api.twilio.com', 'api.twilio.com:8443'),
  validMediaUrl.replace(configuredSid, otherSid),
  validMediaUrl.replace('/Media/', '/Media/%2F'),
  validMediaUrl + '?redirect=https://evil.example',
  validMediaUrl + '#private',
  'https://example.com/2010-04-01/Accounts/' + configuredSid,
]) {
  const before = calls.length
  await assert.rejects(
    docTransport.fetchTwilioVaultDocumentMedia({
      mediaUrl: url, accountSid: configuredSid,
      authToken: syntheticToken, fetchImpl: successfulFetch,
    }),
    /Document media|Invalid document media/,
  )
  assert.equal(calls.length, before, 'rejected URL must not fetch or transmit Basic auth: ' + url)
}

calls.length = 0
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: '',
  fetchImpl: successfulFetch,
}), /credentials unavailable/)
assert.equal(calls.length, 0, 'missing credentials fail before network activity')

calls.length = 0
const signedCdn = 'https://mms.twiliocdn.com/private/media?token=synthetic-signature'
const goodRedirect = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({url: String(url), init})
  if (calls.length === 1) return new Response(null, {status: 302, headers: {Location: signedCdn}})
  return new Response(validBody, {status: 200, headers: {'Content-Type': 'application/pdf'}})
}) as typeof fetch
assert.equal((await docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid,
  authToken: syntheticToken, fetchImpl: goodRedirect,
})).toString(), validBody)
assert.deepEqual(calls.map(c => c.url), [validMediaUrl, signedCdn])
assert.equal(calls[0].init?.redirect, 'manual')
assert.equal((calls[0].init?.headers as Record<string,string>).Authorization, authExpected)
assert.equal(calls[1].init?.redirect, 'manual')
assert.equal(calls[1].init?.headers, undefined, 'Twilio Basic MUST NOT appear on CDN hop')

// An off-host CDN and any second redirect are refused rather than followed.
for (const location of ['http://mms.twiliocdn.com/x', 'https://mms.twiliocdn.com.evil.test/x',
  'https://127.0.0.1/private', 'https://user@mms.twiliocdn.com/x']) {
  let hit = 0
  await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
    mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
    fetchImpl: (async () => {
      hit++
      return new Response(null, {status: 302, headers: {Location: location}})
    }) as typeof fetch,
  }), /CDN/)
  assert.equal(hit, 1, 'do not contact rejected CDN origin')
}
let hops = 0
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => {
    hops++
    return new Response(null, {status: 302, headers: {Location: signedCdn}})
  }) as typeof fetch,
}), /HTTP failure/)
assert.equal(hops, 2, 'no third hop may be attempted')

await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => new Response('<html>wrong content</html>', {
    status: 200, headers: {'Content-Type': 'text/html'},
  })) as typeof fetch,
}), /Unsupported Twilio document media type/)
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => new Response('tiny', {
    status: 200, headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(docTransport.TWILIO_VAULT_DOCUMENT_MAX_BYTES + 1),
    },
  })) as typeof fetch,
}), /exceeds size limit/)
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(docTransport.TWILIO_VAULT_DOCUMENT_MAX_BYTES + 1))
      controller.close()
    },
  }), {status: 200, headers: {'Content-Type': 'application/pdf'}})) as typeof fetch,
}), /exceeds size limit/, 'streaming cap is effective even with no Content-Length')

// Wiring regression: doc-store must keep insert-before-upload idempotency, and
// must never use caller FileRef as destination or fetch/arrayBuffer authority.
const documentStoreSource = readFileSync('lib/services/document-store.ts', 'utf8')
assert.match(documentStoreSource, /fetchTwilioVaultDocumentMedia\(/)
assert.match(documentStoreSource, /file\.accountSid !== configuredSid/)
assert.match(documentStoreSource, /file\.authToken !== configuredToken/)
assert.doesNotMatch(documentStoreSource, /fetch\(file\.mediaUrl/)
assert.doesNotMatch(documentStoreSource, /await res\.arrayBuffer\(/)
assert.ok(documentStoreSource.indexOf(".from('documents')\n    .insert(") <
  documentStoreSource.indexOf('await uploadToBucket(params.telegramId, params.file)'),
  'document row must claim source message before any upload (no blind retry)')
console.log('Vault document transport P1: account/origin bound; no Basic on CDN; bad hosts, redirects, MIME and oversized bodies fail closed')
