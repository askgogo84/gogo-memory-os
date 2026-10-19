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
  for (const t of ['Got it, boss. Both Jailer 2 calendar approvals are cancelled. Nothing was added to your calendar.', 'Your 5pm reminder has been deleted.', 'The booking was rejected.', 'Done — the request is now approved.']) {
    const r = guard.guardChatActionClaims(t)
    assert.equal(r.blocked, true, t)
    assert.equal(r.text, guard.NO_CHANGE_REPLY)
  }
})
check('questions, conditionals, attributed reports and ordinary answers are not blocked', () => {
  for (const t of ['Both are stuck at the approval gate. Want me to proceed and add it to your calendar now?', 'Approvals can be cancelled from the dashboard.', 'Should the reminder be cancelled?', 'The meeting was moved to 4 pm by the organiser according to your calendar.', 'I don\'t have any health updates about your mom. The only mention is a reminder you set for tomorrow at 10:00 am to call her.', 'Flight 6E 2341 arrived 18 hours ago.'])
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
  for (const t of ["what's the status of my calendar", 'status of my reminders', 'How is my mom doing?', "What's the status of flight 6E 2341?", 'status of my amazon order task and cancel it'])
    assert.notEqual(status.parseTaskStatusQuery(t)?.kind, 'named', t)
  const run = {id: 'r1', status: 'waiting_approval', title: 'Add Jailer 2 to calendar', updated_at: new Date().toISOString()}
  assert.equal(status.matchRunByTitle([run], 'jailer 2 calendar task')?.run.id, 'r1')
})

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 } else console.log('19 Oct live round 2 regressions passed: passive receipts, distinguishable approvals, named calendar task.')
