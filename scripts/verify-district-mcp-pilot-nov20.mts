/** District MCP guarded pilot: mocked HTTP, no provider requests or booking effects. */
import assert from 'node:assert/strict'
import {
  DISTRICT_MCP_ENDPOINT, DISTRICT_AREAS, DISTRICT_ACTION_RISK,
  DISTRICT_PUBLIC_CAPABILITIES, DistrictMcpReadPilot, DistrictMcpPilotError,
  assertDistrictReadAccess, districtPilotStatus,
} from '../lib/commerce/district-mcp-pilot.ts'
let checks = 0
const eq = (a: unknown, b: unknown) => { assert.deepEqual(a, b); checks++ }
const blocked = async (fn: () => unknown, code: string) => {
  await assert.rejects(Promise.resolve().then(fn), (e: any) =>
    e instanceof DistrictMcpPilotError && e.code === code)
  checks++
}
const denyEnv = {DISTRICT_PARTNER_APPROVED: 'false', DISTRICT_MCP_READ_ENABLED: 'true'}
const enabled = {DISTRICT_PARTNER_APPROVED: 'true', DISTRICT_MCP_READ_ENABLED: 'true'}
const owner = {ownerId: 'owner-a', credential: 'fake-token-only'}
eq(DISTRICT_MCP_ENDPOINT, 'https://mcp-server.district.in/v2/mcp')
eq(DISTRICT_AREAS.length, 6)
eq(DISTRICT_PUBLIC_CAPABILITIES.reduce((n, a) => n + a.capabilities.length, 0), 22)
eq(DISTRICT_ACTION_RISK.act, 'consequential')
eq(DISTRICT_ACTION_RISK.pay, 'payment')
eq(DISTRICT_ACTION_RISK.cancel_payment, 'consequential')
eq(districtPilotStatus(denyEnv), 'awaiting_partner_approval')
const calls: Array<{url: string; method: string; body: any; headers: HeadersInit | undefined; redirect: RequestRedirect | undefined}> = []
const transport: typeof fetch = async (url: any, init?: RequestInit) => {
  const payload = JSON.parse(String(init?.body))
  calls.push({url: String(url), method: payload.method, body: payload, headers: init?.headers, redirect: init?.redirect})
  const result = payload.method === 'initialize'
    ? {protocolVersion: '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'District mock', version: '1'}}
    : payload.method === 'tools/list'
      ? {tools: [
        {name: 'search', inputSchema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}},
        {name: 'execute', inputSchema: {type: 'object', properties: {operation: {type: 'string'}}}},
        {name: 'act', inputSchema: {type: 'object', properties: {action: {type: 'string'}}}},
        {name: 'pay', inputSchema: {type: 'object', properties: {amount: {type: 'number'}}}},
        {name: 'cancel_payment', inputSchema: {type: 'object', properties: {id: {type: 'string'}}}},
      ]}
      : {content: [{type: 'text', text: 'Synthetic movie results'}]}
  return payload.method === 'notifications/initialized'
    ? new Response(null, {status: 202})
    : new Response(JSON.stringify({jsonrpc: '2.0', id: payload.id, result}), {
        status: 200, headers: {'Content-Type': 'application/json', 'Mcp-Session-Id': 'synthetic-session'},
      })
}
await blocked(() => new DistrictMcpReadPilot('owner-a', owner, transport, denyEnv).listSafeTools(), 'partner_approval_required')
eq(calls.length, 0)
await blocked(() => new DistrictMcpReadPilot('owner-b', owner, transport, enabled).listSafeTools(), 'owner_mismatch')
eq(calls.length, 0)
await blocked(() => new DistrictMcpReadPilot('owner-a', null, transport, enabled).listSafeTools(), 'owner_mismatch')
await blocked(() => new DistrictMcpReadPilot('owner-a', {ownerId: 'owner-a', credential: ''}, transport, enabled).listSafeTools(), 'connection_required')
assertDistrictReadAccess('owner-a', owner, enabled); checks++
const pilot = new DistrictMcpReadPilot('owner-a', owner, transport, enabled)
eq((await pilot.listSafeTools()).map(t => t.name), ['search'])
eq(await pilot.search('two seats tomorrow'), [{type: 'text', text: 'Synthetic movie results'}])
eq(calls.map(x => x.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
eq(calls.every(x => x.url === DISTRICT_MCP_ENDPOINT && x.redirect === 'error'), true)
eq(calls[3].body.params, {name: 'search', arguments: {query: 'two seats tomorrow'}})
eq((calls[3].headers as any)['Mcp-Session-Id'], 'synthetic-session')
await blocked(() => pilot.search('a'), 'invalid_response')
await blocked(() => pilot.search('x'.repeat(501)), 'invalid_response')
eq(calls.length, 4)
const incompatible: typeof fetch = async (_url: any, init?: RequestInit) => {
  const p = JSON.parse(String(init?.body))
  const r = p.method === 'initialize' ? {protocolVersion: '2025-06-18'} :
    p.method === 'tools/list' ? {tools: [
      {name: 'search', inputSchema: {
        type: 'object', properties: {operation: {type: 'string'}}, required: ['operation'],
      }},
    ]} : {}
  return p.method === 'notifications/initialized' ? new Response(null, {status: 202}) :
    new Response(JSON.stringify({jsonrpc: '2.0', id: p.id, result: r}), {status: 200})
}
await blocked(() => new DistrictMcpReadPilot('owner-a', owner, incompatible, enabled).search('show movies'), 'tool_not_allowed')
eq(typeof (pilot as any).act, 'undefined')
eq(typeof (pilot as any).pay, 'undefined')
eq(typeof (pilot as any).execute, 'undefined')
eq(typeof (pilot as any).cancel_payment, 'undefined')
console.log('PASS District MCP guarded pilot: ' + checks + ' assertions (mock-only, no provider requests)')