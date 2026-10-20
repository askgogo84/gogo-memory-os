// 20 Oct 2026 live dashboard failures (r4-memory):
//  1. "Cancel the Monday review reminder" asked "Which reminder?" and the list omitted the weekly
//     "Review the week" series. The weekday qualifier now picks the Monday series, and a picker lists
//     the matching reminders (recurring included) with their real numbers.
//  2. An internal plan step ("Retrieve saved preferences about …") was saved/shown as a reminder.
//     It is filtered from listings and never saved from a chat REMINDER: line or a mission step.
//     "What are my reminders?" skips the general planner on the dashboard.
//  3. A booking date without a year was saved as 19 Oct 2024. Extraction years the evidence never
//     states are re-anchored; year-shifted duplicate life events collapse to one; a saved ticket is
//     stated to the model as booking evidence.
//  4. A booking-calendar approval for a show that already happened read "waiting for approval".
// Run: npx tsx scripts/verify-r4-memory-oct20.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'
process.env.ANTHROPIC_API_KEY ||= 'x'
import { readFileSync } from 'node:fs'

let fails = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}

const er: any = await import('../lib/bot/handlers/edit-reminder')
const dedup: any = await import('../lib/bot/reminder-dedup')
const yd: any = await import('../lib/agent/yearless-date')
const lifecycle: any = await import('../lib/agent/task-lifecycle')
const ts: any = await import('../lib/agent/task-status')

// ── 1. cancel by name reaches the recurring Monday series ──────────────────────────────
// Next Monday 26 Oct 2026 09:00 IST = 03:30Z; evening review daily 21:00 IST.
const weekly = { id: 'w', message: 'Review the week', remind_at: '2026-10-26T03:30:00.000Z', is_recurring: true, recurring_pattern: 'monday' }
const daily = { id: 'd', message: 'Review the day and plan tomorrow', remind_at: '2026-10-21T15:30:00.000Z', is_recurring: true, recurring_pattern: 'daily' }
const others = [1, 2, 3, 4, 5].map((n) => ({ id: `o${n}`, message: `Call vendor ${n}`, remind_at: `2026-10-2${n}T05:00:00.000Z`, is_recurring: false, recurring_pattern: null }))
const all = [daily, ...others, weekly]
const input = 'cancel the monday review reminder'
const q = er.extractCancelQuery(input)
check('cancel query keeps the title word', q === 'review', `got ${JSON.stringify(q)}`)
const matches = all.filter((r) => er.reminderMatches(r, q))
check('"review" matches both review reminders', matches.length === 2)
const narrowed = er.narrowByWhen(matches, input)
check('"Monday" narrows to the weekly Monday series', narrowed.length === 1 && narrowed[0].id === 'w', JSON.stringify(narrowed.map((r: any) => r.id)))
check('"weekly review" narrows to the weekly series', (() => { const n = er.narrowByWhen(matches, 'cancel my weekly review'); return n.length === 1 && n[0].id === 'w' })())
check('an unhelpful weekday never empties the list', er.narrowByWhen(matches, 'cancel the friday review').length === 2)
const picker = er.reminderDisambiguation('cancel', all, matches)
check('picker lists the recurring "Review the week" with its real number', /7\. Review the week — every Monday at 9:00 am/.test(picker), picker)
check('picker lists only the matching reminders', !/Call vendor/.test(picker), picker)
check('picker hint uses a shown number', /Try: \*cancel 1\*/.test(picker), picker)

