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

fixed = RealDate.parse('2026-01-05T04:30:00Z') // 5 Jan 2026
eq(iso('remind me on 9 January at 10am to renew insurance'), '2026-01-09T04:30:00.000Z', 'in early January it is this January')
eq(iso('remind me on 25 December at 10am to call Nithin'), '2026-12-25T04:30:00.000Z', 'December is this year')
console.log(`PASS verify-reminder-year-rollover-nov17: ${checks} checks`)
