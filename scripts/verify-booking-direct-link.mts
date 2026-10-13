import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 15:26 (his ask, modelled on Instinct): when a booking stops before the cart, send the
// provider's own page so it opens in the person's browser or app, not Gogo's take-control page.
// Also the 15:17 slot check: a venue page as the "list", and a Book Now click that timed out.
// Run: npx tsx scripts/verify-booking-direct-link.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const PB = await import('../lib/agent/provider-booking')

const venue = 'https://playo.co/venues/begur-bengaluru/machaxi-milan-sports-centre-begur-bengaluru'
// Where Gogo stopped, on the same site, path only.
assert.equal(PB.bookingDirectUrl(`${venue}?session=abc#x`, venue), venue)
assert.equal(PB.bookingDirectUrl('https://www.playo.co/venues/a/b', venue), 'https://www.playo.co/venues/a/b')
// Another site, a login/checkout page, or no observation → the approved page.
assert.equal(PB.bookingDirectUrl('https://evil.example/venues/a', venue), venue)
assert.equal(PB.bookingDirectUrl('https://playo.co/login?next=/x', venue), venue)
assert.equal(PB.bookingDirectUrl('https://playo.co/checkout/123', venue), venue)
assert.equal(PB.bookingDirectUrl(null, venue), venue)
assert.equal(PB.bookingDirectUrl(null, 'javascript:alert(1)'), null)
assert.equal(PB.bookingDirectUrl('https://user:pw@playo.co/x', null), null)

const target = PB.bookingTargetFromObjective(PB.bookingObjective({ date: '2026-10-17', time: '7:00 AM', timezone: 'Asia/Kolkata', service: 'badminton court', confirmation: 'x' }))
assert.equal(PB.bookingSlotLine(target), 'Sat 17 Oct · 7:00 AM · Badminton')
assert.equal(PB.bookingSlotLine({}), '')

const robot = PB.bookingReviewMessage({ host: 'playo.co', takeoverUrl: 'https://app.askgogo.in/dashboard/activity/r/browser', directUrl: venue, target, robotCheck: true })
assert.match(robot, /robot check/)
assert.ok(robot.indexOf(venue) > 0 && robot.indexOf(venue) < robot.indexOf('app.askgogo.in'), 'the provider link comes first')
assert.match(robot, /opens in your own browser or the playo app/)
assert.match(robot, /choose Sat 17 Oct · 7:00 AM · Badminton/)
assert.match(robot, /Or let me carry on in my browser/)
assert.match(robot, /nothing is booked yet/)
assert.doesNotMatch(robot, /\d{10}/, 'no phone number')

const account = PB.bookingReviewMessage({ host: 'playo.co', takeoverUrl: 'https://x', directUrl: venue, target, accountCreationRefused: true })
assert.match(account, /started creating a new account instead of logging you in, so I stopped/)
assert.match(account, /Book it yourself here/)
const plain = PB.bookingReviewMessage({ host: 'playo.co', takeoverUrl: 'https://x', directUrl: venue })
assert.match(plain, /pick your slot/)
// Without a direct link the old take-control wording stays.
assert.match(PB.bookingReviewMessage({ host: 'playo.co', takeoverUrl: 'https://x', robotCheck: true }), /tap \*Take control\*, tap Send OTP/)
// Payment still goes to Gogo's browser: the cart lives there.
assert.match(PB.bookingPaymentMessage({ host: 'playo.co', takeoverUrl: 'https://x' }), /same browser I used/)

const cmd = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
assert.match(cmd, /directUrl:bookingDirectUrl\(continuationUrl,params\.command\.url\),target:bookingTargetFromObjective\(params\.command\.objective\)/)
console.log('Booking handover: provider link first, opens in the person\'s own browser')

// Slot check: a venue page is not a list; check the venue pages one by one.
const research = readFileSync(new URL('../lib/agent/appointment-research.ts', import.meta.url), 'utf8')
assert.match(research, /const listing = playo\.find\(o => !isVenuePage\(o\.url\)\) \|\| playo\[0\] \|\| null/)
assert.match(research, /venueUrls \? \{ venueUrls \} : \{\}/)
const slots = readFileSync(new URL('../lib/agent/live-slots.ts', import.meta.url), 'utf8')
assert.match(slots, /req: \{ \.\.\.params\.req, listUrl: direct\[i\] \}, nth: 0, skip: \[\], slot: i/)
// A click that times out on a hidden copy presses the visible control with the same label.
const sc = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
assert.match(sc, /e&&e\.name==='TimeoutError'&&await target\.count\(\)/)
assert.match(sc, /if\(await pressTimedOut\(page,target,e\)\)return;throw e;/)
assert.match(sc, /if\(!await twin\.isVisible\(\)\.catch\(\(\)=>false\)\)continue/)
console.log('Live slots: venue pages checked directly; timed-out clicks retried on the visible control')

// 13 Oct 15:49: a venue card that opens a new tab is followed in Gogo's tab (same site only).
assert.match(sc, /async function clickFollowingNewTab\(page,doClick\)/)
assert.match(sc, /ctx\.on\('page',on\)/)
assert.match(sc, /there===here\|\|there\.endsWith\('\.'\+here\)\|\|here\.endsWith\('\.'\+there\)/)
assert.match(sc, /await clickFollowingNewTab\(page,async\(\)=>\{try\{await option\.click/)
assert.match(sc, /clickFollowingNewTab\(page,\(\)=>page\.mouse\.click\(x,y\)\)/)
console.log('Booking browser: a venue card that opens a new tab is followed in the same tab')
