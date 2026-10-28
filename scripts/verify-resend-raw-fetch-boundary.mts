// Inert network-boundary contract for the authenticated Resend Receiving API.
 // All transport requests are intercepted; no real provider, network, secret or tenant access.
import assert from 'node:assert/strict'
import { fetchReceivedEmail, rawFromParsed } from '../lib/email/resend-inbound'

process.env.RESEND_API_KEY = 'fixture-only-never-real'
const email = {
  id: 'fixture-mail', to: ['owner@example.test'], from: 'sender@example.test',
  subject: 'Synthetic Resend raw fetch boundary', message_id: '<fixture-1@example.test>',
  text: 'Synthetic body from authenticated API', html: null, headers: {},
}

async function checkUntrustedRawLink(rawUrl: string) {
  const requests: Array<{ url: string; authorization: string | null }> = []
  const fixtureFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, authorization: new Headers(init?.headers).get('authorization') })
    if (requests.length === 1) {
      assert.equal(url, 'https://api.resend.com/emails/receiving/fixture%2Fmail')
      return new Response(JSON.stringify({ ...email, raw: { download_url: rawUrl } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('UNTRUSTED_FETCH_RESPONSE', { status: 200 })
  }
  const result = await fetchReceivedEmail('fixture/mail', fixtureFetch)
  assert.equal(requests.length, 1,
    'Raw download URL supplied in API JSON must NEVER cause an additional server-side fetch: ' + rawUrl)
  assert.equal(requests[0].authorization, 'Bearer fixture-only-never-real')
  assert.equal(result.raw, rawFromParsed(email), 'Use authenticated structured content, not arbitrary remote bytes')
  assert.match(result.raw, /Synthetic body from authenticated API/)
  assert.doesNotMatch(result.raw, /UNTRUSTED_FETCH_RESPONSE/)
}

for (const url of [
  'https://127.0.0.1/internal',
  'https://169.254.169.254/latest/meta-data/',
  'https://[::1]/private',
  'https://public.example.test/redirects-to-private',
  'https://provider-looking.example.test/raw',
]) await checkUntrustedRawLink(url)

// The standard authenticated receiving response with no raw link must stay readable.
const plainCalls: string[] = []
const plain = await fetchReceivedEmail('ordinary-fixture', (async (input) => {
  plainCalls.push(String(input))
  return new Response(JSON.stringify(email), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch)
assert.deepEqual(plainCalls, ['https://api.resend.com/emails/receiving/ordinary-fixture'])
assert.equal(plain.raw, rawFromParsed(email))
console.log('PASS RESEND_RAW_FETCH_BOUNDARY: no second-hop URL egress, provider auth fixed, structured fallback preserved; synthetic only')
