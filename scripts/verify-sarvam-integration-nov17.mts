import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sarvamChat, sarvamCostPaise, sarvamEnabled, sarvamPrism } from '../lib/services/sarvam'
import { sarvamSpeechLanguage, sarvamSpeechToText, sarvamTextToSpeech } from '../lib/services/sarvam-voice'

type MockFn = typeof fetch
const response = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
const calls: { url: string; options: RequestInit }[] = []
const fake = (data: unknown, status = 200): MockFn =>
  (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options || {} })
    return response(data, status)
  }) as MockFn
const key = { apiKey: 'test-only-key' }

assert.equal(sarvamEnabled('GOGO_SARVAM_BRAIN', { GOGO_SARVAM_BRAIN: 'on' }), false)
assert.equal(sarvamEnabled('GOGO_SARVAM_BRAIN', { GOGO_SARVAM_BRAIN: 'on', SARVAM_API_KEY: 'test-key' }), true)
assert.equal(sarvamEnabled('GOGO_SARVAM_BRAIN', { GOGO_SARVAM_BRAIN: 'on', SARVAM_API_KEY: 'test-key', VERCEL_ENV: 'production' }), false)
assert.equal(sarvamEnabled('GOGO_SARVAM_BRAIN', { GOGO_SARVAM_BRAIN: 'on', SARVAM_API_KEY: 'test-key', VERCEL_ENV: 'production', GOGO_SARVAM_PRODUCTION: 'approved' }), true)
assert.equal(sarvamCostPaise(1_000_000, 1_000_000), 7500)
assert.equal(sarvamCostPaise(1_000_000, 0, 'sarvam-prism'), 400)
assert.equal(sarvamCostPaise(null, 10), null)
const tools = [{ name: 'handle', description: 'Delegate safely', input_schema: { type: 'object', properties: { instruction: { type: 'string' } } } }]
const data = { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'handle', arguments: JSON.stringify({ instruction: 'read calendar' }) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }
const chat = await sarvamChat({ ...key, messages: [{ role: 'user', content: 'show calendar' }], tools, toolChoice: 'required', fetcher: fake(data) })
assert.equal(chat.tool?.name, 'handle')
assert.deepEqual(chat.tool?.input, { instruction: 'read calendar' })
assert.equal(chat.usage.inputTokens, 100)
assert.equal(chat.usage.outputTokens, 20)
assert.equal(calls.at(-1)?.url, 'https://api.sarvam.ai/v1/chat/completions')
assert.equal((calls.at(-1)?.options.headers as Record<string,string>)['api-subscription-key'], 'test-only-key')
const payload = JSON.parse(String(calls.at(-1)?.options.body))
assert.equal(payload.model, 'sarvam-105b')
assert.equal(payload.tool_choice, 'required')
assert.equal(payload.tools[0].function.name, 'handle')
await assert.rejects(sarvamChat({ ...key, messages: [{ role: 'user', content: 'hi' }], tools, toolChoice: 'required',
  fetcher: fake({ choices: [{ finish_reason: 'stop', message: { content: 'Hi!' } }] }) }), /sarvam_tool_required/)
await assert.rejects(sarvamChat({ ...key, messages: [{ role: 'user', content: 'hi' }], tools,
  fetcher: fake({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [
    { function: { name: 'handle', arguments: '{}' } }, { function: { name: 'handle', arguments: '{}' } },
  ] } }] }) }), /sarvam_multiple_tools/)
await assert.rejects(sarvamChat({ ...key, messages: [{ role: 'user', content: 'hi' }], fetcher: fake({}, 429) }), /sarvam_http_429/)
const questions = { intent: { type: 'choice' as const, instructions: 'Classify', criteria: { chat: 'Chat', read: 'Read' } } }
const decision = await sarvamPrism({ ...key, state: 'Hi', questions, fetcher: fake({
  answers: { intent: { type: 'choice', choice: 'chat', confidence: 0.8, probabilities: { chat: 0.8, read: 0.2 } } },
  usage: { input_tokens: 125 },
}) })
assert.equal(decision.answers.intent.choice, 'chat')
assert.equal(calls.at(-1)?.url, 'https://api.sarvam.ai/v2/systemone')
assert.equal(decision.estimatedCostPaise, 0)
await assert.rejects(sarvamPrism({ ...key, state: 'Hi', questions, fetcher: fake({ answers: {
  intent: { type: 'choice', choice: 'pay_now', confidence: 0.99 },
} }) }), /sarvam_prism_choice_invalid/)
assert.equal(sarvamSpeechLanguage('ನಮಸ್ಕಾರ'), 'kn-IN')
assert.equal(sarvamSpeechLanguage('வணக்கம்'), 'ta-IN')
assert.equal(sarvamSpeechLanguage('नमस्ते'), 'hi-IN')
assert.equal(sarvamSpeechLanguage('Hello'), 'en-IN')
const mp3 = Buffer.from('ID3mock-audio-contents')
const tts = await sarvamTextToSpeech('Namaste', { ...key, model: 'bulbul:v3', fetcher: fake({ audios: [mp3.toString('base64')] }) })
assert.deepEqual(tts, mp3)
assert.equal(calls.at(-1)?.url, 'https://api.sarvam.ai/text-to-speech')
assert.equal(JSON.parse(String(calls.at(-1)?.options.body)).output_audio_codec, 'mp3')
const stt = await sarvamSpeechToText(Buffer.from('fake audio'), 'audio/ogg', { ...key, fetcher: fake({ transcript: 'मेरा नाम गोवर्धन है', language_code: 'hi-IN' }) })
assert.equal(stt.text, 'मेरा नाम गोवर्धन है')
assert.equal(stt.languageCode, 'hi-IN')
assert.equal(calls.at(-1)?.url, 'https://api.sarvam.ai/speech-to-text')
assert.ok(calls.at(-1)?.options.body instanceof FormData)
assert.equal((calls.at(-1)?.options.body as FormData).get('model'), 'saaras:v4')
await assert.rejects(sarvamSpeechToText(Buffer.from('audio'), 'text/html', { ...key }), /sarvam_stt_media_invalid/)
await assert.rejects(sarvamTextToSpeech('a'.repeat(2501), key), /sarvam_tts_text_invalid/)
const brain = readFileSync('lib/agent/brain.ts', 'utf8')
const voice = readFileSync('lib/services/voice-transcription.ts', 'utf8')
const reply = readFileSync('lib/services/voice-reply.ts', 'utf8')
const planner = readFileSync('lib/agent/planner-provider.ts', 'utf8')
assert.match(brain, /sarvamEnabled\('GOGO_SARVAM_BRAIN'\)/)
assert.match(brain, /decisionFromToolUse\(p\.text, res\.tool\.name, res\.tool\.input\)/)
assert.match(brain, /sarvamEnabled\('GOGO_SARVAM_PRISM_SHADOW'\)/)
assert.match(planner, /sarvamEnabled\('GOGO_SARVAM_PLANNER'\)/)
assert.match(voice, /sarvamEnabled\('GOGO_SARVAM_STT'\)/)
assert.match(reply, /sarvamEnabled\('GOGO_SARVAM_TTS'\)/)
console.log('SARVAM_INTEGRATION_OK: mocked chat/tool calls, Prism, STT, TTS, errors, gates, wiring')
