import assert from 'node:assert/strict'
import { formatFlightTiming } from '../lib/agent/travel-research'
// 15 Oct: live fares came back (₹15,766 IndiGo BLR -> SIN) but showed "2026-11-20T10:20:00 → 2026-11-20T17:40:00".
// Run: npx tsx scripts/verify-flight-times-readable.mts
assert.equal(formatFlightTiming('2026-11-20T10:20:00', '2026-11-20T17:40:00'), '10:20 am → 5:40 pm')
assert.equal(formatFlightTiming('2026-11-20T20:10:00', '2026-11-21T06:35:00'), '8:10 pm → 6:35 am (+1)')
assert.equal(formatFlightTiming('2026-11-20T00:05:00', '2026-11-20T12:00:00'), '12:05 am → 12:00 pm')
assert.equal(formatFlightTiming('10:20', '17:40'), '10:20 → 17:40', 'unknown shapes pass through')
assert.equal(formatFlightTiming(null, null), '')
console.log('verify-flight-times-readable: ok')
