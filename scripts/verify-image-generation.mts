// Muse case 24 (invite image) and 20 (draft first) — 11 Oct overnight.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { imageRequest, imageRequestRefusal } = await import('../lib/services/image-reply.ts')
for (const t of ['Make an invite image for a birthday party on Sunday at 5 pm at my place.', 'Create a poster for our Diwali sale', 'design a birthday card for Amma', 'Generate a wallpaper of the Western Ghats in monsoon'])
  assert.ok(imageRequest(t), t)
for (const t of ['make me a nutrition card', 'remind me to make an invite tomorrow', 'show my image notes', 'what is a poster session', 'add the party to my calendar'])
  assert.equal(imageRequest(t), null, t)
assert.match(String(imageRequestRefusal('make a picture of me as a superhero')), /real people/)
assert.equal(imageRequestRefusal('Make an invite image for a birthday party'), null)

const svc = readFileSync('lib/services/image-reply.ts', 'utf8')
assert.match(svc, /No real people, no brand logos or trademarked characters/)
assert.match(svc, /createSignedUrl\(path, 3600\)/)

const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
const at = (needle: string) => pm.indexOf(needle)
assert.ok(at('const imageText = imageRequest(incomingText)') > 0 && at('const imageText = imageRequest(incomingText)') < at('const contentWorkflow = selectContentWorkflow(incomingText)'), 'images are claimed before workflows and time routing')
assert.ok(at('const podcast = podcastRequest(incomingText)') < at('const contentWorkflow = selectContentWorkflow(incomingText)'))
assert.ok(at('const unsupported = unsupportedCapability(incomingText)') < at('const contentWorkflow = selectContentWorkflow(incomingText)'))
assert.match(pm, /mediaType: 'image\/png'/)

assert.match(readFileSync('lib/agent/content-workflows.ts', 'utf8'), /Never answer with only questions/, '20: workflow drafts first')

// P1 image private-storage owner guard: exercise the ACTUAL transpiled service with only
// inert OpenAI and storage fakes. No provider, network, real image, user data or DB access.
{
  const tsImport = await import('typescript')
  const ts = tsImport.default ?? tsImport
  const { createRequire } = await import('node:module')
  const nodeRequire = createRequire(import.meta.url)
  const events: string[] = []
  const paths: string[] = []
  class FakeOpenAI {
    images = { generate: async () => {
      events.push('model')
      return { data: [{ b64_json: Buffer.from('synthetic-image-bytes').toString('base64') }] }
    } }
  }
  const storage = { from: (bucket: string) => {
    assert.equal(bucket, 'user-documents')
    return {
      upload: async (path: string, _bytes: unknown, options: any) => {
        assert.equal(options.contentType, 'image/png')
        assert.equal(options.upsert, false)
        events.push('upload')
        paths.push(path)
        return { error: null }
      },
      createSignedUrl: async (path: string, ttl: number) => {
        assert.equal(ttl, 3600)
        events.push('sign')
        return { data: { signedUrl: 'https://fixture.invalid/' + encodeURIComponent(path) }, error: null }
      },
    }
  } }
  const compiled = ts.transpileModule(svc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const cjs: { exports: any } = { exports: {} }
  const inertRequire = (id: string) => {
    if (id === 'openai') return FakeOpenAI
    if (id === '@/lib/supabase-admin') return { supabaseAdmin: { storage } }
    if (id === 'node:crypto') return nodeRequire(id)
    throw Error('Unexpected non-inert import: ' + id)
  }
  const fakeProcess = { env: { OPENAI_API_KEY: 'fixture-only' } }
  new Function('require', 'module', 'exports', 'process', 'Buffer', 'console', compiled)(
    inertRequire, cjs, cjs.exports, fakeProcess, Buffer, console,
  )
  const createImage = cjs.exports.createImage as (owner: unknown, text: string) => Promise<string | null>
  const unsafeOwners: unknown[] = [
    Number('9007199254740993'), -9007199254740992, 0, -0, NaN, Infinity, -Infinity, 1.5,
    '', '0', '-0', '+42', '042', '42 ', '42/../../other', '42\\\\evil', '42\n',
    '9223372036854775808', '-9223372036854775809', null, undefined, true, {}, BigInt(42),
  ]
  for (const owner of unsafeOwners) {
    events.length = 0
    const result = await createImage(owner, 'Synthetic poster for private event')
    assert.equal(result, null, 'invalid image owner MUST NOT receive a signed URL: ' + String(owner))
    assert.deepEqual(events, [], 'invalid owner MUST be denied before model/storage')
  }
  for (const owner of [42, -42, '42', '-42', '9007199254740993', '-9223372036854775808']) {
    events.length = 0
    const prior = paths.length
    const result = await createImage(owner, 'Synthetic invite image')
    assert.match(String(result), /^https:\/\/fixture\.invalid\//)
    assert.equal(paths[prior]?.startsWith(String(owner) + '/images/'), true, 'exact image owner prefix ' + owner)
    assert.deepEqual(events, ['model', 'upload', 'sign'])
  }
  console.log('PASS generated image private owner precision: unsafe/malformed values blocked before model or storage')
}

console.log('Image generation and draft-first workflow checks passed')
