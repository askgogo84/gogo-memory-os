// Cheap inference wiring (24 Oct, owner: "always the cheaper or free solution, reliable and fast").
import assert from 'node:assert/strict'
import { cheapComplete, cheapProviders } from '../lib/inference/cheap.ts'

const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`) } }
const realFetch = globalThis.fetch
function stub(handler: (url: string, body: any) => Response) { const calls: string[] = []; (globalThis as any).fetch = async (url: any, init: any) => { calls.push(String(url)); return handler(String(url), JSON.parse(init?.body || '{}')) }; return calls }
const groqOk = () => new Response(JSON.stringify({ choices: [{ message: { content: 'from groq' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }), { headers: { 'content-type': 'application/json' } })
const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] }), { headers: { 'content-type': 'application/json' } })
const env = { GROQ_API_KEY: 'test-groq', GEMINI_API_KEY: 'test-gemini' }

await check('no keys configured: returns null so callers use Claude', async () => {
  assert.equal(await cheapComplete({ taskClass: 'public_web_research', prompt: 'x', scanText: 'best scooters', providers: cheapProviders({}) }), null)
})
await check('Groq answers first for public research', async () => {
  const calls = stub(url => url.includes('groq') ? groqOk() : geminiOk())
  assert.equal(await cheapComplete({ taskClass: 'public_web_research', prompt: 'summarise', scanText: 'best scooters', providers: cheapProviders(env) }), 'from groq')
  assert.equal(calls.length, 1); assert.match(calls[0], /api\.groq\.com/)
})
await check('a rate-limited Groq falls to Gemini, never a second Groq key', async () => {
  const calls = stub(url => url.includes('groq') ? new Response('{}', { status: 429 }) : geminiOk())
  assert.equal(await cheapComplete({ taskClass: 'public_web_research', prompt: 'summarise', scanText: 'best scooters', providers: cheapProviders(env) }), 'from gemini')
  assert.equal(calls.filter(c => c.includes('groq')).length, 1)
})
await check('personal data in the ask is refused before any call', async () => {
  const calls = stub(() => groqOk())
  assert.equal(await cheapComplete({ taskClass: 'public_web_research', prompt: 'x', scanText: 'research divya@example.com', providers: cheapProviders(env) }), null)
  assert.equal(calls.length, 0)
})
await check('owner drafts never go to a tier that trains on inputs', async () => {
  const calls = stub(url => url.includes('groq') ? new Response('{}', { status: 500 }) : geminiOk())
  assert.equal(await cheapComplete({ taskClass: 'make_draft_nonpersonal', prompt: 'draft', scanText: 'a product launch blurb', providers: cheapProviders(env) }), null)
  assert.ok(!calls.some(c => c.includes('googleapis')))
})
await check('personal classes are refused outright', async () => {
  const calls = stub(() => groqOk())
  assert.equal(await cheapComplete({ taskClass: 'gmail' as any, prompt: 'x', scanText: 'inbox', providers: cheapProviders(env) }), null)
  assert.equal(calls.length, 0)
})
globalThis.fetch = realFetch
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('cheap inference: all checks passed')
