import assert from 'node:assert/strict'
import { checkSandboxCatalogue } from './check-cashfree-agentpay-sandbox.mjs'

const key = 'fixture-key'
let requests = 0

function fixture(respond) {
  return async (url, init) => {
    requests++
    assert.equal(url, 'https://sandbox.cashfree.com/agentpay/mcp')
    assert.equal(init.method, 'POST')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.Authorization, `Bearer ${key}`)
    const { id, ...body } = JSON.parse(init.body)
    assert.ok(id)
    assert.deepEqual(body, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'list_biller_categories', arguments: {} },
    })
    return respond(id)
  }
}

const catalogue = { biller_categories: [{ biller_category_name: 'Electricity' }] }
const result = { content: [{ type: 'text', text: JSON.stringify(catalogue) }] }
const json = (id, data) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result: data }))

assert.equal(await checkSandboxCatalogue(key, fixture(id => json(id, result))), 1)
assert.equal(await checkSandboxCatalogue(key, fixture(id => new Response(
  `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`,
  { headers: { 'Content-Type': 'text/event-stream' } },
))), 1)

await assert.rejects(checkSandboxCatalogue('', fixture(() => assert.fail())), /Missing CASHFREE_AGENTPAY_SANDBOX_CLIENT_KEY/)
await assert.rejects(checkSandboxCatalogue(key, fixture(() => new Response(key, { status: 401 }))), error => {
  assert.equal(error.message, 'Cashfree AgentPay sandbox returned HTTP 401')
  return true
})
await assert.rejects(checkSandboxCatalogue(key, fixture(() => json('different-id', result))), /invalid catalogue/)
await assert.rejects(checkSandboxCatalogue(key, fixture(id => json(id, { ...result, isError: true }))), /invalid catalogue/)
await assert.rejects(checkSandboxCatalogue(key, fixture(id => json(id, { structuredContent: { biller_categories: [] } }))), /invalid catalogue/)
await assert.rejects(checkSandboxCatalogue(key, fixture(() => new Response('x'.repeat(300_000)))), /invalid catalogue/)
assert.equal(requests, 7)
console.log('PASS: Cashfree sandbox catalogue binding, JSON and SSE, and fail-closed handling; no provider calls')
