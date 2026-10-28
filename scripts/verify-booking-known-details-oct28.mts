// 28 Oct (owner): booking asked for every detail though Gogo knew his name, mobile and window-seat preference.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
const f = await import('../lib/agent/flight-booking.ts')
assert.equal(f.seatFromPreference(['Prefers window seats']), 'window')
assert.equal(f.seatFromPreference(['I like aisle seats on long flights']), 'aisle')
assert.equal(f.seatFromPreference(['Window cleaner comes Monday']), null, 'only seat preferences count')
const k = { name: 'Divya Rao', email: 'divya.rao@gmail.com', mobile: '9876543210', seat: 'window' as const, seatFromMemory: true }
const text = f.knownDetailsText(k)
assert.match(text, /Divya Rao/); assert.match(text, /••••••3210/); assert.ok(!text.includes('9876543210'), 'mobile masked'); assert.match(text, /you said you prefer window/)
const p = f.parseBookingDetails(`Ms ${k.name}\n${k.email}\n${k.mobile}\npaid window seat`, 1, { domestic: true })
assert.equal(p.problems.length, 0); assert.equal(p.seat, 'window'); assert.equal(p.travellers[0].title, 'Ms')
const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/flight-booking.ts', import.meta.url), 'utf8')
assert.ok(src.includes('known: true }'), 'only a flag is stored, never the details')
console.log('BOOKING_KNOWN_DETAILS_OK')
