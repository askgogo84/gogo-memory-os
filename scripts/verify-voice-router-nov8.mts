// Voice router + echo guard (8 Nov). Licence, privacy, platform, hardware and language gates; phone calls untouched;
// the existing WhatsApp voice-note path unchanged; the echo guard never turns Gogo's own speech into a command.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const v = await import('../lib/voice/providers')
const e = await import('../lib/voice/echo-guard')
const ALL = Object.fromEntries(v.VOICE_CATALOGUE.map(c => [c.id, true]))

// 1. Production never picks a non-commercial or unverified licence, even when it is the only local option.
let r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'dashboard', privacy: 'local_only', commercialUse: true, available: { 'underdog-woof': true } })
assert.equal(r.ok, false); if (!r.ok) { assert.ok(r.rejected.some(x => x.id === 'underdog-woof' && x.reason === 'licence')); assert.match(r.detail, /cloud is off by your privacy setting/) }
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'whatsapp', privacy: 'local_preferred', commercialUse: true, available: ALL })
assert.ok(r.ok); if (r.ok) { assert.equal(r.chosen.id, 'openai-tts', 'piper unverified voices → not used; cloud is the cleared server engine'); assert.ok(r.rejected.some(x => x.id === 'piper' && x.reason === 'licence')) }
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'dashboard', privacy: 'local_preferred', commercialUse: false, available: ALL })
assert.ok(r.ok && ['kokoro-82m', 'browser-speech', 'underdog-woof'].includes(r.chosen.id), 'research harness may consider Woof')
console.log('✓ licence: Woof (non-commercial) and Piper (unverified voices) never chosen for production')

// 2. local_only never selects a cloud engine; local_preferred prefers local and falls back to cloud.
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'dashboard', privacy: 'local_only', commercialUse: true, available: ALL })
assert.ok(r.ok); if (r.ok) { assert.notEqual(r.chosen.runtime, 'cloud'); assert.ok(r.fallbacks.every(f => f.runtime !== 'cloud'), 'no cloud even as fallback'); assert.ok(r.rejected.some(x => x.id === 'openai-tts' && x.reason === 'privacy')) }
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'dashboard', privacy: 'local_preferred', commercialUse: true, available: { 'openai-tts': true, 'kokoro-82m': true } })
assert.ok(r.ok); if (r.ok) { assert.equal(r.chosen.id, 'kokoro-82m'); assert.equal(r.fallbacks[0].id, 'openai-tts') }
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'dashboard', privacy: 'local_preferred', commercialUse: true, available: { 'openai-tts': true } })
assert.ok(r.ok && r.chosen.id === 'openai-tts', 'no local engine cached → cloud, because the setting permits it')
console.log('✓ privacy: local-only never reaches the cloud; local-preferred falls back only when allowed')

// 3. Languages: nothing claimed beyond the source. Kannada has no local engine; Hindi local is partial (opt-in only).
r = v.routeVoice({ kind: 'tts', language: 'kn', platform: 'dashboard', privacy: 'local_only', commercialUse: true, available: ALL })
assert.equal(r.ok, false); if (!r.ok) assert.ok(r.rejected.filter(x => x.reason === 'language').map(x => x.id).includes('kokoro-82m'))
r = v.routeVoice({ kind: 'tts', language: 'hi', platform: 'dashboard', privacy: 'local_preferred', commercialUse: true, available: ALL })
assert.ok(r.ok && r.chosen.id === 'openai-tts', 'Hindi: local engines are partial → not chosen unless allowPartial')
r = v.routeVoice({ kind: 'tts', language: 'hi', platform: 'dashboard', privacy: 'local_preferred', commercialUse: true, allowPartial: true, available: ALL })
assert.ok(r.ok && r.chosen.runtime === 'browser')
for (const c of v.VOICE_CATALOGUE) if (c.runtime !== 'cloud') assert.ok(!c.languages.kn, `${c.id} must not claim Kannada`)
assert.equal(v.VOICE_CATALOGUE.find(c => c.id === 'underdog-woof')!.languages.hi, undefined, 'Woof is English only')
console.log('✓ languages: Kannada not claimed locally; partial Hindi only by opt-in')

