// 14 Oct phone run: "Check Singapore flight from Bangalore on 27th October" was answered by general chat with
// generic "typical pricing" prose, never asked how many were travelling or which cabin, and lost the thread
// at "Check for round trip". The flight brief reads the sentence, asks for what is missing in one message,
// remembers the answers, and searches each direction with a complete, bookable-free request.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const t = await import('../lib/agent/travel-research')
const { shouldPreferSpecialistTravel } = await import('../lib/agent/specialist-routing')
const now = new Date('2026-10-14T04:00:00Z')
const tz = 'Asia/Kolkata'

// Recognition: flights plus a route is a flight search, whatever the verb.
for (const s of ['Check Singapore flight from Bangalore on 27th October', 'Flights from Bangalore to Singapore on 27 Oct', 'cheapest flight from bangalore to singapore 27th october', 'any flights bangalore → dubai tomorrow'])
  assert.equal(t.isPublicTravelResearchRequest(s), true, s)
assert.equal(shouldPreferSpecialistTravel('Check Singapore flight from Bangalore on 27th October'), true)
for (const s of ['What is the status of my flight from Bangalore', 'Is flight 6E 123 from Bangalore delayed', 'my flight to Singapore check-in', 'Show my flight tickets'])
  assert.equal(t.isPublicTravelResearchRequest(s), false, s)
assert.equal(shouldPreferSpecialistTravel('flight from Bangalore delayed today'), false)

