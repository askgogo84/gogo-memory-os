// 8 Nov live: "Ramayana (3D)(Hindi) at 10:00 PM, PVR Orion Mall" got its 2-hours-before reminder at 2:30 PM.
import assert from 'node:assert/strict'
import { clocksIn, reconcileShowTime } from '../lib/agent/show-time'
const TZ = 'Asia/Kolkata'
const ticket = 'Ramayana (3D)(Hindi) (U) Sun, 08 Nov | 10:00 PM PVR: Orion Mall, Dr Rajkumar Road AUDI 05 seats L16'
assert.deepEqual(clocksIn(ticket), [22 * 60])
assert.deepEqual(clocksIn('Show at 22:00').sort(), [22 * 60]); assert.deepEqual(clocksIn('starts 7 pm'), [19 * 60])
// the bug: UTC clock written with an IST offset → 5½ h early; corrected to 22:00 IST
let r = reconcileShowTime('2026-11-08T16:30:00+05:30', ticket, TZ)
assert.equal(r.corrected, true); assert.equal(r.startAt, '2026-11-08T16:30:00.000Z')
// right already: untouched
r = reconcileShowTime('2026-11-08T22:00:00+05:30', ticket, TZ); assert.equal(r.corrected, false); assert.equal(r.startAt, '2026-11-08T22:00:00+05:30')
r = reconcileShowTime('2026-11-08T16:30:00Z', ticket, TZ); assert.equal(r.corrected, false)
// IST clock written as UTC → 5½ h late; corrected the other way
r = reconcileShowTime('2026-11-08T22:00:00Z', ticket, TZ); assert.equal(r.corrected, true); assert.equal(r.startAt, '2026-11-08T16:30:00.000Z')
// no printed clock, or a disagreement that is not an offset error: left alone
assert.equal(reconcileShowTime('2026-11-08T16:30:00+05:30', 'Ramayana tickets', TZ).corrected, false)
assert.equal(reconcileShowTime('2026-11-08T10:00:00+05:30', ticket, TZ).corrected, false)
assert.equal(reconcileShowTime(null, ticket, TZ).startAt, null)
console.log('verify-show-time-nov8: 7 passed')