// ── 2. internal plan steps are not reminders ──────────────────────────────────────────
const junk = 'Retrieve saved preferences about activities, dining, entertainment, travel patterns, and any upcoming plans'
check('plan step is recognised', dedup.isInternalPlanStepReminder(junk) === true)
for (const real of ['Review the week', 'retrieve my laundry', 'Search for a gift for Divya', 'Check email', 'Call Nithin about preferences']) {
  check(`real reminder kept: "${real}"`, dedup.isInternalPlanStepReminder(real) === false)
}
check('chat REMINDER line blocked for a plan-step message', dedup.mayExecuteChatReminderDirective({ text: 'remind me', message: junk }) === false)
check('internal step without a reminder ask cannot save one', dedup.mayExecuteChatReminderDirective({ internalStep: true, text: 'Look up what Divya likes for dinner', message: 'Dinner with Divya' }) === false)
check('internal step that asks for a reminder can', dedup.mayExecuteChatReminderDirective({ internalStep: true, text: 'Create a reminder to call Nithin at 5pm', message: 'Call Nithin' }) === true)
check('user turn unchanged', dedup.mayExecuteChatReminderDirective({ text: 'remind me to call Nithin at 5pm', message: 'Call Nithin' }) === true)
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
check('getActiveReminders filters plan steps', /isInternalPlanStepReminder\(r\.message\)/.test(src('lib/bot/handlers/edit-reminder.ts')))
check('"What are my reminders?" reader filters plan steps', /!isInternalPlanStepReminder\(r\.message\)/.test(src('lib/bot/handlers/natural-command-routing.ts')))
check('compound reminder reader filters plan steps', /isInternalPlanStepReminder\(row\.message\)/.test(src('lib/agent/compound-planner.ts')))
check('mission reminder refuses a plan-step message', /isInternalPlanStepReminder\(params\.message\)\)throw new Error\('mission_reminder_intent_unverified'\)/.test(src('lib/agent/mission-tools.ts')))
check('chat fallback gates REMINDER lines', /mayExecuteChatReminderDirective\(\{ internalStep: params\.internalStep/.test(src('lib/bot/process-message.ts')))
{
  // The route keeps its rule inline (strict route harnesses); evaluate that exact function body here.
  const route = src('app/api/dashboard/chat/route.ts')
  const body = route.match(/function isReminderReadOnlyAsk\(text: string\): boolean \{([\s\S]*?)\n\}/)?.[1] || ''
  const { isGroundedReminderCommand } = await import('../lib/agent/jev-router')
  const ask = new Function('isGroundedReminderCommand', 'text', body) as any
  check('reminder read is a read-only ask', ask(isGroundedReminderCommand, 'What are my reminders?') === true)
  check('reminder edit is not', ask(isGroundedReminderCommand, 'move my reminders to 8pm') === false)
  check('reminder create is not', ask(isGroundedReminderCommand, 'show my reminders and add one for 5pm') === false)
}
check('dashboard skips the planner for reminder reads', /isPlainInfoQuestion\(text\) \|\| isReminderReadOnlyAsk\(text\) \? null : await tryRunGeneralPlan/.test(src('app/api/dashboard/chat/route.ts')))

// ── 3. yearless dates, duplicates, ticket evidence ─────────────────────────────────────
const now = new Date('2026-10-20T17:30:00.000Z')
check('2024 guessed for "Sat, 19 Oct" re-anchors to 2026', yd.anchorYearlessInstant('2024-10-19T21:45:00+05:30', 'Jailer 2 · Sat, 19 Oct, 9:45 PM · PVR Orion Mall', now) === '2026-10-19T16:15:00.000Z')
check('a footer year is not evidence', yd.anchorYearlessInstant('2024-10-19T16:15:00Z', 'Sat, 19 Oct 9:45 PM. © 2024 Bigtree Entertainment', now) === '2026-10-19T16:15:00.000Z')
check('a stated year is kept', yd.anchorYearlessInstant('2027-01-05T10:00:00Z', 'Show on 5 Jan 2027 at 3:30 PM', now) === '2027-01-05T10:00:00Z')
check('2-digit numeric year counts as stated', yd.anchorYearlessInstant('2025-10-19T16:15:00Z', 'Date 19/10/25 9:45 PM', now) === '2025-10-19T16:15:00Z')
check('early-January show from late October anchors forward', yd.anchorYearlessInstant('2025-01-03T14:00:00Z', 'Fri, 3 Jan 7:30 PM', now) === '2027-01-03T14:00:00.000Z')
check('booking extraction prompt carries today and anchors the result', /todayLine\(new Date\(\),input\.timezone\)/.test(src('lib/agent/booking-closure.ts')) && /anchorYearlessInstant\(String\(raw\.startAt\),evidence\)/.test(src('lib/agent/booking-closure.ts')))

const cb: any = await import('../lib/agent/context-brain')
const ticketRow = { title: 'Jailer 2', metadata_json: { credential: { documentId: 'doc-1' } }, source_refs: [] }
check('saved ticket is stated as booking evidence', /Booking confirmed: the provider-issued ticket\/QR is saved/.test(cb.lifeEventBookingEvidence(ticketRow)))
check('no evidence → nothing claimed', cb.lifeEventBookingEvidence({ title: 'Jailer 2', metadata_json: {} }) === '')
const real = { id: 'life-event:a', source: 'life_event', summary: 'Jailer 2 · Booking confirmed: the provider-issued ticket/QR is saved in AskGogo (the user can ask for it)', score: 1, confidence: 1, startAt: '2026-10-19T16:15:00.000Z' }
const phantom = { id: 'life-event:b', source: 'life_event', summary: 'Jailer 2', score: 1, confidence: 1, startAt: '2024-10-19T16:15:00.000Z' }
const other = { id: 'life-event:c', source: 'life_event', summary: 'Dentist', score: 1, confidence: 1, startAt: '2026-10-25T05:00:00.000Z' }
const kept = cb.dropYearShiftedDuplicates([phantom, real, other], now.getTime()).map((f: any) => f.id)
check('year-shifted phantom booking dropped, real and unrelated kept', JSON.stringify(kept) === JSON.stringify(['life-event:a', 'life-event:c']), JSON.stringify(kept))
const twoShows = cb.dropYearShiftedDuplicates([{ ...real, id: 'x' }, { ...real, id: 'y' }], now.getTime()).length
check('same-year same-time rows are never merged', twoShows === 2)

// ── 4. past-event calendar approval is closed ──────────────────────────────────────────
const run = { id: 'r1', telegram_id: '1', status: 'waiting_approval', title: 'Add Jailer 2 to calendar', summary: 'Booking details are resolved. Waiting for approval to block the calendar.', progress: 90, updated_at: '2026-10-19T10:00:00.000Z', metadata_json: { plan_type: 'booking_event_calendar', proposedEvent: { title: 'Jailer 2', provider: 'BookMyShow', startAt: '2026-10-19T16:15:00.000Z', endAt: '2026-10-19T19:15:00.000Z' } } }
check('past-event calendar run is retired', lifecycle.retiredRunReason(run, now.getTime()) === lifecycle.PAST_EVENT_CALENDAR_REASON)
check('future calendar run is not', lifecycle.retiredRunReason({ ...run, metadata_json: { ...run.metadata_json, proposedEvent: { startAt: '2026-10-30T16:15:00Z', endAt: '2026-10-30T19:15:00Z' } } }, now.getTime()) === null)
const card = ts.formatRunStatus(run, [], ts.lastRunActivity(run, []), now)
check('task status says the show happened and the block was dropped', /is closed/.test(card) && /The show already happened, so I dropped the calendar block/.test(card), card)
check('task status no longer says waiting for approval', !/waiting for (?:your )?approval/i.test(card), card)
const statusReply = await ts.tryGetTaskStatus({ telegramId: 1 }, 'Any update on the Jailer 2 task?', { listRuns: async () => [run], listSteps: async () => [], now: () => now })
check('"Any update on the Jailer 2 task?" answers closed', Boolean(statusReply) && /dropped the calendar block/.test(statusReply.text), statusReply?.text)
const as: any = await import('../lib/agent/autonomy-status')
const approval = { execution_payload: { plan_type: 'booking_event_calendar' }, payload_preview: [{ label: 'Starts', value: '2026-10-19T16:15:00.000Z' }, { label: 'Ends', value: '2026-10-19T19:15:00.000Z (estimated)' }] }
check('past booking-calendar approval is not shown as pending', as.pastEventCalendarApproval(approval, now.getTime()) === true)
check('future approval still shown', as.pastEventCalendarApproval({ ...approval, payload_preview: [{ label: 'Ends', value: '2026-11-01T10:00:00Z' }] }, now.getTime()) === false)

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
process.exit(fails ? 1 : 0)
