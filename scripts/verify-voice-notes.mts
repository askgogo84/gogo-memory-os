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

console.log('Voice notes and podcasts: intent, speech text, script parsing, storage and delivery wiring passed')
