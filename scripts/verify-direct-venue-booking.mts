import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 14:16: "book the 7 am slot at Machaxi Milan on Saturday" on its own went to general chat.
// Run: npx tsx scripts/verify-direct-venue-booking.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const F = await import('../lib/agent/appointment-followup')

assert.equal(F.directVenueTarget('book the 7 am slot at Machaxi Milan on Saturday'), 'Machaxi Milan')
assert.equal(F.directVenueTarget('Book the 7am badminton slot at The Majesstine Sports, HSR Layout'), 'Majesstine Sports')
assert.equal(F.directVenueTarget('book a court at machaxi milan for tomorrow 6 pm'), 'machaxi milan')
assert.equal(F.directVenueTarget('book the 7 am slot at 7 am'), null)
assert.equal(F.directVenueTarget('book it'), null)
assert.equal(F.directVenueTarget('remind me at Machaxi Milan'), null, 'only booking requests')
assert.equal(F.wantsFinalApproval('book the 7 am slot at Machaxi Milan on Saturday'), true)

assert.equal(F.venueMatches('Machaxi Milan', 'Machaxi Milan Sports Centre - Begur'), true)
assert.equal(F.venueMatches('Machaxi Milan', 'Machaxi Active Sports Centre'), false, 'a sister venue is not the venue')
assert.equal(F.venueMatches('Majesstine Sports', 'Badminton Venues in Hsr-layout-bengaluru https://playo.co/venues/hsr-layout-bengaluru/sports/badminton'), false, 'a list page is not the venue')

const page = F.pickVenuePage([
  { url: 'https://playo.co/venues/hsr-layout-bengaluru/sports/badminton', title: 'Badminton Venues in HSR Layout' },
  { url: 'https://playo.co/venues/bengaluru/machaxi-active-sports-centre-bengaluru', title: 'Machaxi Active Sports Centre' },
  { url: 'https://playo.co/venues/begur-bengaluru/machaxi-milan-sports-centre-begur-bengaluru?utm=x', title: 'Machaxi Milan Sports Centre - Begur, Bengaluru - Playo' },
], 'Machaxi Milan')
assert.deepEqual(page, { url: 'https://playo.co/venues/begur-bengaluru/machaxi-milan-sports-centre-begur-bengaluru', title: 'Machaxi Milan Sports Centre' })
assert.equal(F.pickVenuePage([{ url: 'https://example.com/machaxi-milan', title: 'Machaxi Milan' }], 'Machaxi Milan'), null, 'only the booking site')

const src = readFileSync(new URL('../lib/agent/appointment-followup.ts', import.meta.url), 'utf8')
assert.ok(src.indexOf('directVenueTarget(params.text)') < src.indexOf('const currentReply = await currentAppointmentReply(tg)'), 'a named venue does not need an earlier search')
assert.match(src, /return createFinalApproval\(\{ actor: params\.actor, prepared, text: params\.text, surface: params\.surface \}\)\n\}/, 'the same approval step (Gogo never books without APPROVE)')

console.log('Direct venue booking: "book the 7 am slot at <venue> on <day>" finds the venue\'s Playo page and asks for approval, without an earlier search')
