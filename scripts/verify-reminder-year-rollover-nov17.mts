// A date said without a year that is long gone this year means next year ("remind me on 9 January" said in
// November used to answer "that time has already passed"). A date only just past is still reported as passed.
import assert from 'node:assert/strict'

const RealDate = Date
let fixed = RealDate.parse('2026-11-17T04:30:00Z') // 17 Nov 2026, 10:00 IST
class FrozenDate extends RealDate {
  constructor(...args: any[]) { if (args.length) super(...(args as [any])); else super(fixed) }
  static now() { return fixed }
}
;(globalThis as any).Date = FrozenDate
const { parseReminderIntent, reminderTimingProblem } = await import('../lib/bot/handlers/reminders.ts')
let checks = 0
const iso = (text: string) => { const p: any = parseReminderIntent(text); return p?.remindAtIso || null }
const eq = (a: unknown, b: unknown, m: string) => { assert.equal(a, b, m); checks++ }

eq(iso('remind me on 9 January at 10am to renew the car insurance'), '2027-01-09T04:30:00.000Z', '9 January said in November is next January')
eq(reminderTimingProblem('remind me on 9 January at 10am to renew the car insurance'), null, 'and it is accepted')
eq(iso('remind me on 3rd March at 6pm to call Divya'), '2027-03-03T12:30:00.000Z', 'March too')
eq(iso('remind me on Saturday 9 January at 10am to renew insurance'), '2027-01-09T04:30:00.000Z', 'weekday checked against next year (9 Jan 2027 is a Saturday)')
eq(iso('remind me on Monday 9 January at 10am to renew insurance'), null, 'a wrong weekday still refuses')
eq(iso('remind me on 20 December at 9am to pay rent'), '2026-12-20T03:30:00.000Z', 'a date still ahead this year is unchanged')
eq(iso('remind me on 10 November at 9am to pay rent') === '2027-11-10T03:30:00.000Z', false, 'a date just past is never moved a year ahead')
eq(/already passed/.test(String(reminderTimingProblem('remind me on 10 November at 9am to pay rent'))), true, 'and is reported as passed, never moved a year')
eq(iso('remind me on 9 January 2026 at 10am to renew insurance') === '2027-01-09T04:30:00.000Z', false, 'a stated year is never changed')
eq(/already passed/.test(String(reminderTimingProblem('remind me on 9 January 2026 at 10am to renew insurance'))), true, 'stated past year is reported as passed')
eq(iso('remind me on 29 February at 9am to check'), null, '29 February: next year has none')

// Review (PR #1529): a year in another form, the sentence's own timing, or a date that is the subject never rolls.
const { buildReminderConfirmation } = await import('../lib/bot/handlers/reminders.ts')
for (const text of [
  'remind me on 9 January, 2026 at 10am to renew insurance', "remind me on 9 Jan '26 at 10am to renew insurance", 'remind me on 9 Jan 26 at 10am to renew insurance',
  'the invoice dated 3 March, remind me tomorrow', 'remind me tomorrow about the invoice dated 3 March', 'remind me in 2 hours about the invoice dated 3 March',
  'remind me at 6pm to pay the invoice dated 3 March', 'remind me to follow up on the 5 June order', 'I have been waiting since 5 January, remind me to call them at 5pm',
  'remind me that my passport expired on 12 March', 'remind me to file the return that was due 31 July', 'remind me to submit expenses from 1 March to 31 March',
  'schedule a reminder for the meeting we had on 2 May, tomorrow 9am',
]) eq(String(iso(text) || '').startsWith('2027'), false, `never a next-year reminder: ${text}`)
eq(iso('remind me on 9 January 10am to renew insurance'), '2027-01-09T04:30:00.000Z', 'a clock time right after the month is not a year')
eq(iso('remind me on 18 September at 9am to renew') === '2027-09-18T03:30:00.000Z', false, 'exactly 60 days back does not roll')
eq(iso('remind me on 17 September at 9am to renew'), '2027-09-17T03:30:00.000Z', '61 days back rolls')
eq(/9 Jan 2027/.test(buildReminderConfirmation(parseReminderIntent('remind me on 9 January at 10am to renew the car insurance') as any)), true, 'the confirmation shows the year when it is not this year')
eq(/2026/.test(buildReminderConfirmation(parseReminderIntent('remind me on 20 December at 9am to pay rent') as any)), false, 'no year shown for this year')

// 23 Nov live demo acceptance: the date in the task body overrode "in 3 minutes".
fixed = RealDate.parse('2026-11-23T07:39:00Z')
for(const text of [
  'Remind me in 3 minutes on WhatsApp to check AskGogo demo verification 23 Nov 1303.',
  'remind me in 3 mins to check the invoice dated 3 March',
  'remind me in 3 minutes about the meeting on 24 November at 5pm',
  'The train leaves in 2 days. Remind me in 3 minutes to check the ticket dated 23 November',
]){
  eq(reminderTimingProblem(text),null,`task date does not reject an explicit future countdown: ${text}`)
  eq(iso(text),'2026-11-23T07:42:00.000Z',`explicit reminder clause owns the countdown: ${text}`)
}
eq(iso('remind me in 2 hours about the invoice dated 3 March'),'2026-11-23T09:39:00.000Z','hours are also an explicit countdown')
const demo:any=parseReminderIntent('Remind me in 3 minutes on WhatsApp to check AskGogo demo verification 23 Nov 1303.')
eq(demo.message.includes('23 Nov 1303'),true,'the task date stays in the saved reminder message')
eq(iso('remind me on 24 November at 10am to check the delivery in 3 minutes'),'2026-11-24T04:30:00.000Z','a duration in the task never overrides the explicit scheduled date')
eq(/already passed/.test(String(reminderTimingProblem('remind me on 22 November at 10am to check the delivery in 3 minutes'))),true,'absolute past-date refusal remains intact')
eq(iso('remind me on 30 February at 10am to check the delivery in 3 minutes'),null,'invalid scheduled date remains refused')

fixed = RealDate.parse('2026-01-05T04:30:00Z') // 5 Jan 2026
eq(iso('remind me on 9 January at 10am to renew insurance'), '2026-01-09T04:30:00.000Z', 'in early January it is this January')
eq(iso('remind me on 25 December at 10am to call Nithin'), '2026-12-25T04:30:00.000Z', 'December is this year')
console.log(`PASS verify-reminder-year-rollover-nov17: ${checks} checks`)
