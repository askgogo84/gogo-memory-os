// Listen button (9 Nov): the plan picks the device voice first, never sends text to the cloud under "on this device
// only", labels partial languages, and estimates length. Pure.
import assert from 'node:assert/strict'
import { planListen, deviceLanguages, detectSpeechLanguage, estimateSeconds, parseVoiceSource } from '../lib/voice/listen'
import { speechText } from '../lib/voice/speech-text'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }

const en = 'Standup with Nithin at 11:30. Call Divya at 6. Your Goa cab is still not booked.'
const hi = 'नमस्ते, आपकी मीटिंग 11:30 बजे है।'
const kn = 'ನಿಮ್ಮ ಸಭೆ 11:30ಕ್ಕೆ ಇದೆ.'
assert.equal(detectSpeechLanguage(en), 'en'); assert.equal(detectSpeechLanguage(hi), 'hi'); assert.equal(detectSpeechLanguage(kn), 'kn')
assert.equal(detectSpeechLanguage('kal meeting hai, aaj nahi'), 'hinglish'); ok('language by script')

const phone = deviceLanguages(['en-IN', 'en-US', 'hi_IN'])
let p = planListen({ text: en, source: 'auto', deviceLangs: phone, cloudAvailable: true })
assert.equal(p.engine, 'browser'); assert.equal((p as any).label, null); ok('auto: English uses the device voice, no label')
p = planListen({ text: hi, source: 'auto', deviceLangs: phone, cloudAvailable: true })
assert.equal(p.engine, 'browser'); assert.equal((p as any).label, 'Hindi · partial'); ok('auto: Hindi on the device, labelled partial')
p = planListen({ text: kn, source: 'auto', deviceLangs: phone, cloudAvailable: true })
assert.equal(p.engine, 'cloud'); assert.equal((p as any).label, 'Kannada · partial'); ok('auto: no Kannada voice on the device → cloud')
p = planListen({ text: kn, source: 'local', deviceLangs: phone, cloudAvailable: true })
assert.equal(p.engine, null); assert.equal((p as any).reason, 'no_device_voice'); assert.match((p as any).message, /No voice on this device for Kannada/); ok('local: Kannada says so instead of using the cloud')
p = planListen({ text: en, source: 'local', deviceLangs: new Set(), cloudAvailable: true })
assert.equal(p.engine, null); ok('local with no device voices never falls back to the cloud')
p = planListen({ text: en, source: 'cloud', deviceLangs: phone, cloudAvailable: true })
assert.equal(p.engine, 'cloud'); ok('cloud: always the AskGogo voice')
p = planListen({ text: en, source: 'auto', deviceLangs: new Set(), cloudAvailable: false })
assert.equal(p.engine, null); assert.equal((p as any).reason, 'no_engine'); ok('nothing available → unavailable, no throw')
assert.equal(planListen({ text: '   ', source: 'auto', deviceLangs: phone, cloudAvailable: true }).engine, null); ok('empty text')

assert.equal(estimateSeconds(en), 6); assert.equal(parseVoiceSource('bogus'), 'auto'); assert.equal(parseVoiceSource('local'), 'local')
assert.equal(speechText('*Done.* See https://app.askgogo.in/x 🎟️'), 'Done. See'); ok('estimate, source parsing, spoken text strips links and emoji')
console.log(`verify-listen-nov9: ${n} passed`)
