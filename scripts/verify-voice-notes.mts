// Muse cases 12 and 13 (11 Oct): "reply as a voice note" returned a text "Voice Note Transcript" and
// no audio. Voice notes and two-voice podcasts are now real MP3s sent through WhatsApp.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { wantsVoiceReply, podcastRequest, speechText, parsePodcastScript } = await import('../lib/services/voice-reply.ts')
for (const t of ['Research the best electric scooters under 1.5 lakh and reply as a voice note.', 'send it as audio', 'explain SIPs in a voice message', 'Tell me about today in a voice note']) assert.equal(wantsVoiceReply(t), true, t)
for (const t of ['I sent you a voice note yesterday', 'transcribe this voice note', 'what is a voice note']) assert.equal(wantsVoiceReply(t), false, t)

assert.deepEqual(podcastRequest('Make a 5-minute two-voice podcast debating UPI credit lines.'), { topic: 'UPI credit lines', minutes: 5 })
assert.equal(podcastRequest('Make a 30 minute podcast about EVs')?.minutes, 5, 'capped at 5 minutes')
assert.equal(podcastRequest('I listened to a podcast about EVs'), null)

assert.equal(speechText('*Top pick:* Ather Rizta https://ather.in 🚀\n- Range 123 km'), 'Top pick: Ather Rizta \nRange 123 km'.replace(' \n', ' \n'))
assert.ok(speechText('x'.repeat(5000)).length <= 3500)

const script = parsePodcastScript('Here you go: [{"speaker":"A","text":"UPI credit is *great*"},{"speaker":"B","text":"Not so fast"},{"speaker":"C","text":"Odd"},{"speaker":"A","text":""}]')
assert.deepEqual(script.map((l) => l.speaker), ['A', 'B', 'A'])
assert.equal(script[0].text, 'UPI credit is great')
assert.deepEqual(parsePodcastScript('no json here'), [])

const svc = readFileSync('lib/services/voice-reply.ts', 'utf8')
assert.match(svc, /createSignedUrl\(path, 3600\)/, 'audio links expire')
assert.match(svc, /from\(BUCKET\)\.upload\(path, audio, \{ contentType: 'audio\/mpeg'/)
const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
assert.match(pm, /if \(wantsVoiceReply\(incomingText\) &&/)
assert.match(pm, /I couldn't create the voice note this time/, 'a failed voice note is said plainly')
const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(route, /startsWith\('audio\/'\)\) \{\s*\/\/ WhatsApp does not show a caption on audio/)


// OWNER-PRECISION REGRESSION: execute the ACTUAL voice service under inert provider/storage
// adapters. No OpenAI/Anthropic/provider, Supabase, Twilio or network requests occur.
{
  const tsImport = await import('typescript')
  const ts = tsImport.default ?? tsImport
  const { createRequire } = await import('node:module')
  const nodeRequire = createRequire(import.meta.url)
  const events: string[] = []
  const storedPaths: string[] = []
  class FakeOpenAI {
    audio = { speech: { create: async () => {
      events.push('tts')
      return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
    } } }
  }
  class FakeAnthropic {
    messages = { create: async () => {
      events.push('script')
      return { content: [{ type: 'text', text: JSON.stringify([
        { speaker: 'A', text: 'Synthetic first segment' },
        { speaker: 'B', text: 'Synthetic second segment' },
      ]) }] }
    } }
  }
  const storage = { from: (bucket: string) => {
    assert.equal(bucket, 'user-documents')
    return {
      upload: async (path: string, _bytes: unknown, options: any) => {
        assert.equal(options.contentType, 'audio/mpeg')
        events.push('upload')
        storedPaths.push(path)
        return { error: null }
      },
      createSignedUrl: async (path: string, seconds: number) => {
        assert.equal(seconds, 3600)
        events.push('sign')
        return { data: { signedUrl: 'https://fixture.invalid/' + encodeURIComponent(path) }, error: null }
      },
    }
  } }
  const serviceJs = ts.transpileModule(svc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const cjs: { exports: any } = { exports: {} }
  const inertRequire = (id: string) => {
    if (id === 'openai') return FakeOpenAI
    if (id === '@anthropic-ai/sdk') return FakeAnthropic
    if (id === '@/lib/supabase-admin') return { supabaseAdmin: { storage } }
    if (id === 'node:crypto') return nodeRequire(id)
    throw Error('Unexpected non-inert module: ' + id)
  }
  const fakeProcess = { env: { OPENAI_API_KEY: 'synthetic-only', ANTHROPIC_API_KEY: 'synthetic-only' } }
  new Function('require', 'module', 'exports', 'process', 'Buffer', 'console', serviceJs)(
    inertRequire, cjs, cjs.exports, fakeProcess, Buffer, console,
  )
  const service = cjs.exports as {
    createVoiceNote: (owner: unknown, text: string) => Promise<string | null>,
    createPodcast: (owner: unknown, topic: string, minutes: number) => Promise<{script: unknown[], url: string | null}>,
  }
  const unsafeOwners: unknown[] = [
    Number('9007199254740993'), -9007199254740992, 0, -0, NaN, Infinity, -Infinity, 1.5,
    '', '0', '-0', '+42', '042', '42 ', '42/../../owner', '42\\foo', '42\n',
    '9223372036854775808', '-9223372036854775809',
    null, undefined, true, {}, 42n,
  ]
  for (const owner of unsafeOwners) {
    events.length = 0
    const note = await service.createVoiceNote(owner, 'Synthetic audio about a calendar item')
    assert.equal(note, null, 'invalid owner MUST not mint voice note ' + String(owner))
    assert.deepEqual(events, [], 'invalid note owner MUST be denied before model/storage')
    const episode = await service.createPodcast(owner, 'Synthetic personal topic', 1)
    assert.deepEqual(episode, { script: [], url: null }, 'invalid podcast owner ' + String(owner))
    assert.deepEqual(events, [], 'invalid podcast owner MUST be denied before model/storage')
  }
  for (const owner of [42, -42, '42', '-42', '9007199254740993', '-9223372036854775808']) {
    events.length = 0
    const expected = String(owner) + '/voice-replies/'
    const before = storedPaths.length
    const note = await service.createVoiceNote(owner, 'Synthetic voice note')
    assert.match(String(note), /^https:\/\/fixture\.invalid\//)
    assert.equal(storedPaths[before]?.startsWith(expected), true, 'voice asset owner prefix exact ' + owner)
    assert.deepEqual(events, ['tts', 'upload', 'sign'])
    events.length = 0
    const podcast = await service.createPodcast(owner, 'Synthetic podcast', 1)
    assert.equal(podcast.script.length, 2)
    assert.equal(storedPaths[before + 1]?.startsWith(expected), true, 'podcast asset owner prefix exact ' + owner)
    assert.deepEqual(events, ['script', 'tts', 'tts', 'upload', 'sign'])
    assert.match(String(podcast.url), /^https:\/\/fixture\.invalid\//)
  }
  console.log('PASS voice/podcast owner isolation: unsafe 64-bit/malformed owners fail before provider/storage; exact canonical IDs preserved')
}

console.log('Voice notes and podcasts: intent, speech text, script parsing, storage and delivery wiring passed')
