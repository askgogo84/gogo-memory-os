// 21 Nov: five Sarvam switches (dialogue, web answer, planner, speech-to-text, text-to-speech) and the Prism shadow were
// global: "on" meant every user. They now also need the person being served to be listed in GOGO_SARVAM_USERS.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const gate: any = await import('../lib/services/sarvam-gate')
const meter: any = await import('../lib/metering/core')
const base: any = await import('../lib/services/sarvam')

const OWNER = '-9000000001', OTHER = '9000000002'
const on = (flag: string, extra: Record<string, string> = {}) => ({ [flag]: 'on', SARVAM_API_KEY: 'test-key', VERCEL_ENV: 'production', GOGO_SARVAM_PRODUCTION: 'approved', ...extra })
const GLOBAL = ['GOGO_SARVAM_DIALOGUE', 'GOGO_SARVAM_WEB_ANSWER', 'GOGO_SARVAM_PLANNER', 'GOGO_SARVAM_STT', 'GOGO_SARVAM_TTS', 'GOGO_SARVAM_PRISM_SHADOW']

for (const flag of GLOBAL) {
  // Switch on, everything approved, but nobody listed: off for everyone, known or not.
  for (const who of [OWNER, OTHER, null, undefined, '']) assert.equal(gate.sarvamEnabled(flag, on(flag), who), false, `${flag} with no list, who=${who}`)
  // Listed person only.
  const env = on(flag, { GOGO_SARVAM_USERS: ` ${OWNER} , 918884500000 ` })
  assert.equal(gate.sarvamEnabled(flag, env, OWNER), true, flag)
  assert.equal(gate.sarvamEnabled(flag, env, OTHER), false, `${flag}: another user`)
  assert.equal(gate.sarvamEnabled(flag, env, null), false, `${flag}: unknown person fails closed`)
  // The list never widens the base gate: no key, switch off, or production not approved are all still off.
  assert.equal(gate.sarvamEnabled(flag, { ...env, SARVAM_API_KEY: '' }, OWNER), false)
  assert.equal(gate.sarvamEnabled(flag, { ...env, [flag]: 'off' }, OWNER), false)
  assert.equal(gate.sarvamEnabled(flag, { ...env, GOGO_SARVAM_PRODUCTION: '' }, OWNER), false)
  // No wildcard, and a near-miss id is not a match.
  for (const list of ['*', 'all', 'true', `${OWNER}0`, OWNER.slice(1), `x${OWNER}`]) assert.equal(gate.sarvamEnabled(flag, on(flag, { GOGO_SARVAM_USERS: list }), OWNER), false, `${flag} list=${list}`)
}
assert.deepEqual([...gate.sarvamAllowlist({ GOGO_SARVAM_USERS: '*, all, -884500000, abc, 12, e1772fea-760b-4ead-889c-55121fad8dd8' })], ['-884500000', 'e1772fea-760b-4ead-889c-55121fad8dd8'])
// Ids are compared as text: a 64-bit id beyond Number's safe range is matched exactly, never rounded.
assert.equal(gate.sarvamEnabled('GOGO_SARVAM_STT', on('GOGO_SARVAM_STT', { GOGO_SARVAM_USERS: '9007199254740993' }), '9007199254740993'), true)
assert.equal(gate.sarvamEnabled('GOGO_SARVAM_STT', on('GOGO_SARVAM_STT', { GOGO_SARVAM_USERS: '9007199254740993' }), '9007199254740992'), false)
assert.equal(gate.sarvamEnabled('GOGO_SARVAM_STT', on('GOGO_SARVAM_STT', { GOGO_SARVAM_USERS: '9007199254740993' }), 9007199254740992), false)
console.log('✓ the five global switches and the Prism shadow reach only listed people; no list means nobody')

