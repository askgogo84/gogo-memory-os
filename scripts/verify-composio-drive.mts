// Google Drive through Composio (stopgap, 24 Oct): proxy calls are Drive-only and come back as fetch Responses.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.COMPOSIO_API_KEY = 'test'
const C = await import('../lib/connectors/composio-gmail.ts')
const calls: any[] = []
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input); calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url.includes('/connected_accounts?')) {
    const users = new URL(url).searchParams.getAll('user_ids')
    const items = [
      { id: 'ca_1', status: 'ACTIVE', user_id: 'askgogo--884501501' },
      { id: 'ca_64_a', status: 'ACTIVE', user_id: 'askgogo-9007199254740992' },
      { id: 'ca_64_b', status: 'ACTIVE', user_id: 'askgogo-9007199254740993' },
    ].filter(account => users.includes(account.user_id))
    return new Response(JSON.stringify({ items }))
  }
  if (url.includes('/tools/execute/proxy')) return new Response(JSON.stringify({ status: 200, data: { files: [{ id: 'f1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }] } }))
  return new Response('{}', { status: 404 })
}) as any

assert.equal(await C.activeDriveAccount(['6654', '-884501501']), 'ca_1')

// These two valid persisted signed-64 SQL owner IDs alias if either is routed through Number().
// Execute the actual helper against an inert Composio mock; no provider/account traffic.
const owner64a = '9007199254740992'
const owner64b = '9007199254740993'
assert.equal(Number(owner64a), Number(owner64b), 'control: Number aliases distinct owner strings')
assert.equal(await C.activeDriveAccount([owner64a]), 'ca_64_a')
assert.equal(await C.activeDriveAccount([owner64b]), 'ca_64_b', 'must not read account bound to adjacent owner')
const lastAccountLookup = calls.at(-1).url as string
assert.deepEqual(new URL(lastAccountLookup).searchParams.getAll('user_ids'), ['askgogo-9007199254740993'])

// Reject non-canonical identifiers and already rounded unsafe numeric IDs before egress.
const priorCalls = calls.length
for (const badId of ['0005', '+5', ' 5', '5.0', 'bad', '0', '-0', '9223372036854775808', Number(owner64b)]) {
  assert.equal(await C.activeDriveAccount([badId]), null, String(badId))
}
assert.equal(calls.length, priorCalls, 'invalid owner inputs cannot cause any credential-provider lookup')
const res = await C.composioDriveFetch('ca_1', 'https://www.googleapis.com/drive/v3/files?q=name')
assert.equal(res.status, 200); assert.equal((await res.json()).files[0].id, 'f1')
assert.equal(calls.at(-1).body.endpoint, 'https://www.googleapis.com/drive/v3/files?q=name')
await assert.rejects(() => C.composioDriveFetch('ca_1', 'https://gmail.googleapis.com/gmail/v1/users/me/messages'), /not_allowed/)
const read = readFileSync('lib/agent/google-workspace-read.ts', 'utf8')
assert.match(read, /url\.startsWith\('https:\/\/www\.googleapis\.com\/drive\/v3\/'\)/, 'only Drive URLs use the Composio path')
console.log('verify-composio-drive: ok')
