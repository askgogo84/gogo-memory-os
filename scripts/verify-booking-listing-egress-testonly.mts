// Independent test-only regression for booking listing enrichment egress policy.
// Runs shipped functions with inert in-process fetch spies: NO real network, DNS,
// credentials, provider access, user data, reservations, or external effects.
// Separate from the ReserveGo provider-URL tests in PR #1107.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectBookingOptions,
  enrichOffersFromListings,
  offerFrom,
  type BookingOption,
} from '../lib/agent/booking-engine'

let pass = 0
let fail = 0
async function check(name: string, action: () => void | Promise<void>) {
  try {
    await action()
    pass++
    console.log('PASS ' + name)
  } catch (error) {
    fail++
    console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}

const PUBLIC_URL = 'https://www.zomato.com/bangalore/toit-indiranagar'
const publicOptions = () => collectBookingOptions([{ url: PUBLIC_URL, title: 'Toit Indiranagar' }], [])

await check('positive: collector accepts recognized public listing and rejects private/search URL tricks', () => {
  const options = publicOptions()
  assert.equal(options.length, 1)
  assert.equal(options[0].platform.id, 'zomato')
  const privateSearchOptions = collectBookingOptions([
    { url: 'https://127.0.0.1/admin', title: 'fake venue' },
    { url: 'https://169.254.169.254/latest/meta-data', title: 'metadata' },
    { url: 'https://zomato.com@127.0.0.1/admin', title: 'userinfo impersonation' },
  ], [])
  assert.deepEqual(privateSearchOptions, [], 'search collector only admits recognized aggregator hostnames')
})

await check('positive: safe whitelisted listing can supply an offer from inert HTML fixture', async () => {
  const attempted: string[] = []
  const fake = (async (target: string | URL | Request) => {
    attempted.push(String(target))
    return new Response('<html><main>Flat 20% off on your bill</main></html>', { status: 200 })
  }) as typeof fetch
  const got = await enrichOffersFromListings(publicOptions(), fake)
  assert.deepEqual(attempted, [PUBLIC_URL])
  assert.equal(got[0].offer?.percent, 20)
})

await check('positive: known snippet offer needs no listing fetch', async () => {
  const options = publicOptions()
  options[0] = { ...options[0], offer: offerFrom('Flat 25% off') }
  const attempted: string[] = []
  const fake = (async (target: string | URL | Request) => {
    attempted.push(String(target))
    throw new Error('should not fetch an already-known offer')
  }) as typeof fetch
  const got = await enrichOffersFromListings(options, fake)
  assert.deepEqual(attempted, [])
  assert.equal(got[0].offer?.percent, 25)
})

await check('positive: the shipped restaurant comparison invokes this listing enrichment after collector', () => {
  const source = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
  assert.match(source, /engine\.collectBookingOptions\(/)
  assert.match(source, /engine\.enrichOffersFromListings\(options\)/)
})

await check('SAFETY: a plaintext HTTP aggregator listing is rejected before server request', async () => {
  const options = collectBookingOptions([
    { url: 'http://www.zomato.com/bangalore/toit-indiranagar', title: 'Toit Indiranagar' },
  ], [])
  assert.equal(options.length, 1, 'normal collector admits the candidate; guard must be at egress')
  const attempted: string[] = []
  const fake = (async (target: string | URL | Request) => {
    attempted.push(String(target))
    return new Response('no offer', { status: 200 })
  }) as typeof fetch
  await enrichOffersFromListings(options, fake)
  assert.deepEqual(attempted, [], 'never send an unsecured plain-HTTP listing from the application server')
})

await check('SAFETY: a private destination in a fabricated BookingOption fails closed at egress boundary', async () => {
  // Defense in depth: the normal search collector rejects this URL, but the
  // public enrichment API accepts a BookingOption[] without revalidating origin.
  const privateOption: BookingOption = {
    ...publicOptions()[0], url: 'https://169.254.169.254/latest/meta-data', offer: null,
  }
  const attempted: string[] = []
  const fake = (async (target: string | URL | Request) => {
    attempted.push(String(target))
    return new Response('no offer', { status: 200 })
  }) as typeof fetch
  await enrichOffersFromListings([privateOption], fake)
  assert.deepEqual(attempted, [], 'private/link-local endpoint must not reach the fetch transport')
})

await check('SAFETY: a public listing redirect cannot automatically follow an unvalidated private hop', async () => {
  const modes: Array<RequestRedirect | undefined> = []
  const hypotheticalPrivateHops: string[] = []
  const fake = (async (_target: string | URL | Request, init?: RequestInit) => {
    modes.push(init?.redirect)
    // Simulated behavior ONLY. This fake never issues a second fetch/network call.
    if (init?.redirect !== 'manual' && init?.redirect !== 'error') {
      hypotheticalPrivateHops.push('https://127.0.0.1/private')
    }
    return new Response('', {
      status: 302,
      headers: { location: 'https://127.0.0.1/private' },
    })
  }) as typeof fetch
  const got = await enrichOffersFromListings(publicOptions(), fake)
  assert.equal(modes.length, 1)
  assert.equal(got[0].offer, null)
  assert.deepEqual(hypotheticalPrivateHops, [], 'never auto-follow redirects to private destinations')
  assert.ok(modes[0] === 'manual' || modes[0] === 'error', 'redirect mode must not be follow')
})

console.log(`Booking listing egress synthetic results: ${pass} pass, ${fail} expected-RED safety failures`)
if (fail) process.exitCode = 1
