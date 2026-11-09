// 2 Nov live: "what's scheduled" said "couldn't read your schedules" (scheduled_owner_invalid). WhatsApp owners are
// negative by design (allocateWhatsAppOwnerId → -(2^51 + random)); positive-only owner checks refused every WhatsApp
// user in scheduled list, voice results/reminders, Make saves, flight known details and Drive binary reads.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { allocateWhatsAppOwnerId, exactSessionOwnerId } = await import('../lib/dashboard/owner-identity')
const id = allocateWhatsAppOwnerId()
assert.ok(id < 0 && Number.isSafeInteger(id), 'WhatsApp owners are negative safe integers')
assert.equal(exactSessionOwnerId(id), String(id))
const files = ['lib/agent/scheduled-list.ts', 'lib/agent/voice-call.ts', 'lib/agent/flight-booking.ts', 'lib/agent/google-workspace-drive-binary.ts', 'lib/make/store.ts']
const signed = /^-?[1-9]\d{0,18}$/
assert.ok(signed.test(String(id)) && !signed.test('0') && !signed.test('-0') && !signed.test('00101'))
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  assert.doesNotMatch(src, /\/\^\[1-9\]\\d\{0,18\}\$\//, `${f} still refuses negative (WhatsApp) owners`)
  assert.match(src, /\/\^-\?\[1-9\]\\d\{0,18\}\$\//, `${f} lost its exact-owner check`)
}
assert.doesNotMatch(readFileSync('lib/agent/google-workspace-drive-binary.ts', 'utf8'), /raw<=0\)return token/, 'refreshed Drive tokens must persist for negative owners')
const { isScheduledListQuery } = await import('../lib/agent/scheduled-list')
assert.equal(isScheduledListQuery("what's scheduled"), true)
console.log('✓ owner checks accept negative WhatsApp owners and still refuse zero, padded and malformed ids')
