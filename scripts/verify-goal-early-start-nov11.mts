// The first reply starts what needs no answer, and looks at the calendar before asking (owner-approved mock, 11 Nov).
import assert from 'node:assert/strict'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
process.env.GOGO_GOAL_INTAKE = '-884501501'
const gi = await import('../lib/agent/goal-intake')
const NOW = new Date('2026-11-11T04:30:00Z') // 10:00 am IST, 11 Nov
const actor = { userId: 'u1', legacyTelegramId: -884501501, whatsappId: '918884501501', name: 'Goverdhan', timezone: 'Asia/Kolkata' } as any
const SENTENCE = 'Gogo, I need to organize a birthday, check flight prices for next month, prepare three business emails, find five suitable investors for AskGogo, and remind me about my meeting tomorrow.'
const LIST = { is_list: true, goals: [
  { kind: 'event', title: 'Organize a birthday', words: 'organize a birthday' },
  { kind: 'flight_prices', title: 'Flight prices for next month', words: 'check flight prices for next month' },
  { kind: 'email', title: 'Three business emails', words: 'prepare three business emails' },
  { kind: 'research', title: 'Five investors for AskGogo', words: 'find five suitable investors for AskGogo' },
  { kind: 'reminder', title: 'Meeting tomorrow', words: 'remind me about my meeting tomorrow', date: '2026-11-12' },
] }

// The flag: needs intake on, and its own switch.
eq([gi.goalEarlyStartEnabledFor('-884501501', {}), gi.goalEarlyStartEnabledFor('-884501501', { GOGO_GOAL_EARLY_START: 'on' }), gi.goalEarlyStartEnabledFor('-884501501', { GOGO_GOAL_INTAKE: '-884501501', GOGO_GOAL_EARLY_START: '-884501501' }), gi.goalEarlyStartEnabledFor('884501501', { GOGO_GOAL_INTAKE: 'on', GOGO_GOAL_EARLY_START: '-884501501' }), gi.goalEarlyStartEnabledFor('-884501501', { GOGO_GOAL_INTAKE: 'on' })],
  [false, false, true, false, false], 'off by default; needs goal intake and its own switch, for exact owner ids')

function world(o: { calendar?: any; early?: boolean; reminderOk?: boolean; capabilityOff?: (c: string) => boolean } = {}) {
  let stored: any = null
  const runs: any[] = [], saves: any[] = [], sent: string[] = [], events: string[] = [], emails: string[] = []
  const deps: any = {
    now: NOW, early: o.early ?? true, quickMs: 200,
    store: { load: async () => stored, save: async (_t: any, p: any) => { stored = JSON.parse(JSON.stringify(p)); saves.push(stored) }, clear: async () => { stored = null } },
    model: { list: async () => LIST, answers: async () => (world as any).answers },
    calendar: async (_a: any, date: string) => typeof o.calendar === 'function' ? o.calendar(date) : (o.calendar ?? { ok: false, events: [] }),
    background: (w: () => Promise<void>) => { void w() }, send: async (t: string) => { sent.push(t) },
    start: {
      capabilityOff: async (_a: any, c: string) => (o.capabilityOff ? o.capabilityOff(c) : false), eventsOn: () => true,
      event: async (_a: any, t: string) => { events.push(t); return 'Draft started.\n*x*' }, email: async (_a: any, t: string) => { emails.push(t); return 'Draft ready. Nothing has been sent.' },
      startRun: async ({ goal, step }: any) => { const id = `run-${runs.length + 1}`; runs.push({ id, goal: goal.id, kind: goal.kind, tool: step.tool, instruction: step.instruction, reminder: step.reminder || null })
        return { runId: id, drive: async () => step.tool === 'web_search' ? new Promise(r => setTimeout(() => r({ status: 'completed', text: 'Five funds found.' }), 600)) : { status: o.reminderOk === false && step.tool === 'reminders' ? 'failed' : 'completed', text: step.tool === 'reminders' ? `⏰ Reminder set: ${step.reminder.message}` : 'ok' } } },
    },
  }
  return { deps, runs, saves, sent, events, emails, stored: () => stored }
}
const THREE = { ok: true, events: [{ title: 'FnB daily syncup', time: '11:30' }, { title: 'Daily Connect-Standup', time: '11:30' }, { title: 'ONDC Food Readiness', time: '19:30' }] }

