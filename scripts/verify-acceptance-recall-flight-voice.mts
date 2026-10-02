import assert from 'node:assert/strict'
import { detectIntent } from '../lib/bot/detect-intent'
import { buildTravelPresenceFacts } from '../lib/agent/context-brain'
import { answerLiveFlightStatus, buildFlightStatusQuery, isFareShoppingResult, answerLeaksFare, matchesRequestedOccurrence, classifyOccurrence, normalizeNumericDates } from '../lib/bot/handlers/flight-status'
import { tryRunAppointmentFollowup, mergeSlot, explicitClock, capturedSlotHints, isSlotOnlyReply, hasAmbiguousTime, hasAmbiguousDate } from '../lib/agent/appointment-followup'
import { hasConcreteFlightCode } from '../lib/bot/flight-codes'
import { parseCalendarCreate } from '../lib/bot/handlers/calendar-actions'
import { resolvePendingCalendar } from '../lib/bot/pending-followup'

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

  // Routing gate must require a GENUINE flight code (Codex P1): "on 28 September" is not a code,
  // so a codeless question must not be tagged for the dedicated status handler.
  assert.ok(hasConcreteFlightCode('has EY1 landed?'), 'a real flight code is recognised')
  assert.ok(!hasConcreteFlightCode('Did my flight land on 28 September 2026?'), '"on 28" is not treated as a flight code')
  assert.notEqual(detectIntent('Did my flight land on 28 September 2026?').meta?.flightStatus, true, 'a codeless flight question is not tagged flightStatus')
  // Real designators that are also English words must NOT be dropped by a blacklist (Codex P1).
  assert.ok(hasConcreteFlightCode('Has AM5 landed?'), 'Aeroméxico AM5 is kept (not blacklisted as "am")')
  assert.ok(hasConcreteFlightCode('current status of AS204'), 'Alaska AS204 is kept')
  assert.ok(hasConcreteFlightCode('has AM5 landed on 28 September 2026?'), 'AM5 still recognised even alongside a date phrase')

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
  for (const leak of ['EY1 tickets cost $520; book now', 'Fares from Rs 45,000', 'book now for the best price', 'lowest price ₹4999', 'EY1 is available for €520', 'EY1 costs GBP 450', 'fares from 4999 rupees']) {
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
    { title: 'EY1 (ETD1) Etihad Airways Flight Tracking - FlightAware', snippet: 'EY1 landed at New York JFK 8:40 AM EDT Sep 28, 2026. Scheduled 8:35 AM. Gate A6.', url: 'https://flightaware.com/live/flight/ETD1' },
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

  // Year-qualified requests need year evidence in text OR URL (Codex P1): a "Sep 28" result with
  // no year (possibly an archived other-year occurrence) must be rejected.
  // Softened to avoid over-restricting historical lookups: a yearless SAME-DAY result is ACCEPTED
  // (return status rather than force could-not-verify), while an explicit WRONG-year result is
  // rejected (the date-contradiction check is year-aware). Reason codes make each decision traceable.
  const noYear = { title: 'EY1 Etihad Flight Status', snippet: 'EY1 landed at JFK on 28 September at 8:40 AM.', url: 'https://flightaware.com/live/flight/ETD1' }
  const wrongYear = { title: 'EY1 Etihad Flight Status', snippet: 'EY1 landed at JFK on 28 September 2025 at 8:40 AM.', url: 'https://flightaware.com/live/flight/ETD1/history/20250928' }
  assert.ok(matchesRequestedOccurrence(noYear, prompt), 'a yearless same-day result is accepted (not over-restricted)')
  assert.ok(!matchesRequestedOccurrence(wrongYear, prompt), 'an explicit different-year (2025) result is rejected')
  // Wrong year encoded in the URL path must also be rejected; the right year in the URL accepted.
  const wrongYearUrl = { title: 'EY1 Etihad Flight Status', snippet: 'EY1 landed at JFK on 28 September at 8:40 AM.', url: 'https://flightaware.com/live/flight/ETD1/history/20250928' }
  const rightYearUrl = { title: 'EY1 Etihad Flight Status', snippet: 'EY1 landed at JFK on 28 September at 8:40 AM.', url: 'https://flightaware.com/live/flight/ETD1/history/20260928' }
  assert.ok(!matchesRequestedOccurrence(wrongYearUrl, prompt), 'wrong year in the URL path is rejected')
  assert.equal(classifyOccurrence(wrongYearUrl, prompt).reason, 'wrong_year', 'URL wrong-year rejection is traceable')
  assert.ok(matchesRequestedOccurrence(rightYearUrl, prompt), 'correct year in the URL path is accepted')
  // A flight NUMBER that looks like a year in the URL must NOT be read as a wrong year.
  const flightNumUrl = { title: 'AA2025 status', snippet: 'AA2025 landed at JFK on 28 September at 8:40 AM.', url: 'https://flightaware.com/live/flight/AAL2025' }
  assert.ok(matchesRequestedOccurrence(flightNumUrl, 'did AA2025 land on 28 September 2026?'), 'a flight number in the URL is not mistaken for a wrong year')
  assert.equal(classifyOccurrence(wrongYear, prompt).reason, 'wrong_year', 'wrong-year rejection is traceable')
  assert.equal(classifyOccurrence(wrongDate, prompt).reason, 'date_contradiction', 'wrong-day rejection is traceable')
  assert.equal(classifyOccurrence(datelessEy1, prompt).reason, 'dateless_for_dated_request', 'dateless rejection is traceable')
  assert.equal(classifyOccurrence(tracker[0], prompt).reason, 'ok', 'the correct occurrence classifies ok')

  // "on time" needs an ACTUAL punctuality signal — a schedule-only context must not ground it.
  const onTimeUngrounded = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => scheduleOnly,
    ask: async () => 'EY1 is on time.',
  })
  assert.match(onTimeUngrounded, /could(?:n'?t| not) verify/i, 'an on-time claim with only a published schedule is suppressed')

  // Ambiguous numeric dates follow India day-first; unambiguous ones (part >12) stay correct.
  assert.match(normalizeNumericDates('Did EY1 land on 9/10/2026?'), /2026-10-09/, 'ambiguous 9/10 -> 9 October (day-first)')
  assert.match(normalizeNumericDates('Did EY1 land on 9/28/2026?'), /2026-09-28/, 'unambiguous 9/28 -> 28 September')

  // Relative dates ("tomorrow") are resolved to an absolute date for both query and validation
  // (Codex P1), so today's recurring page is not reported as tomorrow's status.
  const q = buildFlightStatusQuery('Is EY1 delayed tomorrow?', '2026-09-30')
  assert.match(q, /2026-10-01/, 'relative "tomorrow" is resolved into the query')
  const todayResult = { title: 'EY1 FlightAware', snippet: 'EY1 landed 30 September 2026.', url: 'https://flightaware.com/live/flight/ETD1' }
  assert.ok(!matchesRequestedOccurrence(todayResult, 'Is EY1 delayed tomorrow?', '2026-09-30'), "today's result does not satisfy a tomorrow request")

  // en route / in air claims are grounded too (Codex P1).
  const enrouteUngrounded = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => scheduleOnly,
    ask: async () => 'EY1 is en route.',
  })
  assert.match(enrouteUngrounded, /could(?:n'?t| not) verify/i, 'an en-route claim with only a schedule is suppressed')

  // Reported TIMES must come from the source, not just the state verb (Codex P1): the context
  // says landed 8:40, so a reply of 10:40 is suppressed.
  const wrongTime = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => tracker,
    ask: async () => 'EY1 landed at JFK at 10:40 AM.',
  })
  assert.match(wrongTime, /could(?:n'?t| not) verify/i, 'a reply citing a clock time absent from the source is suppressed')

  // Negation polarity (Codex P1): a "not landed" source must not ground a "landed" reply.
  const notLanded = [{ title: 'EY1 FlightAware', snippet: 'EY1 has not landed yet; estimated 8:40 AM EDT on 28 September 2026.', url: 'https://flightaware.com/live/flight/ETD1/history/20260928' }]
  const negClaim = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => notLanded,
    ask: async () => 'EY1 landed at JFK.',
  })
  assert.match(negClaim, /could(?:n'?t| not) verify/i, 'a landed claim against a "not landed" source is suppressed')

  // "no delay" (noun negation) must not ground a "delayed" reply (Codex P1).
  const noDelay = [{ title: 'EY1 FlightAware', snippet: 'EY1 has no delay; on schedule to arrive 8:40 AM EDT on 28 September 2026.', url: 'https://flightaware.com/live/flight/ETD1/history/20260928' }]
  const delayClaim = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => noDelay,
    ask: async () => 'EY1 is delayed.',
  })
  assert.match(delayClaim, /could(?:n'?t| not) verify/i, 'a delayed claim against a "no delay" source is suppressed')

  // Meridiem + timezone (Codex P1): source is 8:40 AM EDT, a reply of 8:40 PM UTC is suppressed.
  const amEdt = [{ title: 'EY1 FlightAware', snippet: 'EY1 landed at JFK 8:40 AM EDT on 28 September 2026.', url: 'https://flightaware.com/live/flight/ETD1/history/20260928' }]
  const pmClaim = await answerLiveFlightStatus(prompt, 'Gogo', {
    search: async () => amEdt,
    ask: async () => 'EY1 landed at JFK at 8:40 PM UTC.',
  })
  assert.match(pmClaim, /could(?:n'?t| not) verify/i, 'a PM/UTC time inconsistent with the AM/EDT source is suppressed')
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
  assert.equal(capturedSlotHints('book at 5pm or 6pm', tz).requestedTime, '', 'alternative times ("5pm or 6pm") are not captured as exact')
  // Ambiguous DATES must be rejected too (Codex P2), while a single explicit date is still kept.
  assert.equal(capturedSlotHints('book a slot on 5 or 6 October 2026', tz).requestedDate, '', 'alternative dates are not captured as exact')
  assert.equal(capturedSlotHints('book between 5 and 7 October 2026', tz).requestedDate, '', 'a date range is not captured as exact')
  assert.equal(capturedSlotHints('book on 28 September 2026 at 5pm', tz).requestedDate, '2026-09-28', 'a single explicit date is still captured')

  // The CONFIRMATION turn itself must also reject alternatives (Codex P2) — mergeSlot must not
  // silently pick the first of "5pm or 6pm".
  assert.ok(hasAmbiguousTime('at 5pm or 6pm') && !hasAmbiguousTime('at 5pm'), 'alternative vs single time detected')
  assert.ok(hasAmbiguousDate('on 5 or 6 October 2035') && !hasAmbiguousDate('on 5 October 2035'), 'alternative vs single date detected')
  const ambConfirm = mergeSlot('confirm the appointment on 28 September 2035 at 5pm or 6pm', tz, {})
  assert.equal(ambConfirm.time, null, 'alternative times in the confirmation are not auto-resolved')
  assert.equal(ambConfirm.slot, null, 'no slot is staged for an unselected time')

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

// ---------------------------------------------------------------------------
// FAILURE 4 (Sep-30 15:32) — a TEXT "Help me prepare for a dentist appointment for 5 pm.
// Do not contact anyone or book it yet." must NOT silently default the date to today and stage
// a calendar-add approval. Before the fix, parseCalendarCreate matched "book" (inside "do not
// ... book it yet") and targetFromText defaulted to today, producing an approved event.
// ---------------------------------------------------------------------------
{
  const prep = parseCalendarCreate('Help me prepare for a dentist appointment for 5 pm. Do not contact anyone or book it yet.') as any
  assert.equal(prep?.preparation, true, 'preparation / "do not book" is NOT treated as a calendar create')
  assert.ok(!prep?.start, 'no event start is produced, so no calendar approval can be staged')
  assert.equal(prep?.time?.hour, 17, '5 pm is preserved for the clarification')

  // A genuine create with a time but NO date must ASK for the date (preserving the time), not
  // default to today.
  const noDate = parseCalendarCreate('add a dentist appointment at 5 pm') as any
  assert.equal(noDate?.needsDate, true, 'a create missing a date asks for the date')
  assert.ok(!noDate?.start, 'no event start until a date is supplied')
  assert.equal(noDate?.time?.hour, 17, '5 pm preserved for the date follow-up')

  // A create WITH an explicit date still proceeds normally.
  const withDate = parseCalendarCreate('add a dentist appointment on 28 October 2026 at 5 pm') as any
  assert.ok(!withDate?.needsDate && !withDate?.preparation, 'a dated create proceeds')
  assert.ok(withDate?.start, 'a dated create produces an event start')
  assert.equal(withDate?.start?.day, 28, 'the explicit date (28) is used, not today')

  // An AFFIRMATIVE create that merely uses a prep word as the title must still proceed (Codex P2).
  const prepMeeting = parseCalendarCreate('schedule a prep meeting tomorrow at 5 pm') as any
  assert.ok(!prepMeeting?.preparation, 'an affirmative create using a prep word is NOT suppressed')
  assert.ok(prepMeeting?.start, 'the affirmative create proceeds to an event start')
  const prepInterview = parseCalendarCreate('add an appointment to prepare for the interview tomorrow at 4 pm') as any
  assert.ok(!prepInterview?.preparation, 'an affirmative "add appointment to prepare" create is NOT suppressed')
  assert.ok(prepInterview?.start, 'it proceeds to an event start')

  // Title normalization: the persisted title is concise, not the whole sentence (Codex P2).
  const prep2 = parseCalendarCreate('Help me prepare for a dentist appointment for 5 pm. Do not contact anyone or book it yet.') as any
  assert.equal(prep2?.title, 'Dentist appointment', 'preparation title is normalized to the appointment, not the full sentence')

  // The date follow-up folds the preserved time back in so date + time resolve together.
  const completed = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, '28 October 2026')
  assert.ok(completed, 'a date reply completes the pending calendar with the preserved 5 pm')

  // A corrected time in the follow-up overrides the stored time — am/pm AND 24-hour forms (Codex P1).
  const rBase = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'tomorrow') as any
  for (const corrected of ['tomorrow at 6 pm', 'tomorrow at 18:00']) {
    const rc = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, corrected) as any
    if (rc?.remindAtIso && rBase?.remindAtIso) {
      assert.notEqual(new Date(rc.remindAtIso).getUTCHours(), new Date(rBase.remindAtIso).getUTCHours(), `a corrected follow-up time overrides the stored 5pm: "${corrected}"`)
    }
  }

  // Negation must bind to its own clause — a negated SECONDARY action does not suppress an earlier
  // affirmative create (Codex P2).
  const mixed = parseCalendarCreate('Schedule a dentist appointment tomorrow at 5 pm, but do not add a reminder') as any
  assert.ok(!mixed?.preparation, 'a negated secondary action does not suppress an affirmative create')
  assert.ok(mixed?.start, 'the affirmative appointment create proceeds')

  // An abbreviation period ("Dr.") must not truncate the derived title (Codex P2).
  const drTitle = parseCalendarCreate('Schedule a meeting with Dr. Smith at 5 pm') as any
  assert.equal(drTitle?.needsDate, true, 'no date -> needsDate')
  assert.equal(drTitle?.title, 'Meeting with Dr. Smith', 'the abbreviation period is preserved in the title')
}

// ---------------------------------------------------------------------------
// FAILURE 4b (Codex round-4 hardening on #315)
// ---------------------------------------------------------------------------
{
  const tz = 'Asia/Kolkata'
  // "don't forget to schedule ..." is affirmative, not a negation → a real create.
  const dontForget = parseCalendarCreate("Don't forget to schedule my dentist appointment tomorrow at 5 pm") as any
  assert.ok(!dontForget?.preparation, '"don\'t forget to schedule" is treated as affirmative, not preparation')
  assert.ok(dontForget?.start, 'the affirmative "don\'t forget to schedule" create proceeds')

  // Title text after the time is preserved.
  const withAlice = parseCalendarCreate('schedule a meeting at 5 pm with Alice') as any
  assert.equal(withAlice?.needsDate, true, 'no date -> needsDate')
  assert.equal(withAlice?.title, 'Meeting with Alice', 'title text after the time is preserved')

  // A dotted corrected time overrides the stored time.
  const rBase = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'tomorrow') as any
  const rDot = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'tomorrow 18.00') as any
  if (rDot?.remindAtIso && rBase?.remindAtIso) {
    assert.notEqual(new Date(rDot.remindAtIso).getUTCHours(), new Date(rBase.remindAtIso).getUTCHours(), 'a dotted corrected time (18.00) overrides the stored 5pm')
  }

  // Prior-year anniversary of today: a dateless live result must not satisfy a historical year.
  const datelessEy1b = { title: 'EY1 status', snippet: 'EY1 Abu Dhabi to New York. Track live.', url: 'https://flightaware.com/live/flight/ETD1' }
  assert.equal(classifyOccurrence(datelessEy1b, 'did EY1 land on 30 September 2025?', '2026-09-30').reason, 'dateless_for_dated_request', 'a prior-year anniversary of today still requires dated evidence')

  // needsDate follow-up: a time-only correction must NOT resolve an event (keep waiting for the date).
  assert.equal(resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'actually 6 pm'), null, 'a time-only reply to a date prompt does not create an event')
  // needsDate follow-up: an ISO date reply resolves to that date (not misread as 20:00).
  const iso = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, '2026-10-28') as any
  assert.ok(iso?.remindAtIso, 'an ISO date reply resolves the pending calendar')
  if (iso?.remindAtIso) { const d = new Date(iso.remindAtIso); assert.equal(d.getUTCMonth(), 9, 'ISO month is October'); assert.equal(d.getUTCDate() >= 27 && d.getUTCDate() <= 28, true, 'ISO day is 28 (IST)') }

  // Conflicting URL year is authoritative: snippet 2026 but URL /history/20250928 -> wrong_year.
  const conflictYear = { title: 'EY1 Etihad', snippet: 'EY1 landed at JFK on 28 September 2026 at 8:40 AM.', url: 'https://flightaware.com/live/flight/ETD1/history/20250928' }
  assert.equal(classifyOccurrence(conflictYear, 'Did EY1 land on 28 September 2026?').reason, 'wrong_year', 'a conflicting date-shaped URL year is rejected despite matching snippet text')

  // Full URL date validated (not just year): /history/20261002 is a different day in 2026 -> reject.
  const conflictDay = { title: 'EY1 Etihad', snippet: 'EY1 landed at JFK on 28 September 2026 at 8:40 AM.', url: 'https://flightaware.com/live/flight/ETD1/history/20261002' }
  assert.equal(classifyOccurrence(conflictDay, 'Did EY1 land on 28 September 2026?').reason, 'date_contradiction', 'a same-year but different-day URL date is rejected')

  // Negation must survive an abbreviation period ("Dr.") — still classified as preparation.
  const negAcrossAbbrev = parseCalendarCreate('Help me prepare for a dentist appointment tomorrow at 5 pm. Do not contact Dr. Smith or book it yet') as any
  assert.equal(negAcrossAbbrev?.preparation, true, '"do not ... Dr. ... book" stays negated across the abbreviation period')
  assert.ok(!negAcrossAbbrev?.start, 'no event/approval is produced')

  // Ordinal-only date reply completes the pending calendar (reminder parser resolves "the 28th").
  const ordinal = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'the 28th') as any
  assert.ok(ordinal?.remindAtIso, 'an ordinal-only date reply ("the 28th") resolves the pending calendar')
}

