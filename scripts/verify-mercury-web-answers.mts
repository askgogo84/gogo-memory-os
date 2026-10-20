// Mercury (Inception Labs) as the fast web-answer model: on only with INCEPTION_API_KEY, never
// throws, falls back to Claude on any failure, and keeps the same safety prompt.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const m = await import('../lib/services/mercury.ts')

assert.equal(m.mercuryWebAnswersEnabled({}), false)
assert.equal(m.mercuryWebAnswersEnabled({ INCEPTION_API_KEY: 'k' }), true)
assert.equal(m.mercuryWebAnswersEnabled({ INCEPTION_API_KEY: 'k', MERCURY_WEB_ANSWERS: '0' }), false)
console.log('PASS enabled only with a key; MERCURY_WEB_ANSWERS=0 turns it off')

delete process.env.INCEPTION_API_KEY
assert.equal(await m.askMercury('hi', { fetchImpl: (async () => { throw new Error('must not call') }) as any }), null)
process.env.INCEPTION_API_KEY = 'test-key'
let seen: any = null
const ok = await m.askMercury('Q', { fetchImpl: (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { content: ' Petrol is ₹102.92/litre. ' } }] }), { status: 200 }) }) as any })
assert.equal(ok?.text, 'Petrol is ₹102.92/litre.')
assert.equal(seen.url, 'https://api.inceptionlabs.ai/v1/chat/completions')
assert.equal(seen.init.headers.authorization, 'Bearer test-key')
assert.equal(JSON.parse(seen.init.body).model, 'mercury-3')
console.log('PASS calls the OpenAI-compatible endpoint with the key and model')

assert.equal(await m.askMercury('Q', { fetchImpl: (async () => new Response('bad model', { status: 400 })) as any }), null)
assert.equal(await m.askMercury('Q', { fetchImpl: (async () => { throw new Error('network') }) as any }), null)
assert.equal(await m.askMercury('Q', { fetchImpl: (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as any }), null)
const slow = await m.askMercury('Q', { timeoutMs: 50, fetchImpl: ((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any })
assert.equal(slow, null)
console.log('PASS error, network failure, empty reply and timeout all return null (Claude fallback)')

const src = readFileSync(new URL('../lib/services/claude.ts', import.meta.url), 'utf8')
const fn = src.slice(src.indexOf('export async function askClaudeWithContext('))
const mi = fn.indexOf('askMercury(prompt'), ci = fn.indexOf("model: 'claude-sonnet-4-5'")
assert.ok(mi > 0 && ci > mi, 'Mercury runs before Claude, inside the web-answer function')
assert.ok(fn.indexOf('never say you booked') < mi, 'Mercury gets the same safety prompt')
assert.match(fn.slice(mi, ci), /stripSearchPreamble\(fast\.text\)/)
console.log('PASS wiring: same prompt, Mercury first, Claude fallback')
console.log('MERCURY_OK 4/4')
