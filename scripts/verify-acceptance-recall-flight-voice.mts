import assert from 'node:assert/strict'
import { detectIntent } from '../lib/bot/detect-intent'
import { buildTravelPresenceFacts } from '../lib/agent/context-brain'
import { answerLiveFlightStatus, buildFlightStatusQuery, isFareShoppingResult, answerLeaksFare } from '../lib/bot/handlers/flight-status'
import { mergeSlot, explicitClock } from '../lib/agent/appointment-followup'

// Post-deployment acceptance failures observed in the Sep-30 11:53–11:54 IST WhatsApp turns.
// Helper routing tests (detectIntent alone) missed these because the defects live in the
// EXECUTOR/FORMATTER and the recall DATA PATH, not in intent routing. These exercise those
// layers with the exact screenshot prompts.

// ---------------------------------------------------------------------------
// FAILURE 2 — a live flight-status question must NEVER become flight shopping.
// Screenshot: "Check whether Etihad EY1 ... 28 September 2026 actually landed"
// returned Momondo/Expedia airfare and "fare not verified".
// ---------------------------------------------------------------------------
{
  const prompt = 'Check whether Etihad EY1 from Abu Dhabi to New York on 28 September 2026 actually landed. Give the actual arrival and source if available; otherwise say you could not verify.'

  const intent = detectIntent(prompt)
  assert.equal(intent.type, 'web_search', 'flight-status still routes into the web_search executor')
  assert.equal(intent.meta?.flightStatus, true, 'flight-status is tagged so the executor runs a STATUS lookup, not a generic web search')

  const query = buildFlightStatusQuery(prompt)
  assert.match(query, /EY1/i, 'status query carries the flight number')
  assert.match(query, /flight status/i, 'status query targets operational status')
  assert.doesNotMatch(query, /cheap|book|fare|price/i, 'status query never solicits fares/booking')

  // Airfare / OTA results are recognised as shopping and excluded from a status answer.
  const airfare = [
    { title: 'EY1 Abu Dhabi to New York flights from $520 | Momondo', snippet: 'Compare cheap flights and book EY1. Lowest fares.', url: 'https://www.momondo.com/flights/AUH-JFK' },
    { title: 'Etihad EY1 tickets - Expedia', snippet: 'Book Etihad Airways EY1. Airfare deals from Rs 45,000.', url: 'https://www.expedia.com/etihad-ey1' },
  ]
  for (const r of airfare) assert.ok(isFareShoppingResult(r), `airfare result flagged as shopping: ${r.url}`)

  // With ONLY airfare available, the executor drops it all and says it could not verify —
  // it never reports a fare.
  const shoppingOnly = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => airfare,
    ask: async () => 'Fares for EY1 start around $520 (fare not verified).',
  })
  assert.ok(!answerLeaksFare(shoppingOnly), 'flight-status answer must never contain fare/shopping content')
  assert.match(shoppingOnly, /could(?:n'?t| not) verify/i, 'with only airfare results it reports status could not be verified')

  // Even if the summariser leaks fares from a real tracker page, the output guard suppresses it.
  const tracker = [
    { title: 'EY1 (ETD1) Etihad Airways Flight Tracking - FlightAware', snippet: 'EY1 landed at New York JFK 8:40 AM EDT Sep 28. Scheduled 8:35 AM. Gate A6.', url: 'https://flightaware.com/live/flight/ETD1' },
  ]
  const guarded = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => tracker,
    ask: async () => 'EY1 fares start at $520; book now for the best price.',
  })
  assert.ok(!answerLeaksFare(guarded), 'a fare-leaking summary is suppressed by the output guard')
  assert.match(guarded, /could(?:n'?t| not) verify/i, 'suppressed answer falls back to could-not-verify (no fares)')

  // A clean tracker result produces a real STATUS answer with no fares.
  const statusAnswer = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async (_q, opts) => (opts?.includeDomains?.length ? tracker : []),
    ask: async () => 'EY1 landed at New York JFK at 8:40 AM EDT (scheduled 8:35 AM), gate A6, per FlightAware.',
  })
  assert.ok(!answerLeaksFare(statusAnswer), 'status answer stays fare-free')
  assert.match(statusAnswer, /landed|arriv|jfk/i, 'status answer reports operational status')
}

