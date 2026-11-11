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
  { kind: 'reminder', title: 'Meetings tomorrow', words: 'remind me about my meetings tomorrow', date: '2026-11-12' },
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
  ok(/^On it\. 2 of 5 are already moving:/.test(r), `the first reply says what is already moving (${r.split('\n')[0]})`)
  ok(/• Meetings tomorrow: Thu 12 Nov: you have FnB daily syncup and Daily Connect-Standup at 11:30 am; ONDC Food Readiness at 7:30 pm\. Reminders set for 11:20 am and 7:20 pm, 10 minutes before\. Say \*my reminders\* to see or change them\./.test(r), 'the meetings come from the calendar, and one reminder is set 10 minutes before each start time')
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
  ok(/▶️ Meetings tomorrow: already under way from before\./.test(r2) && /▶️ Five investors for AskGogo: already under way from before\./.test(r2), 'and says the earlier ones are already under way') }

// 2. Calendar read but no timed meeting that day: nothing is guessed; the question says why it is asking.
{ const w = world({ calendar: { ok: true, events: [] } })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/Meetings tomorrow \(for Thu 12 Nov\): I don’t see a timed meeting on your calendar that day\. What time should I remind you\?/.test(r), 'no meeting found: asks the time and says the calendar had none')
  eq(w.runs.map(x => x.kind), ['research'], 'no reminder is created') }

// 3. Calendar not connected or unreadable: asked exactly as before.
{ const w = world({ calendar: { ok: false, events: [] } })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/Meetings tomorrow \(for Thu 12 Nov\): What time should I remind you\?/.test(r) && !/I don’t see/.test(r), 'no calendar: the plain question')
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
  ok(/you have Investor call at 3:00 pm\. I could not set the reminder for 2:50 pm\./.test(r) && !/Reminders set for/.test(r), 'a reminder that did not complete is said not to be set') }

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
{ const many = world({ calendar: { ok: true, events: Array.from({ length: 9 }, (_, i) => ({ title: `M${i}`, time: `${String(11 + i).padStart(2, '0')}:00` })) } })
  const r = (await gi.tryGoalIntake(actor, SENTENCE, many.deps))!
  ok(/4 later meetings that day have no reminder; ask me if you want one\./.test(r), 'the meetings left out by the cap are said') }

// Review, 11 Nov: one meeting asked about and several found: asked which, nothing set.
{ const one = { ...LIST, goals: [...LIST.goals.slice(0, 4), { kind: 'reminder', title: 'Meeting tomorrow', words: 'remind me about my meeting tomorrow', date: '2026-11-12' }] }
  const w = world({ calendar: THREE }); w.deps.model.list = async () => one
  const r = (await gi.tryGoalIntake(actor, SENTENCE, w.deps))!
  ok(/Meeting tomorrow \(for Thu 12 Nov\): That day you have FnB daily syncup and Daily Connect-Standup at 11:30 am; ONDC Food Readiness at 7:30 pm\. Which one, and what time should I remind you\?/.test(r), '"my meeting" with three on the calendar: asks which, listing them')
  eq(w.runs.filter(x => x.kind === 'reminder').length, 0, 'and sets none')
  // A named one is picked without asking.
  const named = { ...LIST, goals: [...LIST.goals.slice(0, 4), { kind: 'reminder', title: 'ONDC meeting', words: 'remind me about the ONDC Food Readiness meeting tomorrow', date: '2026-11-12' }] }
  const w2 = world({ calendar: THREE }); w2.deps.model.list = async () => named
  await gi.tryGoalIntake(actor, SENTENCE, w2.deps)
  eq(w2.runs.filter(x => x.kind === 'reminder').map(x => x.reminder.time), ['19:20'], 'a meeting named in the words is the one reminded about')
  // The calendar is looked at once per plan, not again on every answer.
  let reads = 0
  const w3 = world({ calendar: () => { reads++; return { ok: true, events: [] } } }); w3.deps.model.list = async () => one
  await gi.tryGoalIntake(actor, SENTENCE, w3.deps)
  ;(world as any).answers = { about_plan: true, start: false, fills: [{ goal: 'g1', slot: 'topic', value: 'Divya’s birthday' }] }
  await gi.tryGoalIntake(actor, 'It is Divya’s birthday', w3.deps)
  eq(reads, 1, 'one calendar read per plan')
  // Nothing created at all: the goal goes back to being asked about, not reported as under way.
  const w4 = world({ calendar: THREE }); w4.deps.start.startRun = async ({ step, goal }: any) => { if (step.tool === 'reminders') throw new Error('db'); return { runId: goal.id, drive: async () => ({ status: 'completed', text: 'ok' }) } }
  const r4 = (await gi.tryGoalIntake(actor, SENTENCE, w4.deps))!
  ok(!/Reminders set|Tasks page/.test(r4.split('waiting on you')[0]) && /Meetings tomorrow \(for Thu 12 Nov\): What time should I remind you\?/.test(r4), 'no reminder could be created: asked about, nothing claimed') }

// Review, 11 Nov: things to do that mention a meeting or a call are not meeting reminders.
for (const t of ['remind me to cancel the meeting tomorrow', 'remind me to book an appointment with the dentist tomorrow', 'remind me to give Divya a call tomorrow', 'remind me to make the call tomorrow', 'remind me to prepare for the interview', 'sync my contacts tomorrow', 'send the calendar invite to Divya', 'call the bank tomorrow'])
  ok(!gi.meetingReminderWords(t), `not a meeting reminder: ${t}`)
for (const t of ['remind me about my meeting tomorrow', 'remind me about my meetings tomorrow', 'remind me before the investor call tomorrow', 'remind me of tomorrow’s standup', 'remind me about all my meetings today', 'remind me about the call with Nithin'])
  ok(gi.meetingReminderWords(t), `a meeting reminder: ${t}`)

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

