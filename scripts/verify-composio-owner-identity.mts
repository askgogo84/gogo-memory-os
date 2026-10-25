// P1 Composio owner binding: synthetic-only, no provider/account calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.COMPOSIO_API_KEY = 'synthetic-ci-key'
process.env.COMPOSIO_GOOGLEDRIVE_AUTH_CONFIG_ID = 'synthetic-auth-config'
const C = await import('../lib/connectors/composio-gmail.ts')

const ownerA = '9007199254740992'
const ownerB = '9007199254740993'
assert.equal(Number(ownerA), Number(ownerB), 'baseline: JS Number aliases adjacent 64-bit IDs')
assert.notEqual(C.composioUserId(ownerA), C.composioUserId(ownerB), 'string IDs must never alias')
assert.equal(C.composioUserId(ownerB), 'askgogo-' + ownerB)
assert.equal(C.composioUserId('-884501501'), 'askgogo--884501501', 'existing negative WhatsApp identities retain exact meaning')
assert.equal(C.composioUserId(884501501), 'askgogo-884501501', 'safe numeric identities remain supported')
for (const bad of [Number(ownerB), Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
  assert.throws(() => C.composioUserId(bad), /composio_owner_id_unsafe_number/, 'unsafe numeric identity must fail closed')
}
for (const bad of ['0', '0001', '+884501501', '884501501 ', '1e3', '9223372036854775808', '-9223372036854775809', '', 'abc']) {
  assert.throws(() => C.composioUserId(bad), /composio_owner_id_invalid/, 'non-canonical or out-of-range persisted IDs are rejected')
}

let fetchCount = 0
const accountQueries: string[][] = []
const linkBodies: any[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCount++
  const u = new URL(String(input))
  assert.equal(u.origin, 'https://backend.composio.dev', 'fixture rejects requests to other hosts')
  if (u.pathname.endsWith('/connected_accounts')) {
    accountQueries.push(u.searchParams.getAll('user_ids'))
    return Response.json({items: [{id:'ca_owner_B',status:'ACTIVE',is_disabled:false,user_id:C.composioUserId(ownerB)}]})
  }
  if (u.pathname.endsWith('/connected_accounts/link')) {
    linkBodies.push(JSON.parse(String(init?.body || '{}')))
    return Response.json({redirect_url:'https://synthetic-oauth.example/connect'})
  }
  throw new Error('fixture_undocumented_provider_call')
}) as typeof fetch

try {
  assert.equal(await C.activeDriveAccount([ownerA]), null, 'other owner account must not be selected')
  assert.deepEqual(accountQueries.at(-1), ['askgogo-' + ownerA])
  assert.equal(await C.activeDriveAccount([ownerB]), 'ca_owner_B', 'exact owner may select their own active Drive')
  assert.deepEqual(accountQueries.at(-1), ['askgogo-' + ownerB])
  assert.equal(await C.activeDriveAccount([ownerA,ownerB]), 'ca_owner_B', 'explicit different IDs remain distinct query values')
  assert.deepEqual(accountQueries.at(-1), ['askgogo-' + ownerA, 'askgogo-' + ownerB])

  const before = fetchCount
  await assert.rejects(() => C.activeDriveAccount([Number(ownerB)]), /composio_owner_id_unsafe_number/)
  assert.equal(fetchCount, before, 'unsafe numeric owner must not contact the provider')
  assert.equal(await C.createDriveConnectLink(ownerB), 'https://synthetic-oauth.example/connect')
  assert.equal(linkBodies.at(-1).user_id, 'askgogo-' + ownerB, 'Drive OAuth link binds exact session owner')

  const route = readFileSync('app/api/connect/google-drive/route.ts', 'utf8')
  assert.match(route, /createDriveConnectLink\(session\.telegramId\)/, 'server session ID must stay exact')
  assert.doesNotMatch(route, /createDriveConnectLink\(Number\(/, 'do not round exact session IDs')
} finally {
  globalThis.fetch = originalFetch
}
console.log('composio owner ID isolation regression passed')
