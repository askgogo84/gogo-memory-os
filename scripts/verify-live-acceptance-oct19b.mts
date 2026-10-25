// Second 19 Oct WhatsApp live round (production 230d02b):
// 1) "abort mission" reached chat, which replied "Both Jailer 2 calendar approvals are cancelled"
//    while both stayed pending — a passive false receipt the guard did not catch;
// 2) "approve" listed two identical lines ("Block calendar for this booking") the user could not tell apart;
// 3) "What's the status of the Jailer 2 calendar task?" got the whole digest because "calendar"
//    blocked the named ask even with an explicit "task".
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fixture-only'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fixture-only'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fixture-only'
const guard = await import('../lib/bot/action-claim-guard')
const ttl = await import('../lib/agent/approval-ttl')
const status = await import('../lib/agent/task-status')
const failures: string[] = []
function check(label: string, fn: () => void) { try { fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(label + ': ' + e.message) } }

check('a passive receipt about approvals, reminders or bookings from chat is blocked', () => {
  for (const t of ['Got it, boss. Both Jailer 2 calendar approvals are cancelled. Nothing was added to your calendar.', 'Your 5pm reminder has been deleted.', 'Both approvals have now been cancelled.', 'Done. Both approvals cancelled.', 'The approval was rejected.', 'Your water reminder is now paused.']) {
    const r = guard.guardChatActionClaims(t)
    assert.equal(r.blocked, true, t)
    assert.equal(r.text, guard.NO_CHANGE_REPLY)
  }
})
check('questions, conditionals, attributed reports and ordinary answers are not blocked', () => {
  for (const t of ['Both are stuck at the approval gate. Want me to proceed and add it to your calendar now?', 'Approvals can be cancelled from the dashboard.', 'Should the reminder be cancelled?', 'The meeting was moved to 4 pm by the organiser according to your calendar.', 'I don\'t have any health updates about your mom. The only mention is a reminder you set for tomorrow at 10:00 am to call her.', 'Flight 6E 2341 arrived 18 hours ago.', 'The event was created by Rahul.', 'The reminder was set for 5 pm earlier today.', 'Your Amazon order was cancelled by Amazon and a refund is on the way.', 'Your IndiGo booking was cancelled — refund in 5-7 days.', "Rahul's meeting was moved to 4 pm.", 'Your leave request was approved (by HR).', 'Your card payment was declined at 3 pm.', 'Your pull request was approved and merged.', 'From your inbox: your Swiggy order was cancelled and refunded.', "The team meeting was rescheduled to Friday per Priya's email.", 'Last year the event was moved to Goa.'])
    assert.equal(guard.guardChatActionClaims(t).blocked, false, t)
})
check('numbered approval lines carry each card\'s own event, time and place', () => {
  const rows = [
    {title: 'Block calendar for this booking', requested_at: '2026-10-18T14:20:00Z', payload_preview: [{label: 'Event', value: 'Jailer 2'}, {label: 'Starts', value: 'Mon 19 Oct, 9:45 pm'}, {label: 'Ends', value: '12:30 am'}, {label: 'Venue', value: 'PVR Orion Mall'}]},
    {title: 'Block calendar for this booking', requested_at: '2026-10-18T14:25:00Z', payload_preview: [{label: 'Event', value: 'Jailer 2'}, {label: 'Starts', value: 'Tue 20 Oct, 6:30 pm'}, {label: 'Venue', value: 'Not provided'}]},
    {title: 'Send email to Rahul', requested_at: '2026-10-19T05:00:00Z'},
  ]
  const text = ttl.approvalChoiceList(rows, Date.parse('2026-10-19T05:30:00Z'))
  const lines = text.split('\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^1\. Block calendar for this booking — Jailer 2 · Mon 19 Oct, 9:45 pm · PVR Orion Mall \(requested /)
  assert.match(lines[1], /^2\. Block calendar for this booking — Jailer 2 · Tue 20 Oct, 6:30 pm \(requested /)
  assert.doesNotMatch(lines[1], /Not provided/)
  assert.match(lines[2], /^3\. Send email to Rahul \(requested /)
  assert.notEqual(lines[0].replace(/\(requested.*$/, ''), lines[1].replace(/\(requested.*$/, ''))
})
check('an explicit task ask may mention a domain word; bare domain asks stay with their handlers', () => {
  assert.deepEqual(status.parseTaskStatusQuery("What's the status of the Jailer 2 calendar task?"), {kind: 'named', phrase: 'jailer 2 calendar task'})
  for (const t of ["what's the status of my refund request", 'status of my amazon order request', 'status of my swiggy order task'])
    assert.notEqual(status.parseTaskStatusQuery(t)?.kind, 'named', t)
  for (const t of ["what's the status of my calendar", 'status of my reminders', 'How is my mom doing?', "What's the status of flight 6E 2341?", 'status of my amazon order task and cancel it'])
    assert.notEqual(status.parseTaskStatusQuery(t)?.kind, 'named', t)
  const run = {id: 'r1', status: 'waiting_approval', title: 'Add Jailer 2 to calendar', updated_at: new Date().toISOString()}
  assert.equal(status.matchRunByTitle([run], 'jailer 2 calendar task')?.run.id, 'r1')
})

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 } else console.log('19 Oct live round 2 regressions passed: passive receipts, distinguishable approvals, named calendar task.')

// Instinct comparison (19 Oct): "Book a table for 2 at Toit Indiranagar this Saturday 8pm" was asked to restate
// its time, and the reply "This Saturday 8pm" then created a reminder titled "This".
{
  const RealDate = Date
  const NOW = RealDate.parse('2026-10-19T06:10:00Z') // Mon 19 Oct, 11:40 IST
  ;(globalThis as any).Date = class extends RealDate { constructor(...a: any[]) { super(...(a.length ? a : [NOW]) as []) } static now() { return NOW } }
  const rr = await import('../lib/agent/restaurant-reservation')
  const rem = await import('../lib/bot/handlers/reminders')
  const extra: string[] = []
  const expect = (label: string, fn: () => void) => { try { fn(); console.log('PASS ' + label) } catch (e: any) { extra.push(label + ': ' + e.message) } }
  expect('Toit reservation: day-led clock and relative dates parse without re-asking', () => {
    const cases: Array<[string, string, string]> = [
      ['Book a table for 2 at Toit Indiranagar this Saturday 8pm', '2026-10-24', '20:00'],
      ['Book a table for 2 at Toit Indiranagar this Saturday 8 pm', '2026-10-24', '20:00'],
      ['Reserve a table at Toit for 2 tomorrow 8pm', '2026-10-20', '20:00'],
      ['Book a table for 4 at Toit tonight 9:30 pm', '2026-10-19', '21:30'],
      ['Book a table for 2 at Toit on 25 Oct at 8pm', '2026-10-25', '20:00'],
    ]
    for (const [text, date, time] of cases) {
      const i = rr.parseRestaurantReservationIntent(text)!
      assert.equal(i.timeClarificationNeeded, false, text)
      assert.equal(i.requestedDate, date, text)
      assert.equal(i.preferredStart, time, text)
    }
    // Conflicting or excluded clocks still ask.
    assert.equal(rr.parseRestaurantReservationIntent('Book a table for 2 at Toit Saturday 8pm or 9pm')!.timeClarificationNeeded, true)
    assert.equal(rr.parseRestaurantReservationIntent('Book a table for 2 at Toit Saturday, not 8pm')!.timeClarificationNeeded, true)
  })
  expect('a bare day/time with nothing to be reminded about is not a reminder request', () => {
    for (const t of ['This Saturday 8pm', 'tomorrow 10am', '8pm', 'next friday at 9']) assert.equal(rem.isContentlessReminderRequest(t), true, t)
    for (const t of ['call mom tomorrow 10am', 'remind me tomorrow 10am', 'gym saturday 7am', 'tomorrow 10am dentist']) assert.equal(rem.isContentlessReminderRequest(t), false, t)
  })
  ;(globalThis as any).Date = RealDate
  if (extra.length) { console.error(extra.join('\n')); process.exitCode = 1 }
}