// 1. The first message, exactly as sent.
const first = t.parseFlightBriefText('Check Singapore flight from Bangalore on 27th October', now, tz)
assert.deepEqual([first.originCode, first.destinationCode, first.departDate], ['BLR', 'SIN', '2026-10-27'])
assert.equal(first.tripType, undefined); assert.equal(first.adults, undefined); assert.equal(first.cabin, undefined)
assert.deepEqual(t.flightBriefSlots(first), ['trip', 'travellers', 'cabin', 'time'])
const ask = t.askFlightBrief(first, t.flightBriefSlots(first))
assert.match(ask, /Bengaluru to Singapore on 27 Oct 2026/)
assert.match(ask, /1\. Trip: one-way, or round trip\?/)
assert.match(ask, /2\. Travellers: how many adults/)
assert.match(ask, /3\. Cabin: economy, premium economy, business or first class\?/)
assert.match(ask, /say go and I'll search 1 adult, economy, one-way/)
assert.doesNotMatch(ask, /SEARCH:|momondo|typical pricing/i)

// 2. "Check for round trip" is an answer to the open question, not a new topic.
assert.equal(t.isFlightBriefAnswer('Check for round trip'), true)
let step = t.applyFlightBriefReply(first, ['trip', 'travellers', 'cabin'], 'Check for round trip', now, tz)
assert.equal(step.understood, true); assert.equal(step.brief.tripType, 'round_trip')
assert.deepEqual(t.flightBriefSlots(step.brief), ['return', 'travellers', 'cabin', 'time'])

// 3. A return earlier than the departure is a question, never a silent guess.
step = t.applyFlightBriefReply(step.brief, ['return', 'travellers', 'cabin'], '27th October to 2nd October back', now, tz)
assert.equal(step.brief.departDate, '2026-10-27'); assert.equal(step.brief.returnDate, undefined)
assert.equal(step.brief.returnSuggestion, '2026-11-02')
assert.deepEqual(t.flightBriefSlots(step.brief), ['return_confirm', 'travellers', 'cabin', 'time'])
assert.match(t.askFlightBrief(step.brief, t.flightBriefSlots(step.brief)), /Did you mean 2 Nov 2026\? Reply yes/)
step = t.applyFlightBriefReply(step.brief, ['return_confirm', 'travellers', 'cabin'], 'yes', now, tz)
assert.equal(step.brief.returnDate, '2026-11-02'); assert.equal(step.brief.returnSuggestion, undefined)

// 4. Travellers and cabin in one line.
step = t.applyFlightBriefReply(step.brief, ['travellers', 'cabin', 'time'], '2 adults, business', now, tz)
assert.deepEqual([step.brief.adults, step.brief.cabin], [2, 'business'])
assert.deepEqual(t.flightBriefSlots(step.brief), ['time'])
assert.match(t.askFlightBrief(step.brief, ['time']), /morning, afternoon, evening, night or any time/)
step = t.applyFlightBriefReply(step.brief, ['time'], 'morning', now, tz)
assert.equal(step.brief.timeOfDay, 'morning')
assert.deepEqual(t.flightBriefSlots(step.brief), [])

// 5. Each direction is a complete search of its own.
const legs = t.flightLegs(step.brief)
assert.equal(legs.length, 2)
assert.equal(legs[0].text, 'Compare flights from BLR to SIN on 2026-10-27 for 2 adults in business, departing in the morning. Research only; do not book or pay.')
assert.equal(legs[1].text, 'Compare flights from SIN to BLR on 2026-11-02 for 2 adults in business, departing in the morning. Research only; do not book or pay.')
for (const leg of legs) assert.equal(t.isPublicTravelResearchRequest(leg.text), true, leg.text)
const legPrefs = t.flightSearchPreferences(legs[0].text)
assert.deepEqual([legPrefs.adults, legPrefs.cabin], [2, 'business'])
assert.match(t.flightSearchStartedText(step.brief), /two results/)
assert.match(t.flightSearchStartedText(step.brief), /never book, pay or enter traveller details/)

// 6. "go" skips the optional questions with stated defaults; a bare number answers travellers.
const defaults = t.applyFlightBriefReply(first, ['trip', 'travellers', 'cabin'], 'go', now, tz)
assert.deepEqual(t.flightBriefSlots(defaults.brief), [])
const one = t.flightLegs(defaults.brief)
assert.equal(one.length, 1)
assert.equal(one[0].text, 'Compare flights from BLR to SIN on 2026-10-27 for 1 adult in economy. Research only; do not book or pay.')
assert.equal(t.applyFlightBriefReply(first, ['travellers', 'cabin'], '3', now, tz).brief.adults, 3)
assert.equal(t.applyFlightBriefReply(first, ['travellers', 'cabin'], 'just me, premium economy', now, tz).brief.cabin, 'premium_economy')

// 7. Everything in one sentence needs no questions at all.
const full = t.parseFlightBriefText('Business class flights Bangalore to Dubai 20 Nov to 27 Nov round trip for 2 adults, evening departure', now, tz)
assert.deepEqual([full.originCode, full.destinationCode, full.departDate, full.returnDate, full.tripType, full.adults, full.cabin], ['BLR', 'DXB', '2026-11-20', '2026-11-27', 'round_trip', 2, 'business'])
assert.equal(full.timeOfDay, 'evening')
assert.deepEqual(t.flightBriefSlots(full), [])

// 8. Time of day: understood in a sentence, an answer, or as "any time"; it filters rows by departure hour.
assert.equal(t.parseFlightBriefText('cheapest flight tomorrow morning from Bangalore to Singapore', now, tz).timeOfDay, 'morning')
assert.equal(t.applyFlightBriefReply(first, ['time'], 'any time', now, tz).brief.timeOfDay, 'any')
assert.equal(t.applyFlightBriefReply(first, ['time'], 'night', now, tz).brief.timeOfDay, 'night')
assert.equal(t.isFlightBriefAnswer('afternoon'), true)
assert.equal(t.flightSearchPreferences(legs[0].text).timeOfDay, 'morning')
assert.equal(t.departureHour('2026-10-27T06:30'), 6)
assert.equal(t.departureHour('11:45 PM on Tue, Oct 27'), 23)
assert.equal(t.departureHour('12:10 AM'), 0)
assert.equal(t.departureHour('no clock'), null)
const sample = [{ departure: '6:30 AM' }, { departure: '1:15 PM' }, { departure: '8:40 PM' }, { departure: '11:55 PM' }]
assert.deepEqual(t.applyTimeOfDay(sample, r => r.departure, 'morning').rows.map(r => r.departure), ['6:30 AM'])
assert.deepEqual(t.applyTimeOfDay(sample, r => r.departure, 'night').rows.map(r => r.departure), ['11:55 PM'])
assert.equal(t.applyTimeOfDay(sample, r => r.departure).rows.length, 4)
const none = t.applyTimeOfDay([{ departure: '1:15 PM' }], r => r.departure, 'morning')
assert.equal(none.rows.length, 1); assert.match(none.note, /No morning departures were found/)
const link = t.googleFlightsSearchUrl({ origin: { code: 'BLR', label: 'Bengaluru' }, destination: { code: 'SIN', label: 'Singapore' }, startDate: '2026-10-27', adults: 2, cabin: 'business' } as any)
assert.match(link, /^https:\/\/www\.google\.com\/travel\/flights\?/)
assert.match(decodeURIComponent(link), /BLR to SIN on 2026-10-27 for 2 adults in business/)

// Missing essentials keep the existing wording.
const noDate = t.parseFlightBriefText('flights from Bangalore to Singapore', now, tz)
assert.deepEqual(t.flightBriefSlots(noDate), ['date'])
assert.equal(t.askFlightBrief(noDate, ['date']), 'Please send the travel date together so I can compare the right flights.')

// Unrelated short messages are not answers.
for (const s of ['remind me at 5pm to call mom', 'what is the weather in Singapore', 'send an email to Rahul']) assert.equal(t.isFlightBriefAnswer(s), false, s)
console.log('✅ flight brief: route + date understood, one question for the rest, round trip searched per direction')
