import assert from 'node:assert/strict'
import { detectIntent } from '../lib/bot/detect-intent'
import { buildTravelPresenceFacts } from '../lib/agent/context-brain'
import { answerLiveFlightStatus, buildFlightStatusQuery, isFareShoppingResult, answerLeaksFare, matchesRequestedOccurrence, normalizeNumericDates } from '../lib/bot/handlers/flight-status'
import { mergeSlot, explicitClock, capturedSlotHints, isSlotOnlyReply } from '../lib/agent/appointment-followup'

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
  assert.doesNotMatch(query, /cheap|book |fare|price/i, 'status query never solicits fares/booking')
  // "on 28 September" must not be misread as an airline code (Codex P2).
  assert.doesNotMatch(query, /\bon28\b/i, 'a date preposition is not extracted as a flight code')

  // Airfare / OTA results are recognised as shopping and excluded from a status answer.
  const airfare = [
    { title: 'EY1 Abu Dhabi to New York flights from $520 | Momondo', snippet: 'Compare cheap flights and book EY1. Lowest fares.', url: 'https://www.momondo.com/flights/AUH-JFK' },
    { title: 'Etihad EY1 tickets - Expedia', snippet: 'Book Etihad Airways EY1. Airfare deals from Rs 45,000.', url: 'https://www.expedia.com/etihad-ey1' },
  ]
  for (const r of airfare) assert.ok(isFareShoppingResult(r), `airfare result flagged as shopping: ${r.url}`)

  // The output guard must catch multi-digit fare amounts and standalone booking language
  // (Codex P2: the old regex ended in \d\b and missed "$520").
  for (const leak of ['EY1 tickets cost $520; book now', 'Fares from Rs 45,000', 'book now for the best price', 'lowest price ₹4999']) {
    assert.ok(answerLeaksFare(leak), `fare/shopping text must be caught by the guard: "${leak}"`)
  }
  assert.ok(!answerLeaksFare('EY1 landed at JFK at 8:40 AM EDT, gate A6, per FlightAware.'), 'a clean status line is not flagged as fare')

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

  // Occurrence validation (Codex P1): a recurring EY1 on the WRONG date must be rejected, and a
  // different flight number must not satisfy the request.
  const wrongDate = { title: 'EY1 Etihad Flight Status - FlightAware', snippet: 'EY1 landed at JFK on 27 September 2026 at 9:10 AM.', url: 'https://flightaware.com/live/flight/ETD1/history/20260927' }
  const wrongFlight = { title: 'EY11 Etihad Flight Status', snippet: 'EY11 en route, scheduled 28 September 2026.', url: 'https://flightaware.com/live/flight/ETD11' }
  assert.ok(!matchesRequestedOccurrence(wrongDate, prompt), 'a wrong-date EY1 result is rejected')
  assert.ok(!matchesRequestedOccurrence(wrongFlight, prompt), 'a different flight number is rejected')
  assert.ok(matchesRequestedOccurrence(tracker[0], prompt), 'the correct EY1 / 28 Sep result is accepted')

  // With only wrong-occurrence tracker hits, the executor must NOT report another day's status.
  const wrongOnly = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => [wrongDate],
    ask: async () => 'EY1 landed on 27 September at 9:10 AM.',
  })
  assert.match(wrongOnly, /could(?:n'?t| not) verify/i, 'wrong-date results do not become a status answer')

  // Numeric dates must be preserved so occurrence validation still catches the wrong day (P1).
  const numericPrompt = 'Did EY1 land on 9/28/2026?'
  assert.match(buildFlightStatusQuery(numericPrompt), /2026-09-28/, 'numeric date is normalised into the query')
  assert.ok(!matchesRequestedOccurrence(wrongDate, numericPrompt), 'numeric-dated request still rejects a 27 Sep result')
  assert.ok(matchesRequestedOccurrence(tracker[0], numericPrompt), 'numeric-dated request accepts the matching 28 Sep result')

  // Landing claims must be grounded in the retrieved context, not just the prompt (P1). Here the
  // context is only a schedule; a model that still says "landed" must be suppressed.
  const scheduleOnly = [{ title: 'EY1 Etihad - FlightStats', snippet: 'EY1 scheduled to arrive JFK 8:35 AM on 28 September 2026.', url: 'https://www.flightstats.com/v2/flight-tracker/EY/1' }]
  const ungrounded = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => scheduleOnly,
    ask: async () => 'EY1 landed at JFK at 8:40 AM.',
  })
  assert.match(ungrounded, /could(?:n'?t| not) verify/i, 'a landing claim with no arrival evidence in context is suppressed')

  // Grounding applies to EVERY definitive state, not just arrival (P1): a "cancelled" claim with
  // no cancellation evidence in context is suppressed too.
  const cancelledClaim = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => scheduleOnly,
    ask: async () => 'EY1 was cancelled.',
  })
  assert.match(cancelledClaim, /could(?:n'?t| not) verify/i, 'an ungrounded cancelled/delayed/diverted claim is suppressed')

  // A dateless result must not satisfy an explicitly-dated request (P1) — but a live "today"
  // query, which carries no calendar token, still accepts a dateless tracker page.
  const datelessEy1 = { title: 'EY1 Etihad Flight Status - FlightAware', snippet: 'EY1 Abu Dhabi to New York. Track live.', url: 'https://flightaware.com/live/flight/ETD1' }
  assert.ok(!matchesRequestedOccurrence(datelessEy1, prompt), 'a dateless result does not satisfy an explicitly dated request')
  assert.ok(matchesRequestedOccurrence(datelessEy1, 'is EY1 on time today?'), 'a live/today query still accepts a dateless tracker page')

  // "on time" needs an ACTUAL punctuality signal — a schedule-only context must not ground it.
  const onTimeUngrounded = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => scheduleOnly,
    ask: async () => 'EY1 is on time.',
  })
  assert.match(onTimeUngrounded, /could(?:n'?t| not) verify/i, 'an on-time claim with only a published schedule is suppressed')

  // Ambiguous numeric dates follow India day-first; unambiguous ones (part >12) stay correct.
  assert.match(normalizeNumericDates('Did EY1 land on 9/10/2026?'), /2026-10-09/, 'ambiguous 9/10 -> 9 October (day-first)')
  assert.match(normalizeNumericDates('Did EY1 land on 9/28/2026?'), /2026-09-28/, 'unambiguous 9/28 -> 28 September')
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

  // The shared capture helper used by BOTH prepare paths (primary + recovery) must lift the
  // original request's time so the recovery path is not left without a fallback (Codex P1).
  const hints = capturedSlotHints('book my appointment at 5pm', tz)
  assert.equal(hints.requestedTime, '17:00', 'both prepare paths capture the original 5pm')

  // But a range/boundary/opening-hours time must NOT become an exact fallback (Codex P2),
  // otherwise a later date-only confirmation books a time the user never chose.
  assert.equal(capturedSlotHints('find dentist appointments after 5pm', tz).requestedTime, '', 'a boundary time ("after 5pm") is not captured as exact')
  assert.equal(capturedSlotHints('book a slot between 5pm and 7pm', tz).requestedTime, '', 'a range ("5pm and 7pm") is not captured as exact')

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

  // Multi-turn convergence (Codex P2): a date-only confirmation with no prior hints resolves
  // the date (which the handler persists); a later time-only turn then completes the flow.
  const step2 = mergeSlot('confirm the appointment for 28 September 2035', tz, {})
  assert.equal(step2.date, '2035-09-28', 'date-only turn resolves the date to persist')
  assert.equal(step2.time, null)
  assert.equal(step2.slot, null)
  const step3 = mergeSlot('confirm at 5pm', tz, { date: step2.date })
  assert.ok(step3.slot, 'once the persisted date is merged with the later time, the flow converges')
  assert.equal(step3.slot?.time, '17:00')
  assert.equal(step3.slot?.date, '2035-09-28')

  // Routing gate (Codex P2): a bare slot reply must be recognised so it can reach
  // createFinalApproval, while unrelated time/date messages are not hijacked.
  for (const yes of ['4:00 PM', 'confirm at 4pm', '28 September 2035', 'at 5pm']) {
    assert.ok(isSlotOnlyReply(yes), `slot-only reply routes back into confirmation: "${yes}"`)
  }
  for (const no of ['remind me at 5pm', 'what is the weather at 5pm in NYC tomorrow please', 'is EY1 on time at 5pm', 'prepare option 2']) {
    assert.ok(!isSlotOnlyReply(no), `non-slot message is not hijacked: "${no}"`)
  }
}

console.log('✅ acceptance: flight-status never shops, recall surfaces flight numbers + PNR, voice time preserved across turns')