// The real calendar read: full reads only; declined, free, all-day and non-meeting blocks skipped; a series entered as
// one long entry counts on the day at its start time; nothing is remembered as the person's selection.
{ const out = (events: any[], o: any = {}) => ({ mode: 'read', complete: true, timezone: 'Asia/Kolkata', entryCount: events.length, events, ...o })
  const ev = (summary: string, start: string, end = '', x: any = {}) => ({ summary, start, end, ...x })
  const day = gi.calendarDayFrom(out([
    ev('FnB daily syncup', '2026-11-12T11:30:00+05:30', '2026-11-12T12:00:00+05:30'),
    ev('Daily Connect-Standup Call', '2026-10-20T11:30:00+05:30', '2026-11-30T11:45:00+05:30'),
    ev('Declined review', '2026-11-12T15:00:00+05:30', '', { attendees: [{ self: true, responseStatus: 'declined' }] }),
    ev('Hold', '2026-11-12T16:00:00+05:30', '', { transparency: 'transparent' }),
    ev('Lunch', '2026-11-12T13:00:00+05:30'), ev('Focus time', '2026-11-12T14:00:00+05:30'),
    ev('Holiday', '2026-11-12'), ev('Yesterday thing', '2026-11-11T18:00:00+05:30', '2026-11-11T19:00:00+05:30'),
    ev('ONDC Food Readiness', '2026-11-12T14:00:00Z'),
  ]), '2026-11-12', 'Asia/Kolkata')
  eq(day, { ok: true, skipped: 4, events: [{ title: 'FnB daily syncup', time: '11:30' }, { title: 'Daily Connect-Standup Call', time: '11:30' }, { title: 'ONDC Food Readiness', time: '19:30' }] }, 'declined, free and non-meeting blocks skipped; the long series counts at its time; other days left out')
  for (const bad of [out([], { complete: false }), out([ev('x', '2026-11-12T10:00:00+05:30')], { entryCount: 13 }), { mode: 'held', events: [] }, null])
    eq(gi.calendarDayFrom(bad, '2026-11-12', 'Asia/Kolkata').ok, false, 'a partial, truncated or held read is not used')
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/agent/goal-intake.ts', import.meta.url), 'utf8')
  ok(/executeReadOnlyCalendarStep\(\{ actor, instruction: `Show my calendar on \$\{date\}`, missionText: `Show my calendar on \$\{date\}`, rememberSelection: false \}\)/.test(src) && !/readTomorrowSchedule/.test(src), 'the calendar is read without remembering a selection') }
// Second review: answering "which one" sets the reminder before that meeting; a passed time is asked again.
{ const one = { ...LIST, goals: [...LIST.goals.slice(0, 4), { kind: 'reminder', title: 'Meeting tomorrow', words: 'remind me about my meeting tomorrow', date: '2026-11-12' }] }
  for (const [reply, fills, want] of [['the 11:30 one', [], '11:20'], ['the ONDC one', [], '19:20'], ['the 7:30 one', [{ goal: 'g5', slot: 'time', value: '19:30' }], '19:20'], ['remind me at 7 pm for the ONDC one', [{ goal: 'g5', slot: 'time', value: '19:00' }], '19:00']] as const) {
    const w = world({ calendar: THREE }); w.deps.model.list = async () => one
    await gi.tryGoalIntake(actor, SENTENCE, w.deps)
    ;(world as any).answers = { about_plan: true, start: false, fills }
    await gi.tryGoalIntake(actor, reply, w.deps)
    eq(w.runs.filter(x => x.kind === 'reminder').map(x => x.reminder.time), [want], `"${reply}" sets the reminder for ${want}`) } }
{ const past = { is_list: true, goals: [{ kind: 'reminder', title: 'Pay rent', words: 'remind me to pay rent today at 7 am', date: '2026-11-11', time: '07:00' }, { kind: 'research', title: 'Best CRM', words: 'find the best CRM' }, { kind: 'todo', title: 'Renew passport', words: 'renew passport' }] }
  const w = world({}); w.deps.model.list = async () => past
  const r = (await gi.tryGoalIntake(actor, 'I need to renew my passport, find the best CRM, and remind me to pay rent today at 7 am', w.deps))!
  ok(/Pay rent \(for Wed 11 Nov\): What time should I remind you\?/.test(r) && !/already passed/.test(r), 'a reminder whose time has passed is asked for a new time, so the answer reaches it')
  ;(world as any).answers = { about_plan: true, start: false, fills: [{ goal: 'g1', slot: 'time', value: '18:00' }] }
  await gi.tryGoalIntake(actor, '6 pm', w.deps)
  eq(w.runs.filter(x => x.kind === 'reminder').map(x => x.reminder.time), ['18:00'], 'and the new time is set') }
{ const day = gi.calendarDayFrom({ mode: 'read', complete: true, timezone: 'Asia/Kolkata', entryCount: 4, events: [
    { summary: 'Lunch with investor', start: '2026-11-12T13:00:00+05:30' }, { summary: 'Lunch', start: '2026-11-12T13:30:00+05:30' },
    { summary: 'Ends at midnight', start: '2026-11-10T10:00:00+05:30', end: '2026-11-12T00:00:00+05:30' }, { summary: '*Board* review', start: '2026-11-12T16:00:00+05:30' }] }, '2026-11-12', 'Asia/Kolkata')
  eq(day.events, [{ title: 'Lunch with investor', time: '13:00' }, { title: 'Board review', time: '16:00' }], 'a title that only starts with "Lunch" is a meeting; an entry over at midnight is not; formatting marks are dropped') }
console.log(`GOAL_EARLY_START_OK ${checks} checks`)
