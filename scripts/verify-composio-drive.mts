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
console.log('verify-composio-drive: ok')