// 4. Hardware and platform gates; phone calls are never re-routed.
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'android', privacy: 'local_only', commercialUse: true, hardware: { memoryMb: 1024 }, available: ALL })
assert.equal(r.ok, false, 'no device-runtime engine yet; browser engines are not offered on the native app')
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'dashboard', privacy: 'local_preferred', commercialUse: true, hardware: { memoryMb: 1024 }, available: { 'kokoro-82m': true, 'openai-tts': true } })
assert.ok(r.ok && r.chosen.id === 'openai-tts'); if (r.ok) assert.ok(r.rejected.some(x => x.id === 'kokoro-82m' && x.reason === 'hardware'), 'low-memory device: Kokoro skipped')
r = v.routeVoice({ kind: 'tts', language: 'en', platform: 'phone_call', privacy: 'cloud_ok', commercialUse: true, available: ALL })
assert.deepEqual([r.ok, !r.ok && r.reason], [false, 'telephony_unchanged'])
r = v.routeVoice({ kind: 'stt', language: 'en', platform: 'whatsapp', privacy: 'cloud_ok', commercialUse: true, available: ALL })
assert.ok(r.ok && r.chosen.id === 'openai-whisper')
assert.equal(v.voiceRouterEnabled({}), false, 'flag off by default')
console.log('✓ hardware and platform gates; phone calls stay on telephony; STT routes to Whisper; flag off')

// 5. The working WhatsApp voice-note path is untouched by this PR.
const vr = readFileSync('lib/services/voice-reply.ts', 'utf8')
assert.match(vr, /export async function createVoiceNote\(/); assert.match(vr, /gpt-4o-mini-tts/); assert.ok(!/lib\/voice\/providers/.test(vr))
console.log('✓ createVoiceNote and Whisper unchanged')

// 6. Echo guard: own speech, its tail and repeats are never commands; a real new request is.
let s = e.newEchoGuard(); const t0 = 1_000_000
s = e.startedSpeaking(s, 'Done. I will remind Mathew tomorrow at 8 am about the Starbucks meeting.', 4000, t0)
assert.deepEqual([e.acceptTranscript(s, 'remind Mathew tomorrow', t0 + 2000).accept], [false])
assert.equal((e.acceptTranscript(s, 'remind Mathew tomorrow', t0 + 4500) as any).reason, 'speaking', 'tail after playback')
assert.equal((e.acceptTranscript(s, 'I will remind Mathew tomorrow at 8 am', t0 + 6000) as any).reason, 'echo', 'late echo of its own words')
s = e.stoppedSpeaking(s, t0 + 1000) // barge-in stop
let d = e.acceptTranscript(s, "what's the weather in Goa", t0 + 2000)
assert.equal(d.accept, true, 'a different request right after a stop is accepted'); s = d.state
assert.equal((e.acceptTranscript(s, "What's the weather in Goa?", t0 + 3000) as any).reason, 'duplicate', 'one utterance → one request')
assert.equal(e.acceptTranscript(s, "what's the weather in Goa", t0 + 9000).accept, true, 'asked again later → accepted')
assert.equal((e.acceptTranscript(s, '   ', t0 + 9000) as any).reason, 'empty')
assert.ok(e.overlap('remind mathew', 'I will remind Mathew tomorrow') === 1 && e.overlap('weather goa', 'remind Mathew') === 0)
assert.deepEqual(e.MIC_CONSTRAINTS.audio.echoCancellation, true)
console.log('✓ echo guard: speaking, tail, late echo, duplicate and empty refused; new requests and barge-in accepted')
console.log('Voice router (8 Nov) checks passed')
