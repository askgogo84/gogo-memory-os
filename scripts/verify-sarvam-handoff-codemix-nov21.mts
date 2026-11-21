// 21 Nov integration check (preview, synthetic): (1) the Sarvam brain handed Indian-language requests on untranslated while
// Gogo's handlers read English; (2) default speech-to-text heard "AskGogo" as "आज गो", codemix got it right.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const brain: any = await import('../lib/agent/brain')
const N: string = brain.SARVAM_HANDOFF_NOTE
for (const must of ["Gogo's handlers read English", 'write the instruction in English and set keep_original false', 'Keep every name, number, date, time and amount exactly', `keep every "not", "don't" and "never"`, 'When the message is in English, follow the rules above unchanged'])
  assert.ok(N.includes(must), must)
const src = readFileSync(new URL('../lib/agent/brain.ts', import.meta.url), 'utf8')
const branch = src.slice(src.indexOf("sarvamEnabled('GOGO_SARVAM_BRAIN')"), src.indexOf("SARVAM_BRAIN_FALLBACK"))
assert.match(branch, /content: `\$\{BRAIN_SYSTEM\(p\.ctx, p\.now \|\| new Date\(\)\)\}\\n\\n\$\{SARVAM_HANDOFF_NOTE\}`/, 'the note is added to the Sarvam branch only')
assert.equal((src.match(/SARVAM_HANDOFF_NOTE/g) || []).length, 2, 'defined once, used once: the Anthropic path is unchanged')
// The negation guard still returns the person's own words, whatever language the instruction is written in.
const d = brain.decisionFromToolUse("Don't book the hotel, just compare", 'handle', { instruction: 'Book the hotel', keep_original: false })
assert.deepEqual([d.kind, d.instruction, d.rewritten], ['handle', "Don't book the hotel, just compare", false])
const e = brain.decisionFromToolUse('मुझे कल सुबह 9 बजे पानी पीने की याद दिलाना', 'handle', { instruction: 'Remind me to drink water tomorrow at 9 am', keep_original: false })
assert.deepEqual([e.kind, e.instruction, e.rewritten], ['handle', 'Remind me to drink water tomorrow at 9 am', true], 'an English rewrite of a Hindi request is accepted')
const c = brain.decisionFromToolUse('मुझे याद दिलाना', 'handle', { instruction: 'Remind me and approve the payment', keep_original: false })
assert.equal(c.instruction, 'मुझे याद दिलाना', 'a rewrite may never add consent words')
console.log('✓ the Sarvam brain is told to hand off in English; consent and negation guards still apply')
for (const [f, call] of [['lib/services/whisper.ts', "sarvamSpeechToText(fileBuffer, 'audio/ogg', { mode: 'codemix' })"], ['lib/services/voice-transcription.ts', "sarvamSpeechToText(arrayBuffer, contentType, { mode: 'codemix' })"]] as const)
  assert.ok(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').includes(call), f)
console.log('✓ Sarvam speech-to-text uses codemix on both voice paths')
