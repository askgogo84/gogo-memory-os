/** Zomato MCP pre-authorization checks: fixtures only; never call the provider. */
import assert from 'node:assert/strict'
import {
  ZOMATO_MCP_ENDPOINT, ZOMATO_PUBLISHED_CAPABILITIES, ZomatoMcpCataloguePilot,
  ZomatoMcpPilotError, assertZomatoCatalogueAccess, zomatoPilotStatus,
} from '../lib/commerce/zomato-mcp-pilot.ts'
let count = 0
const eq = (a: unknown, b: unknown) => { assert.deepEqual(a, b); count++ }
const blocked = async (run: () => unknown, code: string) => {
  await assert.rejects(Promise.resolve().then(run), (e: any) => e instanceof ZomatoMcpPilotError && e.code === code)
  count++
}
const enabled = {ZOMATO_PARTNER_APPROVED: 'true', ZOMATO_OAUTH_CLIENT_APPROVED: 'true', ZOMATO_MCP_CATALOGUE_ENABLED: 'true'}
const denied = {...enabled, ZOMATO_PARTNER_APPROVED: 'false'}
const noOauth = {...enabled, ZOMATO_OAUTH_CLIENT_APPROVED: 'false'}
const noOperator = {...enabled, ZOMATO_MCP_CATALOGUE_ENABLED: 'false'}
const connection = {ownerId: 'owner-1', credential: 'fake-token'}
eq(ZOMATO_MCP_ENDPOINT, 'https://mcp-server.zomato.com/mcp')
eq(ZOMATO_PUBLISHED_CAPABILITIES.includes('food_ordering'), true)
eq(zomatoPilotStatus(denied), 'awaiting_partner_approval')
eq(zomatoPilotStatus(enabled), 'approved_catalogue_pilot')
const calls: Array<{url: string; body: any; init: RequestInit | undefined}> = []
const mock: typeof fetch = async (url: any, init?: RequestInit) => {
  const p = JSON.parse(String(init?.body))
  calls.push({url: String(url), body: p, init})
  if (p.method === 'notifications/initialized') return new Response(null, {status: 202})
  const result = p.method === 'initialize'
    ? {protocolVersion: '2025-06-18', capabilities: {tools: {}}}
    : {tools: [{name: 'search_restaurants', description: 'mock catalogue'},
      {name: 'place_order', description: 'must not execute'}, {name: 'create_cart'}]}
  return new Response(JSON.stringify({jsonrpc: '2.0', id: p.id, result}), {
    status: 200, headers: {'content-type': 'application/json', 'mcp-session-id': 'mock-session'},
  })
}
for (const env of [denied, noOauth, noOperator])
  await blocked(() => new ZomatoMcpCataloguePilot('owner-1', connection, mock, env).listUnreviewedTools(), 'partner_approval_required')
eq(calls.length, 0)
await blocked(() => new ZomatoMcpCataloguePilot('owner-2', connection, mock, enabled).listUnreviewedTools(), 'owner_mismatch')
eq(calls.length, 0)
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', null, mock, enabled).listUnreviewedTools(), 'owner_mismatch')
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', {ownerId: 'owner-1', credential: ''}, mock, enabled).listUnreviewedTools(), 'connection_required')
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', {ownerId: 'owner-1', credential: 'abc\r\nB: C'}, mock, enabled).listUnreviewedTools(), 'connection_required')
assertZomatoCatalogueAccess('owner-1', connection, enabled); count++
const pilot = new ZomatoMcpCataloguePilot('owner-1', connection, mock, enabled)
const tools = await pilot.listUnreviewedTools()
eq(tools.map(t => t.name), ['search_restaurants', 'place_order', 'create_cart'])
eq(tools.every(t => t.verification === 'unreviewed'), true)
eq(calls.map(c => c.body.method), ['initialize', 'notifications/initialized', 'tools/list'])
eq(calls.every(c => c.url === ZOMATO_MCP_ENDPOINT && c.init?.redirect === 'error'), true)
eq((calls[2].init?.headers as Record<string,string>)['Mcp-Session-Id'], 'mock-session')
eq(typeof (pilot as any).callTool, 'undefined')
eq(typeof (pilot as any).placeOrder, 'undefined')
eq(typeof (pilot as any).pay, 'undefined')
eq(typeof (pilot as any).createCart, 'undefined')
const unauth: typeof fetch = async () => new Response(null, {status: 401})
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', connection, unauth, enabled).listUnreviewedTools(), 'reauth_required')
const badBody: typeof fetch = async () => new Response('not json', {headers: {'content-type': 'application/json'}})
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', connection, badBody, enabled).listUnreviewedTools(), 'invalid_response')
const badContent: typeof fetch = async () => new Response('fine', {headers: {'content-type': 'text/html'}})
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', connection, badContent, enabled).listUnreviewedTools(), 'invalid_response')
const network: typeof fetch = async () => { throw new Error('offline') }
await blocked(() => new ZomatoMcpCataloguePilot('owner-1', connection, network, enabled).listUnreviewedTools(), 'provider_unavailable')
console.log(`PASS Zomato MCP partner-locked catalogue: ${count} assertions (mock-only; no provider calls)`)
