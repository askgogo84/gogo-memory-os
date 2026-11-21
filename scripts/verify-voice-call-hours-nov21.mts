// 21 Nov (handoff calling gap): nothing stopped an approved call at 11 pm. Outside 9 am–9 pm India time the call to an
// Indian number is not placed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const v: any = await import('../lib/agent/voice-call')
const ist = (hhmm: string) => new Date(`2026-11-21T${hhmm}:00+05:30`)
const IN = '+918310441698'
for (const t of ['09:00', '12:30', '20:59']) assert.equal(v.callingHoursProblem(IN, ist(t), {}), null, t)
for (const [t, clock] of [['08:59', '8:59 am'], ['21:00', '9:00 pm'], ['23:40', '11:40 pm'], ['00:15', '12:15 am']] as const) {
  const m = v.callingHoursProblem(IN, ist(t), {})
  assert.ok(m, t); assert.match(m, new RegExp(`^It's ${clock} in India, so I won't call now`), m); assert.match(m, /between 9 am and 9 pm\. Nothing was called\. Ask me again after 9 am/, m)
}
assert.equal(v.callingHoursProblem('+14155550100', ist('23:40'), {}), null, 'another country: no known local time, not checked')
assert.equal(v.callingHoursProblem('+91 83104 41698', ist('23:40'), {}) !== null, true, 'spaced Indian number is still checked')
assert.equal(v.callingHoursProblem(IN, ist('21:30'), { GOGO_CALL_HOURS: '8-22' }), null)
assert.ok(v.callingHoursProblem(IN, ist('07:30'), { GOGO_CALL_HOURS: '8-22' }))
assert.equal(v.callingHoursProblem(IN, ist('21:30'), { GOGO_CALL_HOURS: 'nonsense' }) !== null, true, 'a bad setting falls back to 9–21')
assert.ok(v.callingHoursProblem(IN, ist('23:30'), { GOGO_CALL_HOURS: '21-9' }), 'an overnight window falls back to 9–21, never to always-open')
assert.equal(v.callingHoursProblem(IN, ist('12:00'), { GOGO_CALL_HOURS: '21-9' }), null, 'fallback still allows daytime')
assert.match(v.callingHoursProblem(IN, ist('23:40'))!, /I only place calls between 9 am and 9 pm/)
console.log('✓ an Indian number is called only between 9 am and 9 pm India time')
const src = readFileSync(new URL('../lib/agent/voice-call.ts', import.meta.url), 'utf8')
const iHours = src.indexOf('const hours = callingHoursProblem(plan.to, new Date())'), iPlace = src.indexOf('const placement = await beginApprovedVoiceCall(')
const iExpiry = src.indexOf("That call plan has expired"), iRedial = src.indexOf('plan.redials += 1')
assert.ok(iHours > iExpiry && iHours > iRedial && iHours < iPlace, 'checked after the approval checks and before any call is placed, for a yes and a redial')
assert.ok(src.slice(iHours, iPlace).includes("if (hours) return { text: hours, handledBy: 'voice-call' }"))
console.log('✓ the check runs before the call is placed, for both a yes and a redial')
