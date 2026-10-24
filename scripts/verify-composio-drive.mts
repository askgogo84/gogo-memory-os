// Google Drive through Composio (stopgap, 24 Oct): proxy calls are Drive-only and come back as fetch Responses.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.COMPOSIO_API_KEY = 'test'
const C = await import('../lib/connectors/composio-gmail.ts')
const calls: any[] = []
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input); calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url.includes('/connected_accounts?')) return new Response(JSON.stringify({ items: [{ id: 'ca_1', status: 'ACTIVE', user_id: 'askgogo--884501501' }] }))
  if (url.includes('/tools/execute/proxy')) return new Response(JSON.stringify({ status: 200, data: { files: [{ id: 'f1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }] } }))
  return new Response('{}', { status: 404 })
}) as any

assert.equal(await C.activeDriveAccount(['6654', '-884501501']), 'ca_1')
const res = await C.composioDriveFetch('ca_1', 'https://www.googleapis.com/drive/v3/files?q=name')
assert.equal(res.status, 200); assert.equal((await res.json()).files[0].id, 'f1')
assert.equal(calls.at(-1).body.endpoint, 'https://www.googleapis.com/drive/v3/files?q=name')
await assert.rejects(() => C.composioDriveFetch('ca_1', 'https://gmail.googleapis.com/gmail/v1/users/me/messages'), /not_allowed/)
const read = readFileSync('lib/agent/google-workspace-read.ts', 'utf8')
assert.match(read, /url\.startsWith\('https:\/\/www\.googleapis\.com\/drive\/v3\/'\)/, 'only Drive URLs use the Composio path')

// Owner-isolation regression: a person's complete international number must not
// authorize another person's Composio account just because their last 9/10 digits match.
// This uses two inert owner IDs and a fake Composio response: no real provider access.
const ownerLookup = read.match(/async function composioDriveFor\([\s\S]*?(?=async function workspaceFetch)/)?.[0]
assert.ok(ownerLookup, 'the production Composio lookup path must be present')
assert.match(ownerLookup, /activeDriveAccount\(\[String\(actor\.legacyTelegramId\)\]\)/,
  'only the persisted actor identity may select a Drive account')
assert.doesNotMatch(ownerLookup, /await\s+o\.idsForWhatsapp\s*\(|\.ilike\s*\(|slice\(-9\)|slice\(-10\)/,
  'never authorize Drive using phone suffixes or generated chat aliases')

const absentForOtherActor = await C.activeDriveAccount(['6654'])
assert.equal(absentForOtherActor, null, 'another owner cannot claim a foreign connected Drive')
const ownIdOnlyRequest = new URL(calls.at(-1).url)
assert.deepEqual(ownIdOnlyRequest.searchParams.getAll('user_ids'), ['askgogo-6654'],
  'Drive connection query must contain only the actual caller identity')
assert.equal(await C.activeDriveAccount(['-884501501']), 'ca_1',
  'the actual persisted connected owner retains Drive access')
console.log('verify-composio-drive: ok')
