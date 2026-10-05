import assert from 'node:assert/strict'
import {browserHandoffIsLive} from '../lib/agent/browser-handoff-health'

const originalFetch = globalThis.fetch
const observed: string[] = []
const handoff = 'https://sb-example.vercel.run/?token=fixture-only'
try {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    observed.push(String(input))
    return new Response(JSON.stringify({ready: true}), {status: 200})
  }
  assert.equal(await browserHandoffIsLive(handoff), true)
  assert.equal(new URL(observed[0]).pathname, '/health')
  assert.equal(new URL(observed[0]).searchParams.get('token'), 'fixture-only')
  assert.equal(await browserHandoffIsLive('http://sb-example.vercel.run/?token=x'), false)
  assert.equal(await browserHandoffIsLive('https://sb-example.vercel.run.evil.test/?token=x'), false)
  assert.equal(await browserHandoffIsLive('https://example.com/?token=x'), false)
  assert.equal(await browserHandoffIsLive('https://sb-example.vercel.run/'), false)
  assert.equal(observed.length, 1, 'untrusted URLs must never be fetched')

  globalThis.fetch = async () => new Response('sandbox stopped', {status: 410})
  assert.equal(await browserHandoffIsLive(handoff), false, 'stopped sandbox is not actionable')
  globalThis.fetch = async () => { throw new Error('connection refused') }
  assert.equal(await browserHandoffIsLive(handoff), false, 'unreachable sandbox is not actionable')
} finally { globalThis.fetch = originalFetch }
console.log('PASS: live handoff probe and stopped/untrusted sandbox rejection')
