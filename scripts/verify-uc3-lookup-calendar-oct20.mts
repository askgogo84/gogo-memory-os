// 20 Oct E2E: "When is Jailer 2 releasing and add it to my calendar" listed today's calendar.
// UC11: cancel reply named the run "Browser · www.flipkart.com".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLookupThenCalendar, calendarFollowupLine, firstFutureDate, alreadyHappened, alreadyHappenedLine } from '../lib/agent/lookup-then-calendar'
import { isCalendarViewRequest, groupCalendarLines } from '../lib/bot/handlers/calendar-actions'
import { resolvePendingCalendar } from '../lib/bot/pending-followup'
import { friendlyTaskTitle, taskDisplayTitle } from '../lib/agent/task-title'

const UC3 = 'When is Jailer 2 releasing and add it to my calendar'
let pass = 0
const ok = (name: string, fn: () => void) => { fn(); pass++; console.log('PASS', name) }

ok('UC3 is not a calendar read', () => {
  assert.equal(isCalendarViewRequest(UC3), false)
  assert.equal(isCalendarViewRequest('Add Jailer 2 release to my calendar'), false)
  // positive controls: real reads still match
  assert.equal(isCalendarViewRequest("what's on my calendar today"), true)
  assert.equal(isCalendarViewRequest('show my calendar'), true)
  assert.equal(isCalendarViewRequest('When is my dentist appointment tomorrow?'), true)
})

ok('UC3 parses as lookup + calendar write', () => {
  const p = parseLookupThenCalendar(UC3)
  assert.deepEqual(p, { question: 'When is Jailer 2 releasing?', subject: 'Jailer 2', title: 'Jailer 2 release' })
  assert.equal(parseLookupThenCalendar('What date is the Coldplay concert? Also put it in my calendar')?.title, 'Coldplay concert')
  assert.equal(parseLookupThenCalendar('When does Pushpa 3 come out, add that to my calendar')?.title, 'Pushpa 3 release')
  // not compound / not a lookup
  assert.equal(parseLookupThenCalendar('add it to my calendar'), null)
  assert.equal(parseLookupThenCalendar("what's on my calendar today"), null)
  assert.equal(parseLookupThenCalendar('Book Toit and add it to my calendar'), null)
})

ok('follow-up line never claims an add', () => {
  const line = calendarFollowupLine('Jailer 2 release', '14 November')
  assert.match(line, /nothing added yet/)
  assert.match(line, /\*14 November, 10 am\*/)
  assert.doesNotMatch(line, /\badded\b(?! yet)|confirmed|booked/i)
})

ok('first future date from the answer', () => {
  const now = new Date('2026-10-19T20:35:00Z') // 02:05 IST, 20 Oct
  assert.equal(firstFutureDate('Jailer 2 releases on 14 November 2026 in theatres.', now), '14 November')
  assert.equal(firstFutureDate('It released on 12 June 2026; the OTT date is Nov 28.', now), '28 November')
  assert.equal(firstFutureDate('No date has been announced.', now), null)
  assert.equal(firstFutureDate('Expected 10 January', now), '10 January')
})

ok('reply with date+time completes the pending entry', () => {
  const r: any = resolvePendingCalendar({ title: 'Jailer 2 release' }, '14 November, 10 am')
  assert.ok(r?.remindAtIso, 'expected a resolved time')
  const ist = new Date(Date.parse(r.remindAtIso) + 5.5 * 3600_000)
  assert.equal(ist.getUTCDate(), 14); assert.equal(ist.getUTCMonth(), 10); assert.equal(ist.getUTCHours(), 10)
})

ok('duplicate calendar lines grouped', () => {
  const lines = Array(7).fill('• 10:00 am — Standup').concat(['• 2:00 pm — Review'])
  assert.deepEqual(groupCalendarLines(lines), ['• 10:00 am — Standup (×7)', '• 2:00 pm — Review'])
})

ok('UC11 friendly cancel title', () => {
  assert.equal(taskDisplayTitle('Browser · www.flipkart.com'), 'Flipkart browser check')
  assert.equal(taskDisplayTitle('Gold alert: 22K Bangalore'), 'Gold alert: 22K Bangalore')
  assert.equal(friendlyTaskTitle('Browser · www.instagram.com'), 'Instagram')
  const rc = readFileSync(new URL('../lib/agent/run-cancel.ts', import.meta.url), 'utf8')
  assert.match(rc, /const title = taskDisplayTitle\(runLabel\(target\)\)/)
})

ok('wiring: compound handler runs before the calendar action branch', () => {
  const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
  const a = pm.indexOf('parseLookupThenCalendar(incomingText)')
  const b = pm.indexOf('if (isCalendarAction(incomingText))')
  assert.ok(a > 0 && b > a)
  assert.match(pm.slice(a, b), /saveFollowupState\(resolvedUser\.telegramId, 'pending_calendar'/)
  assert.doesNotMatch(pm.slice(a, b), /createCalendarEvent|createEventFromPayload/)
})

ok('live 03:30 IST: already-released film gets no calendar offer', () => {
  const now = new Date('2026-10-19T22:00:00Z')
  const live = '*Jailer 2 has already released* – it came out on October 14-15, 2026, which was last week.'
  assert.equal(firstFutureDate(live, now), null)
  assert.equal(alreadyHappened(live, now), true)
  assert.match(alreadyHappenedLine('Jailer 2 release'), /haven't set up a calendar entry/)
  // positive control: an upcoming date keeps the offer
  assert.equal(alreadyHappened('Jailer 3 releases on 14 November 2026.', now), false)
  const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
  assert.match(pm, /if \(!past\) await saveFollowupState\(resolvedUser\.telegramId, 'pending_calendar'/)
})

console.log(`UC3_UC11_OK ${pass}/9`)