// 1. The acceptance sentence with a readable calendar: research and the reminders start in the first reply.
{ const w = world({ calendar: THREE })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/^On it, all 5\. 2 are already moving:/.test(r), `the first reply says what is already moving (${r.split('\n')[0]})`)
  ok(/• Meeting tomorrow: Thu 12 Nov: you have FnB daily syncup and Daily Connect-Standup at 11:30 am; ONDC Food Readiness at 7:30 pm\. Reminders set for 11:20 am and 7:20 pm, 10 minutes before\. Tell me if you want different times\./.test(r), 'the meetings come from the calendar, and one reminder is set 10 minutes before each start time')
  ok(/• Five investors for AskGogo: working on it; I’ll message you when it’s ready\./.test(r), 'research is under way and will report back')
  ok(/3 are waiting on you:/.test(r) && /Organize a birthday/.test(r) && /Flight prices for next month: Flying from where\? to where\? which date\?/i.test(r) && /Three business emails/.test(r), 'the three that need details are asked about')
  ok(!/What time should I remind you/.test(r), 'the meeting time is not asked for')
  eq(w.runs.map(x => [x.kind, x.tool, x.reminder && `${x.reminder.date} ${x.reminder.time}`]), [['reminder', 'reminders', '2026-11-12 11:20'], ['reminder', 'reminders', '2026-11-12 19:20'], ['research', 'web_search', null]], 'exactly two reminders and one research run were created')
  eq(w.runs[0].reminder.message, 'FnB daily syncup and Daily Connect-Standup at 11:30 am', 'two meetings at the same time share one reminder that names both')
  eq([w.events, w.emails], [[], []], 'no event and no email draft is started before "get it done"')
  const first = w.saves[0].goals.map((g: any) => [g.kind, g.state])
  eq(first.filter((x: any) => x[1] === 'started').map((x: any) => x[0]).sort(), ['reminder', 'research'], 'the goals are saved as started before anything starts, so a repeat cannot start them twice')
  eq(w.stored().goals.filter((g: any) => g.state === 'open').map((g: any) => g.kind).sort(), ['email', 'event', 'flight_prices'], 'the plan stays open for the other three')
  await new Promise(r => setTimeout(r, 700))
  ok(w.sent.length === 1 && /^\*Five investors for AskGogo\*\nFive funds found\./.test(w.sent[0]), 'the research result arrives as its own message when it finishes')
  // Then "get it done" with the details: the early ones are not started again.
  ;(world as any).answers = { about_plan: true, start: true, fills: [{ goal: 'g2', slot: 'from', value: 'Bengaluru' }, { goal: 'g2', slot: 'to', value: 'Goa' }, { goal: 'g2', slot: 'date', value: '2026-12-20' }], drop: ['g3'] }
  const before = w.runs.length
  const r2 = (await gi.tryGoalIntake(actor, 'Bengaluru to Goa on 20 December. Skip the emails. Get it done', w.deps))!
  eq(w.runs.slice(before).map(x => x.kind), ['flight_prices'], '"get it done" starts only what had not started')
  ok(/▶️ Meeting tomorrow: already under way from before\./.test(r2) && /▶️ Five investors for AskGogo: already under way from before\./.test(r2), 'and says the earlier ones are already under way') }

// 2. Calendar read but no timed meeting that day: nothing is guessed; the question says why it is asking.
{ const w = world({ calendar: { ok: true, events: [] } })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/Meeting tomorrow \(for Thu 12 Nov\): I don’t see a timed meeting on your calendar that day\. What time should I remind you\?/.test(r), 'no meeting found: asks the time and says the calendar had none')
  eq(w.runs.map(x => x.kind), ['research'], 'no reminder is created') }

// 3. Calendar not connected or unreadable: asked exactly as before.
{ const w = world({ calendar: { ok: false, events: [] } })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/Meeting tomorrow \(for Thu 12 Nov\): What time should I remind you\?/.test(r) && !/I don’t see/.test(r), 'no calendar: the plain question')
  const w2 = world({ calendar: () => { throw new Error('gcal_down') } })
  const r2 = (await gi.tryGoalIntake(actor, SENTENCE, w2.deps))!
  ok(/What time should I remind you\?/.test(r2) && w2.runs.every(x => x.kind !== 'reminder'), 'a failing calendar read is treated the same way') }

// 4. Reminders switched off: the calendar is not used to set any.
{ let read = 0
  const w = world({ calendar: () => { read++; return THREE }, capabilityOff: c => c === 'reminders' })
  await gi.tryGoalIntake(actor, SENTENCE, w.deps)
  eq([read, w.runs.filter(x => x.kind === 'reminder').length], [0, 0], 'reminders off: the calendar is not even read, and none is set') }

// 5. A reminder that could not be confirmed is not reported as set.
{ const w = world({ calendar: { ok: true, events: [{ title: 'Investor call', time: '15:00' }] }, reminderOk: false })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/you have Investor call at 3:00 pm\. I could not confirm the reminder for 2:50 pm; it is on your Tasks page\./.test(r) && !/Reminders set for/.test(r), 'an unconfirmed reminder is said to be unconfirmed') }

