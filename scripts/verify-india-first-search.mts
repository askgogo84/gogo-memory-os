// India-first searches (10 Oct live runs): "Book a table for 4 at Toit Indiranagar" was read as the
// restaurant "table" and matched a Lithuanian software company; "salon near HSR Layout" found nothing
// because HSR Layout was not known to be in Bengaluru.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { resolveIndiaPlace, resultInPlace } = await import('../lib/agent/india-locality.ts')

const hsr = resolveIndiaPlace('HSR Layout')
assert.equal(hsr.city, 'Bengaluru')
assert.match(hsr.querySuffix, /HSR Layout Bengaluru India/)
assert.equal(resolveIndiaPlace('Andheri').city, 'Mumbai')
assert.equal(resolveIndiaPlace('Banjara Hills').city, 'Hyderabad')
assert.equal(resolveIndiaPlace('Bangalore').querySuffix, 'Bengaluru India')
assert.deepEqual(resolveIndiaPlace(''), { locality: '', city: '', aliases: [], querySuffix: 'India' })
assert.equal(resolveIndiaPlace('', 'Bengaluru').city, 'Bengaluru', 'the home city fills in when no place is named')

assert.equal(resultInPlace('Best salons in HSR Layout, Bangalore - Justdial', hsr), true)
assert.equal(resultInPlace('Top salons in Dubai Marina', hsr), false)
assert.equal(resultInPlace('Salon booking in Koramangala, Bengaluru', hsr), true, 'same city counts')
assert.equal(resultInPlace('Table Reservation System - Tablein.com, Kaunas', resolveIndiaPlace('Toit Indiranagar')), false)
assert.equal(resultInPlace('Any Indian result', resolveIndiaPlace('')), true, 'no place named: India-wide')
assert.equal(resultInPlace('A cafe in London', resolveIndiaPlace('')), false, 'foreign places never pass')

const rr = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
assert.match(rr, /const GENERIC_NAME=\/\^\(\?:a\\s\+\|an\\s\+\|the\\s\+\)\?\(\?:table\|reservation/, 'a generic word is never a restaurant name')
assert.match(rr, /if\(!tokens\.length\|\|hits===0\)return -100/, 'a result must name the restaurant')
assert.match(rr, /India book a table District EazyDiner/, 'restaurant search uses Indian booking sites')
assert.doesNotMatch(rr, /verified release evidence/, 'plain language')

const ar = readFileSync('lib/agent/appointment-research.ts', 'utf8')
assert.match(ar, /resultInPlace\(/, 'appointment results use the India place filter')
assert.match(ar, /Justdial Fresha/, 'salon search uses Indian listings')

console.log('India-first search: place resolution, filters and restaurant/salon queries passed')
{
  const { parseRestaurantReservationIntent } = await import('../lib/agent/restaurant-reservation.ts')
  assert.equal(parseRestaurantReservationIntent('Book a table for 4 at Toit Indiranagar this Friday at 8 pm.')?.restaurant, 'Toit Indiranagar')
  assert.equal(parseRestaurantReservationIntent('book a table at Truffles Koramangala tomorrow at 1 pm')?.restaurant, 'Truffles Koramangala')
  assert.equal(parseRestaurantReservationIntent('Reserve Naru Noodle Bar for 2 next Sunday')?.restaurant, 'Naru Noodle Bar')
  assert.equal(parseRestaurantReservationIntent('Book a table for 4 this Friday')?.restaurant, '', 'no name: Gogo asks which restaurant')
  console.log('Restaurant names parsed')
}
// Muse case 01: a news watch request sets up a standing watch (every 3 hours), not a one-off search.
{
  const { parseWebWatchCommand } = await import('../lib/agent/watch-command.ts')
  const w: any = parseWebWatchCommand('Watch the news on humanoid robots and Indian AI startups. Tell me when something big happens, with sources.')
  assert.equal(w?.query, 'humanoid robots and Indian AI startups news')
  assert.equal(w?.cadenceMinutes, 180)
  for (const t of ['Track Tata Motors news', 'Keep me updated on the RBI repo rate', 'news alerts on UPI credit lines']) assert.ok(parseWebWatchCommand(t), t)
  assert.equal((parseWebWatchCommand('watch the web for Kannada film releases') as any)?.cadenceMinutes, 15, 'other web watches keep their cadence')
  console.log('News watch requests create a standing watch')
}