// The person comes from the metering context each surface already sets, and each request sees only its own.
{ const flag = 'GOGO_SARVAM_DIALOGUE', env = on(flag, { GOGO_SARVAM_USERS: OWNER })
  assert.equal(gate.sarvamEnabled(flag, env), false, 'outside any request nobody is served')
  assert.equal(meter.runMeteredAs(OWNER, () => gate.sarvamEnabled(flag, env), 'whatsapp'), true)
  assert.equal(meter.runMeteredAs(OTHER, () => gate.sarvamEnabled(flag, env), 'whatsapp'), false)
  const [a, b] = await Promise.all([meter.runMeteredAs(OWNER, async () => { await new Promise(r => setTimeout(r, 15)); return gate.sarvamEnabled(flag, env) }), meter.runMeteredAs(OTHER, async () => { await new Promise(r => setTimeout(r, 5)); return gate.sarvamEnabled(flag, env) })])
  assert.deepEqual([a, b], [true, false], 'concurrent requests do not see each other')
}
console.log('✓ the person served is read from the request, and concurrent requests stay separate')

// The brain switch keeps its own owner canary and the base gate, exactly as before.
assert.equal(gate.sarvamEnabled('GOGO_SARVAM_BRAIN', on('GOGO_SARVAM_BRAIN'), null), true)
assert.equal(gate.sarvamEnabled('GOGO_SARVAM_BRAIN', { GOGO_SARVAM_BRAIN: 'on', SARVAM_API_KEY: 'k', VERCEL_ENV: 'production' }, OWNER), false)
for (const env of [{}, { GOGO_SARVAM_BRAIN: 'on' }, on('GOGO_SARVAM_BRAIN'), { GOGO_SARVAM_BRAIN: 'on', SARVAM_API_KEY: 'k' }, { GOGO_SARVAM_BRAIN: 'on', SARVAM_API_KEY: 'k', VERCEL_ENV: 'production' }])
  assert.equal(gate.sarvamBaseEnabled('GOGO_SARVAM_BRAIN', env as any), base.sarvamEnabled('GOGO_SARVAM_BRAIN', env as any), JSON.stringify(env))
const brain = readFileSync(new URL('../lib/agent/brain.ts', import.meta.url), 'utf8')
assert.match(brain, /if \(!brainEnabledFor\(p\.phone\) \|\| isExactCommand\(p\.text\)\) return null/, 'the brain owner canary still runs first')
console.log('✓ the brain switch is unchanged: its own owner canary plus the base gate')

// Every call site uses the one shared gate; no private copy can drift.
for (const [file, from] of [['lib/agent/brain.ts', '../services/sarvam-gate'], ['lib/agent/planner-provider.ts', '../services/sarvam-gate'], ['lib/services/claude.ts', './sarvam-gate'], ['lib/services/voice-reply.ts', './sarvam-gate'], ['lib/services/voice-transcription.ts', './sarvam-gate'], ['lib/services/whisper.ts', './sarvam-gate']] as const) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.ok(src.includes(`import { sarvamEnabled } from '${from}'`), `${file} imports the shared gate`)
  assert.ok(!/const sarvamEnabled\s*=/.test(src), `${file} has no private gate`)
  assert.ok(!/env\.GOGO_SARVAM_PRODUCTION/.test(src), `${file} does not re-implement the production check`)
}
// Every provider call in the app sits behind that gate.
const { execSync } = await import('node:child_process')
const callers = execSync(`grep -rlE "sarvam(Chat|PrismIntentShadow|Prism|TextToSpeech|SpeechToText)\\(" lib app --include=*.ts || true`, { cwd: new URL('..', import.meta.url).pathname }).toString().trim().split('\n').filter(f => f && !/lib\/services\/sarvam(-voice)?\.ts$/.test(f))
for (const f of callers) assert.match(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /sarvam-gate'/, `${f} calls Sarvam and must import the gate`)
assert.ok(callers.length >= 5, callers.join())
console.log('✓ six call sites share one gate, and every file that calls Sarvam imports it')
