// 27 Oct (owner): booking asks for title, name, ticket email + mobile and the seat choice, and can then fill the
// airline's passenger page with exactly those approved values.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const b = await import('../lib/agent/flight-booking.ts')
const ok = b.parseBookingDetails('Ms Divya Rao\ndivya.rao@gmail.com\n98765 43210\npaid window seat', 1, { domestic: true })
assert.deepEqual(ok.problems, [])
assert.deepEqual(ok.travellers, [{ name: 'Divya Rao', title: 'Ms', gender: 'Female' }])
assert.deepEqual(ok.contact, { email: 'divya.rao@gmail.com', mobile: '9876543210' }); assert.equal(ok.seat, 'window')
const two = b.parseBookingDetails('Mr Nithin Kumar\nMs Divya Rao\nEmail: nithin@x.in\nMobile: +91 9876543210\nfree seat', 2, { domestic: true })
assert.deepEqual(two.problems, []); assert.equal(two.travellers[0].gender, 'Male'); assert.equal(two.seat, 'free')
const missing = b.parseBookingDetails('Divya Rao', 1, { domestic: true })
assert.ok(missing.problems.some(p => /Mr, Ms or Mrs/.test(p)) && missing.problems.includes('the email for the ticket') && missing.problems.includes('the seat choice'))
const intl = b.parseBookingDetails('Ms Divya Rao, 12 Mar 1990\ndivya@x.in\n9876543210\nauto seat', 1, { domestic: false, now: new Date('2026-10-27') })
assert.deepEqual(intl.travellers, [{ name: 'Divya Rao', dob: '12 Mar 1990', title: 'Ms', gender: 'Female' }])
const obj = b.flightBookingObjective({ context: { origin: { code: 'BLR' }, destination: { code: 'MAA' }, startDate: '2026-11-16', adults: 1, cabin: 'economy' }, option: { airline: 'IndiGo', departure: '7:10 AM', fareInr: 3892 } as any, travellers: ok.travellers, contact: ok.contact, seat: 'window' })
assert.match(obj, /title Ms, gender Female, full name Divya Rao/); assert.match(obj, /email divya\.rao@gmail\.com/)
assert.match(obj, /fill_phone/); assert.ok(!obj.includes('9876543210'), 'the mobile never goes into the model-visible objective')
assert.match(obj, /cheapest available window seat/); assert.match(obj, /Decline every other paid add-on/); assert.match(obj, /never log in or create an account/)
assert.match(b.flightBookingObjective({ context: { origin: { code: 'BLR' }, destination: { code: 'MAA' }, startDate: '2026-11-16' }, option: { airline: 'IndiGo', departure: '7:10 AM', fareInr: 3892 } as any, travellers: ok.travellers, contact: ok.contact, seat: 'free' }), /never choose a paid seat/)
assert.equal(b.seatLabel('aisle'), 'Paid aisle seat (cheapest available)')

const { flightPassengerFillIndex } = await import('../lib/agent/secure-computer.ts')
const page = { controls: [{ selector: '#fn', label: 'First Name', type: 'text' }, { selector: '#ln', label: 'Last Name', type: 'text' }, { selector: '#em', label: 'Email', type: 'email' }, { selector: '#login', label: 'Login' }] }
assert.equal(flightPassengerFillIndex([{ kind: 'fill', selector: '#fn', value: 'Divya' }, { kind: 'fill', selector: '#ln', value: 'Rao' }, { kind: 'fill', selector: '#em', value: 'divya.rao@gmail.com' }] as any, page, obj), -1, 'approved values pass')
assert.equal(flightPassengerFillIndex([{ kind: 'fill', selector: '#em', value: 'someone@else.com' }] as any, page, obj), 0, 'an unapproved email is refused')
assert.equal(flightPassengerFillIndex([{ kind: 'click', selector: '#login' }] as any, page, obj), 0, 'login is refused')
assert.equal(flightPassengerFillIndex([{ kind: 'fill', selector: '#em', value: 'divya.rao@gmail.com' }] as any, { controls: [...page.controls, { selector: '#pw', type: 'password', label: 'Password' }] }, obj), 0, 'never on a page with a password field')
const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
assert.ok(src.includes('approvedMobile||indianMobileFromWhatsApp'), 'the approved ticket mobile is the booking phone')
console.log('BOOKING_DETAILS_OK')
