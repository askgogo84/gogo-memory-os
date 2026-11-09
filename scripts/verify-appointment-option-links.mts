// 2 Nov live: "open option 1" right after the salon list said "I could not match option 1 safely". The list shows
// tidied links (31 Oct) while the saved options keep the raw address; the match must survive the tidy, and never
// bind a number to a different page.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { appointmentReplySelects, sameShownLink } = await import('../lib/agent/appointment-followup')

const raw1 = 'https://envi.in/find-us/salon-rajajinagar/?utm_source=google&utm_medium=organic'
const raw2 = 'https://www.google.com/goto?url=CAESABC123token'
const raw4 = 'https://salons.naturals.in/naturals-salon-beauty-salons-rajajinagar-bengaluru-303086/Home'
const reply = `Appointment options · haircut · Rajajinagar at 11 am, Bengaluru

1. Envi Salon in Rajajinagar Orion Mall
Book Appointment Location Address: No 102
Booking/provider page: https://envi.in/find-us/salon-rajajinagar

2. Green Trends in Rajajinagar
Booking/provider page: https://maps.google.com/?q=Green%20Trends%20Rajajinagar

3. Top Hair Cut Services
Booking/provider page:

4. Naturals Salon in Rajajinagar Bengaluru
Booking/provider page: ${raw4}`

assert.equal(appointmentReplySelects(reply, 1, raw1), true, 'tracking parameters and trailing slash tidied away')
assert.equal(appointmentReplySelects(reply, 2, raw2), true, 'a Google goto result shown as a Maps search')
assert.equal(appointmentReplySelects(reply, 4, raw4), true, 'an untouched link still matches exactly')
console.log('✓ "open option N" matches the tidied link shown in the list')

assert.equal(appointmentReplySelects(reply, 1, raw4), false, 'option 1 never binds to option 4’s page')
assert.equal(appointmentReplySelects(reply, 4, raw1), false)
assert.equal(appointmentReplySelects(reply, 3, 'https://www.justdial.com/Bangalore/Salons'), false, 'a blank link binds nothing')
assert.equal(sameShownLink('https://envi.in/find-us/other-branch', raw1), false, 'a different page on the same site is not the same option')
assert.equal(sameShownLink('https://evil.example/find-us/salon-rajajinagar', raw1), false, 'a different host never matches')
assert.equal(sameShownLink('https://maps.google.com/?q=x', raw1), false, 'a Maps link only stands in for a Google goto result')
console.log('✓ the number stays bound to its own page: no cross-option, cross-host or blank matches')
console.log('Appointment option link checks passed')