// ---------------------------------------------------------------------------
// FAILURE 1 — historical recall must surface flight NUMBERS and the saved
// CONFIRMATION reference (PNR), not deny confirmation details it has saved.
// ---------------------------------------------------------------------------
{
  const query = "What flight details do you already have saved for Divya's New York trip on 27-28 September 2026? Use my saved records and distinguish anything uncertain."
  const now = Date.parse('2026-09-30T06:23:00Z') // 11:53 IST, 30 Sep 2026
  const rows = [
    { id: 't1', type: 'flight', booking_group: 'grp1', pnr: 'B8XIQC', from_city: 'Bengaluru', to_city: 'Abu Dhabi', flight_no: 'EY239', airline: 'Etihad',
      depart_at: '2026-09-27T16:34:00Z', arrive_at: '2026-09-27T18:45:00Z', passengers: ['Divya'], raw: { timeNormalizationVersion: 2 } },
    { id: 't2', type: 'flight', booking_group: 'grp1', pnr: 'B8XIQC', from_city: 'Abu Dhabi', to_city: 'New York', flight_no: 'EY1', airline: 'Etihad',
      depart_at: '2026-09-27T22:42:00Z', arrive_at: '2026-09-28T12:35:00Z', passengers: ['Divya'], raw: { timeNormalizationVersion: 2 } },
  ]
  const facts = buildTravelPresenceFacts(rows, now, 60, query)
  const blob = facts.map(f => f.summary).join('\n')
  assert.match(blob, /EY239/, 'recall surfaces the outbound leg flight number')
  assert.match(blob, /EY1\b/, 'recall surfaces the second leg flight number')
  assert.match(blob, /B8XIQC/, 'recall surfaces the saved booking reference (confirmation detail) instead of denying it')
}

// ---------------------------------------------------------------------------
// FAILURE 3 — a voice note that gives a time ("5 pm") must have that time
// PRESERVED across the clarification turn, so a follow-up giving only the date
// is not re-asked for the time.
// ---------------------------------------------------------------------------
{
  const tz = 'Asia/Kolkata'
  assert.equal(explicitClock('book my appointment at 5pm'), '17:00', 'the 5pm from the voice note is extracted')

  // Follow-up supplies only the date; the earlier 5pm is preserved -> a slot resolves.
  const withFallback = mergeSlot('confirm the appointment for 28 September 2035', tz, { time: '17:00', date: '' })
  assert.ok(withFallback.slot, 'slot resolves when the time was captured earlier and the date is given now')
  assert.equal(withFallback.slot?.time, '17:00', 'the previously-extracted 5pm is preserved across turns')
  assert.equal(withFallback.slot?.date, '2035-09-28', 'the new date is applied')

  // The old bug: with no preserved time, the follow-up has no time and would re-ask.
  const noFallback = mergeSlot('confirm the appointment for 28 September 2035', tz, {})
  assert.equal(noFallback.time, null, 'without a preserved time, the time is missing (the reproduced bug)')
  assert.equal(noFallback.slot, null, 'and no slot resolves')

  // When only the date is missing, the time is retained so the reply can echo it and ask
  // ONLY for the date — never re-request the time.
  const onlyDateMissing = mergeSlot('confirm the appointment', tz, { time: '17:00', date: '' })
  assert.equal(onlyDateMissing.slot, null)
  assert.equal(onlyDateMissing.time, '17:00', 'time retained so the clarification can echo it')
  assert.equal(onlyDateMissing.date, null, 'the date is the only missing piece')
}

console.log('✅ acceptance: flight-status never shops, recall surfaces flight numbers + PNR, voice time preserved across turns')