// 6. Meetings already past (or whose reminder time has passed) today are skipped; at most five are set.
{ const today = { ...LIST, goals: [...LIST.goals.slice(0, 4), { kind: 'reminder', title: 'Meetings today', words: 'remind me about my meetings today', date: '2026-11-11' }] }
  const w = world({ calendar: { ok: true, events: [{ title: 'Early sync', time: '09:00' }, { title: 'Soon', time: '10:05' }, { title: 'Lunch call', time: '13:00' }] } })
  w.deps.model.list = async () => today
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  eq(w.runs.filter(x => x.kind === 'reminder').map(x => x.reminder.time), ['12:50'], 'only a meeting whose reminder time is still ahead gets one (it is 10:00 am)')
  ok(/you have Lunch call at 1:00 pm\./.test(r) && !/Early sync|Soon/.test(r), 'and only that one is named')
  const many = world({ calendar: { ok: true, events: Array.from({ length: 9 }, (_, i) => ({ title: `M${i}`, time: `${String(11 + i).padStart(2, '0')}:00` })) } })
  await gi.tryGoalIntake(actor, SENTENCE, many.deps)
  eq(many.runs.filter(x => x.kind === 'reminder').length, gi.MAX_CALENDAR_REMINDERS, 'never more than five reminders from one day') }

// 7. A reminder that is not about a meeting is never taken from the calendar.
{ const other = { is_list: true, goals: [{ kind: 'reminder', title: 'Call the bank', words: 'remind me to call the bank tomorrow', date: '2026-11-12' }, { kind: 'todo', title: 'Renew passport', words: 'renew passport' }, { kind: 'research', title: 'Best CRM', words: 'find the best CRM' }] }
  let read = 0
  const w = world({ calendar: () => { read++; return THREE } })
  w.deps.model.list = async () => other
  const r = (await gi.tryGoalIntake(actor, 'I need to renew my passport, find the best CRM, and remind me to call the bank tomorrow', w.deps))!
  ok(/remind me to call the bank|Call the bank/.test(r) && /What time should I remind you\?/.test(r), 'a non-meeting reminder is asked about')
  eq([read, w.runs.map(x => x.kind).sort()], [0, ['research', 'todo']], 'the calendar is not read for it; the to-do and the research start at once') }

// 8. Off: the plan is exactly as it was.
{ const w = world({ calendar: THREE, early: false })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/^I count 5 things\. Here’s who does what:/.test(r) && w.runs.length === 0, 'early start off: the plan is shown and nothing starts')
  const prevE = process.env.GOGO_GOAL_EARLY_START; delete process.env.GOGO_GOAL_EARLY_START
  const w2 = world({ calendar: THREE }); delete w2.deps.early
  const r2 = (await gi.tryGoalIntake(actor, SENTENCE, w2.deps))!
  if (prevE !== undefined) process.env.GOGO_GOAL_EARLY_START = prevE
  ok(/^I count 5 things/.test(r2) && w2.runs.length === 0, 'and it is off unless its own switch is set') }

// 9. If the plan cannot be saved first, nothing starts.
{ const w = world({ calendar: THREE })
  let n = 0
  w.deps.store.save = async () => { if (n++ === 0) throw new Error('db') }
  const r = await gi.tryGoalIntake(actor, SENTENCE, w.deps)
  eq(w.runs.length, 0, 'no save, no start') ; ok(/^I count 5 things/.test(r || ''), 'the plan is shown as before') }

// 10. Events and emails that already have every detail still wait for "get it done".
{ const full = { is_list: true, goals: [{ kind: 'event', title: 'Divya’s birthday', words: 'plan Divya’s birthday', date: '2026-11-22', time: '17:00', topic: 'Divya’s birthday' }, { kind: 'email', title: 'Email Nithin', words: 'email Nithin the plan', recipient: 'Nithin', topic: 'the launch plan' }, { kind: 'research', title: 'Venues', words: 'find venues in Indiranagar' }] }
  const w = world({})
  w.deps.model.list = async () => full
  const r = (await gi.tryGoalIntake(actor, 'I need to plan Divya’s birthday, email Nithin the plan, and find venues in Indiranagar', w.deps))!
  eq([w.events, w.emails, w.runs.map(x => x.kind)], [[], [], ['research']], 'only the research starts; the event and the email wait')
  ok(/2 are waiting on you:/.test(r) && /Say \*get it done\* and I’ll start them/.test(r), 'and the reply says how to start them') }

console.log(`GOAL_EARLY_START_OK ${checks} checks`)