// ---------------------------------------------------------------------------
// FAILURE 4c (Codex round-7 on #315)
// ---------------------------------------------------------------------------
{
  const dayMs = 24 * 60 * 60 * 1000

  // P1 — a needsDate follow-up answered with "day after tomorrow" must resolve TWO days ahead.
  // The reminder parser matches the embedded word "tomorrow", so without normalization it would
  // schedule only one day ahead. Assert it lands exactly one day BEYOND the "tomorrow" answer,
  // going through the actual calendar follow-up path (resolvePendingCalendar -> parseReminderIntent,
  // whose result process-message.ts hands to createCalendarEventAtIso).
  const rTomorrow = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'tomorrow') as any
  const rDayAfter = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'day after tomorrow') as any
  const rDayAfterThe = resolvePendingCalendar({ title: 'dentist appointment', timeText: '5:00 PM' }, 'the day after tomorrow') as any
  assert.ok(rTomorrow?.remindAtIso && rDayAfter?.remindAtIso && rDayAfterThe?.remindAtIso, 'all three follow-up dates resolve to an instant')
  const daysBeyondTomorrow = (r: any) => Math.round((new Date(r.remindAtIso).getTime() - new Date(rTomorrow.remindAtIso).getTime()) / dayMs)
  assert.equal(daysBeyondTomorrow(rDayAfter), 1, '"day after tomorrow" resolves one day beyond tomorrow (two days ahead), not the same day as tomorrow')
  assert.equal(daysBeyondTomorrow(rDayAfterThe), 1, '"the day after tomorrow" resolves two days ahead as well')
  // The preserved 5 pm still rides along (same wall-clock time, only the date differs).
  assert.equal(new Date(rDayAfter.remindAtIso).getTime() - new Date(rTomorrow.remindAtIso).getTime(), dayMs, 'the preserved time is unchanged; exactly a 24h date shift')

  // P2 — a negation in an EARLIER sentence must not suppress an affirmative create in a LATER
  // sentence. The round-6 [\s\S] span let "Do not …" govern the later "Schedule"; the gap must
  // stop at the sentence boundary.
  const twoSentences = parseCalendarCreate('Do not contact Alice. Schedule a meeting tomorrow at 5 pm') as any
  assert.ok(!twoSentences?.preparation, 'a negation in an earlier sentence does not route a later explicit create to preparation')
  assert.ok(twoSentences?.start, 'the second-sentence "Schedule a meeting" proceeds to an event start')
  const twoSentencesBang = parseCalendarCreate('Do not book flights! Add a meeting tomorrow at 4 pm') as any
  assert.ok(!twoSentencesBang?.preparation && twoSentencesBang?.start, 'a "!" boundary also confines the negation')

  // P2 — abbreviations are STILL preserved: a negated clause containing "Dr." keeps binding to the
  // create verb within the SAME sentence, so it stays preparation (no event).
  const negAcrossDr = parseCalendarCreate('Help me prepare for a dentist appointment tomorrow at 5 pm. Do not contact Dr. Smith or book it yet') as any
  assert.equal(negAcrossDr?.preparation, true, '"do not … Dr. … book" stays negated across the abbreviation period')
  assert.ok(!negAcrossDr?.start, 'no event/approval is produced for the negated, same-sentence booking')
  const negMr = parseCalendarCreate('Do not contact Mr. Lee or book a room yet') as any
  assert.equal(negMr?.preparation, true, 'negation survives "Mr." within the clause')
}

console.log('✅ acceptance: recall PNR survives budget, flight-status grounded (never shops), voice/calendar time preserved, prep never auto-creates, day-after-tomorrow is +2 days, negation respects sentence boundaries')

// Exact live 3 Oct flight prompt must not consult or mutate a stale prepared
// appointment, even though its prohibition contains "submit a booking".
assert.equal(await tryRunAppointmentFollowup({actor:{legacyTelegramId:42} as any,surface:'web',text:'Open https://www.goindigo.in/ in the browser. Read only. This is a test itinerary: search Bengaluru to Mumbai, one adult, one-way on 10 October 2026. Report displayed flight dates, times and fares only if verifiable. Do not enter passenger details, hold seats, submit a booking or pay. Stop at authentication.'}),null)
