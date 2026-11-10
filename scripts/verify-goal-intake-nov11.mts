// Addendum 5 (Goal-to-Done), phase 2: a list of goals on WhatsApp. Fixtures only: no model, no network, no database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.GOGO_GOAL_INTAKE = '-884501501'
const gi = await import('../lib/agent/goal-intake')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
const NOW = new Date('2026-11-10T18:00:00Z') // 11:30 pm IST, 10 Nov
const actor = { userId: 'u1', legacyTelegramId: -884501501, whatsappId: '918884501501', name: 'Goverdhan', timezone: 'Asia/Kolkata' } as any
const SENTENCE = 'Gogo, I need to organize a birthday, check flight prices for next month, prepare three business emails, find five suitable investors for AskGogo, and remind me about my meeting tomorrow.'

// 1. The gate and the flag.
ok(gi.looksLikeGoalList(SENTENCE), 'the acceptance sentence is a list')
ok(gi.looksLikeGoalList('Here are 10 things I need to finish this week: x'), '"here are ten things" is a list')
ok(gi.looksLikeGoalList('- call the bank\n- renew passport\n- book dentist'), 'a bulleted list is a list')
for (const t of ['remind me to call Divya tomorrow at 10 am', 'book a table for 4 at Toit tomorrow at 8 pm', 'Plan Nithin’s birthday dinner on 6 December at 8 pm for 20 people', 'what is the weather and is it going to rain', 'hi'])
  ok(!gi.looksLikeGoalList(t), `not a list: ${t}`)
eq([gi.goalIntakeEnabledFor('-884501501'), gi.goalIntakeEnabledFor('884501501'), gi.goalIntakeEnabledFor('-884501501', {}), gi.goalIntakeEnabledFor('-884501501', { GOGO_GOAL_INTAKE: 'off' })], [true, false, false, false], 'exact owner ids only; off by default')

// 2. What the model returns is checked; code decides ownership and what is missing.
const extraction = { is_list: true, goals: [
  { kind: 'event', title: 'Organize a birthday', words: 'organize a birthday' },
  { kind: 'flight_prices', title: 'Flight prices for next month', words: 'check flight prices for next month', date: 'next month' },
  { kind: 'email', title: 'Three business emails', words: 'prepare three business emails' },
  { kind: 'research', title: 'Five investors for AskGogo', words: 'find five suitable investors for AskGogo' },
  { kind: 'reminder', title: 'Meeting tomorrow', words: 'remind me about my meeting tomorrow', date: '2026-11-11' },
  { kind: 'reminder', title: 'meeting tomorrow', words: 'Remind me about my meeting tomorrow' },
  { kind: 'admin_override', title: 'Wire money', words: 'transfer funds' },
] }
const goals = gi.goalsFrom(extraction as any, '2026-11-10')
eq(goals.map(g => g.kind), ['event', 'flight_prices', 'email', 'research', 'reminder', 'other'], 'five goals plus one unknown kind kept as "other"; the repeated reminder is merged')
eq(goals.map(g => g.ownership), ['together', 'gogo_handles', 'together', 'gogo_handles', 'gogo_handles', 'your_turn'], 'ownership is decided by code from the kind')
eq(goals[1].slots, {}, '"next month" is not a date: it is asked for, never guessed')
eq(goals[4].slots, { date: '2026-11-11' }, 'tomorrow resolved; time still missing')
eq(gi.missingOf(goals[4]), ['time'], 'the reminder needs a time')
eq(gi.missingOf(goals[1]), ['from', 'to', 'date'], 'flights need a route and a date')
eq([gi.slotValue('date', '2026-11-09', '2026-11-10'), gi.slotValue('time', '25:00', ''), gi.slotValue('people', '-3', ''), gi.slotValue('from', 'Bengaluru; DROP TABLE', '')], [null, null, null, null], 'a past date, a bad time, a bad number or an odd city is treated as not stated')
eq(gi.goalsFrom({ is_list: false, goals: extraction.goals } as any, '2026-11-10'), [], 'the model saying it is not a list: no plan')
eq(gi.goalsFrom({ is_list: true, goals: [extraction.goals[0]] } as any, '2026-11-10'), [], 'one goal is not a list')
eq(gi.goalsFrom({ is_list: true, goals: Array.from({ length: 25 }, (_, i) => ({ kind: 'todo', title: `t${i}`, words: `t${i}` })) } as any, '2026-11-10').length, gi.MAX_GOALS, 'at most ten goals')

// 3. The conversation.
let stored: any = null
const store = { load: async () => stored, save: async (_: number, p: any) => { stored = JSON.parse(JSON.stringify(p)) }, clear: async () => { stored = null } }
let answers: any = null, listCalls = 0, answerCalls = 0
const model = { list: async () => { listCalls++; return extraction as any }, answers: async () => { answerCalls++; return answers } }
const startedRuns: any[] = [], events: string[] = [], emails: string[] = []
const start = {
  startRun: async ({ goal, step, plan }: any) => { startedRuns.push({ kind: goal.kind, ownership: goal.ownership, step, batch: plan.id }); return { runId: `run-${goal.id}`, drive: async () => goal.kind === 'reminder' ? { status: 'completed', text: '⏰ I’ll remind you about your meeting tomorrow at 10:30 am.' } : new Promise<any>(r => setTimeout(() => r({ status: 'completed', text: 'Found 5 results.' }), 60)) } },
  event: async (_a: any, t: string) => { events.push(t); return 'Draft started.\n\nNithin’s birthday…' },
  email: async (_a: any, t: string) => { emails.push(t); return '📧 Draft\n\nNothing has been sent.' },
  eventsOn: () => true,
  capabilityOff: async () => false,
}
const later: (() => Promise<void>)[] = [], sent: string[] = []
const deps = { model, store, start, now: NOW, timezone: 'Asia/Kolkata', quickMs: 20, background: (w: any) => { later.push(w) }, send: async (t: string) => { sent.push(t) } }
let r = await gi.tryGoalIntake(actor, SENTENCE, deps as any)
ok(r && /^I count 6 things\. Here’s who does what:/.test(r), 'the plan counts the goals')
ok(/\*Gogo handles\*[\s\S]*\*We do together\*[\s\S]*\*Your turn\*/.test(r!), 'grouped by who does it')
ok(/Meeting tomorrow \(for \d{4}-\d\d-\d\d\): What time should I remind you\?/.test(r!) && /Flight prices for next month: Flying from where\? to where\? which date\?/.test(r!), 'only the missing details are asked')
ok(/Three business emails: I’ll draft it; nothing is sent until you approve it\. Who is it to\? what should it say\?/.test(r!), 'emails: drafts only, approval before sending')
ok(/Say \*get it done\*|then say \*get it done\*/.test(r!) && startedRuns.length === 0, 'nothing starts before "get it done"')
eq(stored.goals.find((g: any) => g.kind === 'reminder').asked, ['time'], 'what was asked is remembered')

// Answers, without starting.
answers = { about_plan: true, start: false, fills: [{ goal: 'g5', slot: 'time', value: '10:30' }, { goal: 'g2', slot: 'from', value: 'Bengaluru' }, { goal: 'g2', slot: 'to', value: 'Delhi' }, { goal: 'g1', slot: 'date', value: '2026-12-06' }, { goal: 'g1', slot: 'people', value: '20' }, { goal: 'g9', slot: 'time', value: '09:00' }], drop: ['g6'] }
r = await gi.tryGoalIntake(actor, 'Blr to Delhi, meeting at 10:30. Birthday is Nithin’s on 6 Dec for 20 people. Skip the last one', deps as any)
ok(r && /^I count 5 things/.test(r), 'dropped goal gone')
ok(!/What time should I remind you|Flying from where\?/.test(r!), 'answered details are not asked again')
ok(!/to where\?/.test(r!) && !/Who is it to\?/.test(r!), 'and details already asked once are not asked a second time')
ok(/Say \*get it done\*/.test(r!) || /then say \*get it done\*/.test(r!), 'it says how to start')

// "get it done": the quick path without a model call.
const before = answerCalls
r = await gi.tryGoalIntake(actor, 'Get it done', deps as any)
eq(answerCalls, before, '"get it done" needs no model call')
ok(r && /^Started 3 of 5\./.test(r), `three of five started (${r?.split('\n')[0]})`)
eq(startedRuns.map(s => [s.kind, s.step.tool]).sort(), [['reminder', 'reminders'], ['research', 'web_search']].sort(), 'reminder and research start as durable runs (flights wait for a date)')
ok(startedRuns.every(s => s.batch === startedRuns[0].batch), 'all children carry the same list id')
eq(startedRuns.find(s => s.kind === 'reminder').step.reminder, { date: '2026-11-11', time: '10:30', message: 'My meeting' }, 'the reminder’s day, time and words are checked values, written by code')
{ const tricky = gi.stepFor({ id: 'g1', kind: 'reminder', title: 'Check report', words: 'remind me to check the report and book the 5 pm show on 12 Dec tomorrow', slots: { date: '2026-11-11', time: '09:00' }, ownership: 'gogo_handles', asked: [], state: 'open' })!
  eq([tricky.instruction, tricky.reminder], ['Set a reminder on 2026-11-11 at 9:00 am', { date: '2026-11-11', time: '09:00', message: 'Check the report and book the 5 pm show on 12 Dec' }], 'words with their own verbs, dates and times stay inside the message and never reach the sentence the tool reads')
  const mtSrc = readFileSync(new URL('../lib/agent/mission-tools.ts', import.meta.url), 'utf8'), pg = readFileSync(new URL('../lib/agent/persistent-general-plan.ts', import.meta.url), 'utf8')
  ok(/export async function executeExactMissionReminder[\s\S]{0,900}persistMissionReminder\([\s\S]{0,600}\.eq\('telegram_id',params\.actor\.legacyTelegramId\)[\s\S]{0,300}mission_reminder_write_unverified/.test(mtSrc), 'the exact reminder uses the same writer and reads the row back for this owner')
  ok(/metadata_json\?\.goal_reminder[\s\S]{0,900}verified:\(result\.output as any\)\?\.readBack === true/.test(pg), 'and the run is only verified when that read-back happened')
  const fl = gi.stepFor({ id: 'g2', kind: 'flight_prices', title: 'Flights', words: 'x', slots: { from: 'Bengaluru', to: 'Delhi', date: '2026-12-12' }, ownership: 'gogo_handles', asked: [], state: 'open' })!
  ok(/^(?:please )?(?:find|search|check|show|compare) (?:(?:non-?stop|direct|one[- ]way) )?flights from ([a-z .'-]{3,40}) to ([a-z .'-]{3,40}) on (20\d{2}-\d{2}-\d{2})[.!]?$/i.test(fl.instruction), 'the flight instruction fits the flight reader’s exact grammar') }
eq(startedRuns.find(s => s.kind === 'research').step.instruction, 'find five suitable investors for AskGogo', 'research uses the person’s own words')
ok(/✅ Meeting tomorrow: ⏰ I’ll remind you/.test(r!), 'a quick result is in the first reply')
ok(/⏳ Five investors for AskGogo: working on it\./.test(r!), 'a slow one says it is working')
ok(/⏸ Flight prices for next month: not started\. I still need which date\. Ask me for this one on its own when you have it\./.test(r!), 'a goal still missing a detail says it was not started and what it needs, and promises nothing it cannot keep')
ok(/⏸ Three business emails: not started\. I still need who is it to, what should it say\./.test(r!), 'the emails were not started without their details')
eq(events, ['organize a birthday on 2026-12-06 for 20 people'], 'the event goes to the Events flow with the details given')
ok(/\*Organize a birthday\*\nDraft started\./.test(r!), 'and its own reply is included')
eq(emails, [], 'no email was drafted without a recipient and a topic')
ok(/You can close WhatsApp/.test(r!), 'it says the work continues')
eq(stored, null, 'the plan is closed once started')
eq(later.length, 1, 'the slow ones finish in the background')
await later[0]()
eq(sent, ['*Five investors for AskGogo*\nFound 5 results.'], 'and each sends its own message when done')

// 4. Emails: one draft at a time; nothing sent.
stored = null; startedRuns.length = 0; emails.length = 0
const e2 = { is_list: true, goals: [
  { kind: 'email', title: 'Email Divya', words: 'email Divya about the offsite', recipient: 'Divya', topic: 'the offsite is moved to Friday' },
  { kind: 'email', title: 'Email Nithin', words: 'email Nithin about the invoice', recipient: 'Nithin', topic: 'please share the invoice' },
  { kind: 'todo', title: 'Call the bank', words: 'call the bank' },
] }
r = await gi.tryGoalIntake(actor, 'Here are 3 things: email Divya that the offsite is moved to Friday, email Nithin to share the invoice, call the bank', { ...deps, model: { ...model, list: async () => e2 as any } } as any)
eq(await gi.tryGoalIntake(actor, 'go ahead', deps as any), null, '"go ahead" belongs to other flows: it never starts a plan and is passed on')
eq([emails.length, startedRuns.length], [0, 0], 'and nothing started')
r = await gi.tryGoalIntake(actor, 'do them all', deps as any)
eq(emails, ['email Divya saying the offsite is moved to Friday'], 'only the first email is drafted, through the compose flow (draft only)')
ok(/⏸ Email Nithin: not started\. I keep one email draft at a time; ask me for this one after the first is sent or dropped\./.test(r!), 'the second email is not started while the first draft waits')
eq(startedRuns.map(s => [s.kind, s.ownership, s.step.instruction]), [['todo', 'your_turn', 'Add a task: Call the bank']], 'only the person can call the bank: it goes on their to-do list')

// 4b. Starting: only the exact phrase; switches and limits honoured.
{ stored = null; startedRuns.length = 0; events.length = 0
  await gi.tryGoalIntake(actor, SENTENCE, deps as any)
  const calls0 = answerCalls
  for (const t of ['yes', 'ok', 'confirm', 'do it', 'start', 'Go ahead.', 'yes cancel it']) eq(await gi.tryGoalIntake(actor, t, deps as any), null, `a bare "${t}" is passed on to whatever asked last`)
  eq([answerCalls, startedRuns.length, stored?.strays || 0], [calls0, 0, 0], 'with no model call, nothing started and the plan left as it was')
  answers = { about_plan: true, start: true, fills: [] }
  r = await gi.tryGoalIntake(actor, 'looks good to me', deps as any)
  ok(/^I count/.test(r!) && startedRuns.length === 0, 'the model thinking the person meant "start" starts nothing')
  answers = { about_plan: false, start: false, fills: [{ goal: 'g5', slot: 'time', value: '10:30' }] }
  r = await gi.tryGoalIntake(actor, 'meeting is at 10:30, get it done', { ...deps, start: { ...start, capabilityOff: async () => true } } as any)
  ok(/^Started /.test(r!), 'details and the start phrase in one message start the plan')
  ok(/⏸ Meeting tomorrow: reminders are switched off in your settings, so I did not set it\./.test(r!) && !startedRuns.some(s => s.kind === 'reminder'), 'reminders switched off in settings: the reminder is not created, and it says so')
  eq(await gi.tryGoalIntake(actor, 'get it done', deps as any), null, 'a second "get it done" starts nothing: the plan is gone')
  // The plan is marked started before anything starts; if that cannot be saved, nothing starts.
  stored = null; startedRuns.length = 0
  await gi.tryGoalIntake(actor, SENTENCE, deps as any)
  let saves = 0
  r = await gi.tryGoalIntake(actor, 'get it done', { ...deps, store: { ...store, save: async () => { saves++; throw new Error('db') } } } as any)
  eq([/couldn’t start these just now/.test(r!), startedRuns.length], [true, 0], 'the started mark could not be saved: nothing starts')
  let seen: any = null
  r = await gi.tryGoalIntake(actor, 'get it done', { ...deps, store: { ...store, save: async (_: number, p: any) => { seen = p; stored = p }, clear: async () => { throw new Error('clear failed') } } } as any)
  ok(seen?.started && /^Started /.test(r!), 'marked started first; a failed clean-up still returns the reply')
  eq(gi.readPlan(stored, NOW), null, 'and the stored, started plan can never be started again')
  stored = null
  // Only three runs work at once.
  let live = 0, peak = 0
  const many = gi.newPlan('x', Array.from({ length: 8 }, (_, i) => ({ id: `g${i + 1}`, kind: 'research' as const, title: `R${i}`, words: `find ${i}`, slots: {}, ownership: 'gogo_handles' as const, asked: [], state: 'open' as const })), NOW)
  const res = await gi.startGoals(actor, many, { capabilityOff: async () => false, startRun: async ({ goal }: any) => ({ runId: goal.id, drive: async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 15)); live--; return { status: 'completed', text: 'ok' } } }) } as any)
  await Promise.all(res.started.map(s => s.running))
  eq([res.started.length, peak <= gi.MAX_PARALLEL, peak], [8, true, 3], 'eight goals start, never more than three at work at once')
  // An event line that is not a new event (or that Events answers with a question) is not "started".
  const ev = gi.newPlan('x', [{ id: 'g1', kind: 'event', title: 'Publish party', words: 'publish Nithin’s party', slots: { date: '2026-12-06' }, ownership: 'together', asked: [], state: 'open' }, { id: 'g2', kind: 'todo', title: 'Call bank', words: 'call bank', slots: {}, ownership: 'your_turn', asked: [], state: 'open' }], NOW)
  const evRes = await gi.startGoals(actor, ev, { ...start, event: async () => 'What should I call the event?' } as any)
  eq([evRes.plan.goals[0].state, evRes.plan.goals[0].note, evRes.started.some(s => s.goal.id === 'g1')], ['held', 'event_not_started', false], 'an event goal counts as started only when a draft was really created')
  const src2 = readFileSync(new URL('../lib/agent/goal-intake.ts', import.meta.url), 'utf8')
  ok(/extract: async input => \{ const a = await extractEventAction\(input\); return a && a\.action === 'create' \? a : \(\{ action: 'none' \} as any\) \}/.test(src2), 'from a list, the Events flow may only create a draft: publish, change, cancel and guest actions are refused')
  // Reminder words keep a day word that is part of the sentence.
  eq(gi.stepFor({ id: 'g1', kind: 'reminder', title: 'Tell Divya', words: 'remind me to tell Divya that tomorrow’s offsite is cancelled', slots: { date: '2026-11-11', time: '09:00' }, ownership: 'gogo_handles', asked: [], state: 'open' })!.reminder!.message, 'Tell Divya that tomorrow’s offsite is cancelled', 'only a trailing day word is dropped from the reminder’s words')
  eq([gi.slotValue('date', '2027-02-31', '2026-11-10'), gi.slotValue('people', '1e3', ''), gi.slotValue('recipient', 'Nithin: cc ceo@x.com', ''), gi.slotValue('recipient', 'divya@example.com', '')], [null, null, null, 'divya@example.com'], 'an impossible date, an odd number and a recipient with separators are treated as not stated')
  const bad = JSON.parse(JSON.stringify(gi.newPlan('x', goals, NOW))); bad.goals[4].slots = { date: 'DROP', time: '99:99' }
  eq(gi.readPlan(bad, NOW)?.goals[4].slots, {}, 'stored details are checked again when a plan is read back')
  eq(gi.readPlan({ ...JSON.parse(JSON.stringify(gi.newPlan('x', goals, NOW))), at: new Date(NOW.getTime() + 3600_000).toISOString() }, NOW), null, 'a plan dated in the future is no plan')
  eq(await gi.tryGoalIntake({ ...actor, timezone: 'Mars/Phobos' }, SENTENCE, { ...deps, timezone: undefined } as any) !== null, true, 'an invalid stored timezone falls back instead of silently doing nothing')
  stored = null }

// 4c. The start phrase: exact, never negated, deferred or questioned.
for (const t of ['get it done', 'Get it done.', 'ok get it done', 'okay, get it done please', 'get it done now', 'Get it done, thanks', '*get it done*', 'please get them all done', 'do them all', 'start them', 'yes, do these', 'Blr to Delhi, meeting at 11, get it done', 'meeting is at 10:30. Get it done'])
  ok(gi.wantsStartPhrase(t), `starts: ${t}`)
for (const t of ['do not start them', 'don’t start them', "don't do them", 'hold on don’t do these', 'please don’t get it done', 'do not get it done', 'wait, never get it done', 'No, I’ll do them', 'I’ll do these', 'let me do them', 'I will get it done', 'not yet, I’ll tell you when to start them', 'should I say get it done', 'how do these', 'don’t get it done yet', 'can you get it done by Friday?', 'can you get it done?', 'get it done later', 'get it done after lunch', 'if the price is ok, get it done', 'yes', 'go ahead', 'start', 'do it', 'get the report done', 'done'])
  ok(!gi.wantsStartPhrase(t), `does not start: ${t}`)
{ stored = null; startedRuns.length = 0
  await gi.tryGoalIntake(actor, SENTENCE, deps as any)
  answers = { about_plan: true, start: true, fills: [] }
  for (const t of ['do not start them', 'No, I’ll do them', 'let me do them']) { await gi.tryGoalIntake(actor, t, deps as any) }
  eq(startedRuns.length, 0, 'a negated or "I will" reply starts nothing, even when the model says start')
  stored = null
  // Switches and time.
  const plan = gi.newPlan('x', [
    { id: 'g1', kind: 'research', title: 'Investors', words: 'find investors', slots: {}, ownership: 'gogo_handles', asked: [], state: 'open' },
    { id: 'g2', kind: 'reminder', title: 'Call', words: 'remind me to call Divya', slots: { date: '2026-11-10', time: '17:00' }, ownership: 'gogo_handles', asked: [], state: 'open' },
    { id: 'g3', kind: 'email', title: 'Email Divya', words: 'email Divya', slots: { recipient: 'Divya', topic: 'hello' }, ownership: 'together', asked: [], state: 'open' },
    { id: 'g4', kind: 'todo', title: 'Check passport expiry', words: 'check passport expiry', slots: {}, ownership: 'your_turn', asked: [], state: 'open' },
  ], NOW)
  const made: any[] = []
  const res = await gi.startGoals(actor, plan, { now: NOW, capabilityOff: async (_a: any, c: string) => c === 'browser', email: async () => 'Connect Google Workspace first so I can find the email thread.', startRun: async ({ goal, step }: any) => { made.push(step); return { runId: goal.id, drive: async () => ({ status: 'completed', text: 'ok' }) } } } as any)
  eq(res.plan.goals.map(g => [g.state, g.note || '']), [['held', 'browser_off'], ['held', 'time_passed'], ['held', 'email_not_started'], ['started', '']], 'web research switched off, a reminder time already gone, and an email with no draft are each held with their own reason')
  eq(made.map(s => s.instruction), ['Add a task: Remember to check passport expiry'], 'a to-do that begins like a planner step is phrased so the tasks tool keeps it')
  const txt = gi.startedText(res.plan, new Map())
  ok(/web research is switched off in your settings/.test(txt) && /that time has already passed\. Tell me a new time/.test(txt) && /Email Divya: no draft yet\. Connect Google Workspace first/.test(txt) && /^Started 1 of 4\./.test(txt), 'and the reply says each reason, counting only what really started') }
{ const pg3 = readFileSync(new URL('../lib/agent/persistent-general-plan.ts', import.meta.url), 'utf8'), cron = readFileSync(new URL('../app/api/cron/autonomous-runs/route.ts', import.meta.url), 'utf8')
  ok(/capabilityIsOff\(context\.actor\.legacyTelegramId, 'browser'\)\) return \{ status:'blocked' as const, error:'persistent_browser_permission_off' \}/.test(pg3), 'the web research switch is also checked when the run executes')
  ok(/goal_live_until: new Date\(Date\.now\(\) \+ 150_000\)\.toISOString\(\)/.test(pg3) && /typeof meta\.goal_live_until==='string'&&Date\.parse\(meta\.goal_live_until\)>Date\.now\(\)\)\{skipped\+\+;continue\}/.test(cron), 'the sweeper leaves a goal run alone while the request that created it is still driving it')
  ok(/includes\('persistent_reminder_permission_off'\)\) text = 'Reminders are switched off/.test(pg3), 'the "reminders are off" line is only for the reminder switch')
  ok(/missionText: step\.instruction,/.test(readFileSync(new URL('../lib/agent/goal-intake.ts', import.meta.url), 'utf8')), 'a goal run’s mission text is the checked instruction, not the first wording') }

// 4d. The phrase after other words starts the plan only when those words gave a detail for it.
for (const t of ['get it done 👍', 'get it done pls', 'just get it done', 'ok go ahead, get it done', 'sure, do them all']) ok(gi.wantsStartPhrase(t), `starts: ${t}`)
{ for (const t of ['nahi, get it done', 'mat karo, do them', 'ruko, start them', 'nevermind, do them', 'you said, get it done', 'maybe, get it done', 'Send Divya the docs, get it done', 'tomorrow, get it done']) {
    stored = null; startedRuns.length = 0; events.length = 0
    await gi.tryGoalIntake(actor, SENTENCE, deps as any)
    answers = { about_plan: true, start: true, fills: [] }
    r = await gi.tryGoalIntake(actor, t, deps as any)
    ok(startedRuns.length === 0 && events.length === 0 && /^I count/.test(r || ''), `words that gave no detail do not start the plan, which is shown again: ${t}`) }
  stored = null; startedRuns.length = 0
  await gi.tryGoalIntake(actor, SENTENCE, deps as any)
  answers = { about_plan: true, start: false, drop: ['g3'] }
  r = await gi.tryGoalIntake(actor, 'skip the emails, get it done', deps as any)
  ok(/^Started /.test(r!), 'dropping a goal and saying the phrase starts the rest')
  eq(gi.stepFor({ id: 'g1', kind: 'todo', title: 'Call Divya’s mom', words: 'x', slots: {}, ownership: 'your_turn', asked: [], state: 'open' })!.instruction, 'Add a task: Call Divya’s mom', 'a to-do keeps its apostrophe')
  const fl = gi.newPlan('x', [{ id: 'g1', kind: 'flight_prices', title: 'Goa flights', words: 'check return flights Bangalore to Goa for 2 adults and 2 kids under ₹30k', slots: { from: 'Bangalore', to: 'Goa', date: '2026-12-20' }, ownership: 'gogo_handles', asked: [], state: 'open' },
    { id: 'g2', kind: 'flight_prices', title: 'Delhi flights', words: 'check flight prices to Delhi', slots: { from: 'Bengaluru', to: 'Delhi', date: '2026-12-12' }, ownership: 'gogo_handles', asked: [], state: 'open' }], NOW)
  const made2: any[] = []
  const fr = await gi.startGoals(actor, fl, { now: NOW, capabilityOff: async () => false, startRun: async ({ goal, step }: any) => { made2.push(step.instruction); return { runId: goal.id, drive: async () => ({ status: 'completed', text: 'ok' }) } } } as any)
  eq([fr.plan.goals.map(g => g.note || g.state), made2], [['flight_details', 'started'], ['Compare flights from Bengaluru to Delhi on 2026-12-12']], 'a flight ask with travellers, a return or a budget is not searched as something simpler; a plain one is')
  ok(/ask me for this flight search on its own/.test(gi.startedText(fr.plan, new Map())), 'and the reply says why') }

// 5. Not about the plan; stale plans; a stored plan is re-checked.
stored = null
r = await gi.tryGoalIntake(actor, SENTENCE, deps as any)
answers = { about_plan: false, start: false }
eq(await gi.tryGoalIntake(actor, 'what is the weather today', deps as any), null, 'an unrelated message goes on to normal routing')
ok(stored && stored.strays === 1, 'the plan stays for one more message')
eq(await gi.tryGoalIntake(actor, 'and tomorrow?', deps as any), null, 'a second unrelated message also goes on')
eq(stored, null, 'and the plan is dropped, so a later "go ahead" cannot start it')
eq(gi.readPlan({ ...JSON.parse(JSON.stringify(gi.newPlan('x', goals, NOW))), at: new Date(NOW.getTime() - 3 * 3600_000).toISOString() }, NOW), null, 'a plan older than two hours is no plan')
eq(gi.readPlan({ ...JSON.parse(JSON.stringify(gi.newPlan('x', goals, NOW))), goals: [{ ...goals[0], kind: 'wire_transfer' }] }, NOW), null, 'a stored goal of an unknown kind invalidates the plan')
{ const p = gi.readPlan({ ...JSON.parse(JSON.stringify(gi.newPlan('x', goals, NOW))), goals: [{ ...goals[0], ownership: 'gogo_handles' }] }, NOW)
  eq(p?.goals[0].ownership, 'together', 'stored ownership is recomputed from the kind, never trusted') }
const answered = gi.applyAnswers(gi.newPlan('x', goals, NOW), { about_plan: true, start: false, fills: [{ goal: 'g5', slot: 'time', value: 'soon' }, { goal: 'g5', slot: 'admin', value: '1' }] } as any, '2026-11-10')
eq(answered.plan.goals[4].slots, { date: '2026-11-11' }, 'a bad fill or unknown slot is ignored')

// 6. Failure and isolation.
stored = null
eq(await gi.tryGoalIntake(actor, SENTENCE, { ...deps, model: { ...model, list: async () => { throw new Error('model down') } } } as any), null, 'a model failure falls back to normal routing')
eq(await gi.tryGoalIntake({ ...actor, legacyTelegramId: -5550001 }, SENTENCE, deps as any), null, 'another owner without the flag is never handled')
{ const s2 = { load: async (tg: number) => (tg === -884501501 ? stored : null), save: store.save, clear: store.clear }
  r = await gi.tryGoalIntake(actor, SENTENCE, { ...deps, store: s2 } as any)
  process.env.GOGO_GOAL_INTAKE = '-884501501,-5550001'
  eq(await gi.tryGoalIntake({ ...actor, legacyTelegramId: -5550001 }, 'get it done', { ...deps, store: s2 } as any), null, 'one owner’s "get it done" never starts another owner’s plan')
  process.env.GOGO_GOAL_INTAKE = '-884501501' }
{ let n = 0; stored = null
  await gi.tryGoalIntake(actor, SENTENCE, deps as any)
  await gi.tryGoalIntake(actor, 'get it done', { ...deps, start: { ...start, startRun: async () => { n++; throw new Error('db down') } } } as any)
  ok(n >= 1, 'a start that fails is reported, not retried blindly') }

// 7. Wiring and safety in source.
const src = readFileSync(new URL('../lib/agent/goal-intake.ts', import.meta.url), 'utf8'), route = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
ok(!/sendGmail|gmail\.users\.messages\.send|executeApproved|approve\(|agent_approvals/.test(src), 'intake never sends email or touches approvals itself')
ok(!/policy|sentinel|adaptive-trust|permission_level|permissionLevel|agent_permissions/i.test(src.replace(/^\s*\/\/.*$/gm, '')), 'intake grants no permissions and reads none except the owner’s own off switch (through capabilityIsOff)')
{ const pg2 = readFileSync(new URL('../lib/agent/persistent-general-plan.ts', import.meta.url), 'utf8')
  ok(/capabilityIsOff\(context\.actor\.legacyTelegramId, 'reminders'\)\) return \{ status:'blocked' as const, error:'persistent_reminder_permission_off' \}/.test(pg2), 'the reminder off switch is also checked when the run executes (so a resumed run obeys it)')
  ok(/goal_kind === 'research'[\s\S]{0,1200}if \(!sources\.length\) return \{ status:'blocked' as const, error:'goal_research_no_sources'/.test(pg2), 'research with no sources is not a finished task')
  const own = await import('../lib/agent/task-ownership')
  const checks = [...pg2.matchAll(/recordGoalVerification\(context, '([a-z_]+)'/g)].map(m => m[1])
  eq([checks.sort(), checks.every(c => own.VERIFICATION_CHECKS.has(c))], [['reminder_readback', 'todo_readback'], true], 'reminder and to-do runs record which code check read the result back; research records none (finding sources is not a check of the answer)')
  ok(/if \(!meta\.goal_batch_id\) return/.test(pg2) && /readBack === true\) await recordGoalVerification/.test(pg2), 'only for goal runs, and for a reminder only after the row was read back')
  eq(own.doneStateOf({ status: 'completed', metadata_json: { verification: { state: 'verified_completed', check: 'reminder_readback', at: new Date().toISOString() } } }), 'verified', 'which Tasks then shows as Done, checked')
  ok(/from\('agent_steps'\)\.select\('output_json'\)\.eq\('run_id', created\.runId\)\.eq\('telegram_id', String\(params\.actor\.legacyTelegramId\)\)/.test(pg2), 'the reply for a goal is read from what its own step produced, for this owner') }
const hook = route.indexOf("const intake = await import('@/lib/agent/goal-intake')"), eventsHook = route.indexOf("const entry = await import('@/lib/events/entry')")
ok(hook > 0 && hook < eventsHook, 'the WhatsApp hook runs before the Events early hook')
ok(/!preserveFriendFlow && !callCommand && !forwardedMessage && !approvalIntent\(text\) && process\.env\.VERCEL_ENV && process\.env\.GOGO_GOAL_INTAKE/.test(route), 'not for forwarded messages, approvals or calls; off without the flag')
const pgp = readFileSync(new URL('../lib/agent/persistent-general-plan.ts', import.meta.url), 'utf8')
ok(/export async function startPersistentGoalRun[\s\S]{0,400}if \(!PERSISTENT_SAFE_TOOLS\.has\(params\.step\.tool\)\) throw/.test(pgp), 'a goal run only uses the persistent planner’s safe tools')
ok(/requiresApproval: false, verificationRequired: true/.test(pgp.slice(pgp.indexOf('export async function startPersistentGoalRun'))), 'each goal run must verify its own result')
// Follow-ups to the #1483 review: the plan says back the details it holds; the email switch is respected.
{ const g = (o: any) => ({ id: 'g1', title: 'T', words: 'x', slots: {}, asked: [], state: 'open', ownership: 'gogo_handles', ...o })
  eq([gi.detailOf(g({ kind: 'reminder', slots: { date: '2026-11-12', time: '10:30' } })), gi.detailOf(g({ kind: 'flight_prices', slots: { from: 'Bengaluru', to: 'Goa', date: '2026-12-20' } })), gi.detailOf(g({ kind: 'email', slots: { recipient: 'Divya', topic: 'the launch plan' } })), gi.detailOf(g({ kind: 'flight_prices', slots: { to: 'Goa' } })), gi.detailOf(g({ kind: 'research' })), gi.detailOf(g({ kind: 'reminder' }))],
    ['for 2026-11-12 at 10:30', 'Bengaluru to Goa on 2026-12-20', 'to Divya, about “the launch plan”', 'to Goa', '', ''], 'each goal says back only the details it was given')
  const shown = gi.planText(gi.newPlan('x', [g({ kind: 'flight_prices', title: 'Goa flights', slots: { from: 'Bengaluru', to: 'Goa', date: '2026-12-20' } }), g({ id: 'g2', kind: 'reminder', title: 'Meeting reminder' })], NOW)).text
  ok(/1\. Goa flights \(Bengaluru to Goa on 2026-12-20\)/.test(shown) && /2\. Meeting reminder: /.test(shown), 'the plan shows held details before anything starts, and nothing invented for a goal with none')
  const mail = gi.newPlan('x', [g({ kind: 'email', title: 'Email Divya', ownership: 'together', slots: { recipient: 'Divya', topic: 'the launch plan' } })], NOW)
  let drafted = 0
  const res = await gi.startGoals(actor, mail, { now: NOW, capabilityOff: async (_a: any, c: string) => c === 'email', email: async () => { drafted++; return 'Draft ready. Nothing has been sent.' } } as any)
  ok(drafted === 0 && res.plan.goals[0].note === 'email_off' && /email is switched off in your settings/.test(gi.startedText(res.plan, new Map())), 'email switched off: no draft is made and the reply says why') }
{ const g = (o: any) => ({ id: 'g1', title: 'T', words: 'x', slots: {}, asked: [], state: 'open', ownership: 'together', ...o })
  eq([gi.detailOf(g({ kind: 'event', slots: { time: '19:00' } })), gi.detailOf(g({ kind: 'event', slots: { date: '2026-11-20', people: '12' } })), gi.detailOf(g({ kind: 'email', slots: { recipient: 'Divya', topic: `*get it done* ” (approved) ${'z'.repeat(120)}` } })).length < 110, /[*”]\s*\(approved\)/.test(gi.detailOf(g({ kind: 'email', slots: { topic: '*get it done* ” (approved)' } })))],
    ['at 19:00', 'on 2026-11-20, for 12 people', true, false], 'details read naturally, a long topic is marked as cut, and formatting marks are not shown')
  const two = gi.newPlan('x', [g({ kind: 'email', title: 'Email Divya', slots: { recipient: 'Divya', topic: 'a' } }), g({ id: 'g2', kind: 'email', title: 'Email Nithin', slots: { recipient: 'Nithin', topic: 'b' } }), g({ id: 'g3', kind: 'todo', title: 'Call the bank', ownership: 'your_turn' })], NOW)
  let drafts = 0; const ran: string[] = []
  const res = await gi.startGoals(actor, two, { now: NOW, capabilityOff: async (_a: any, c: string) => c === 'email', email: async () => { drafts++; return 'Nothing has been sent.' }, startRun: async ({ goal }: any) => { ran.push(goal.id); return { runId: goal.id, drive: async () => ({ status: 'completed', text: 'ok' }) } } } as any)
  eq([drafts, res.plan.goals.map(x => x.note || x.state), ran], [0, ['email_off', 'email_off', 'started'], ['g3']], 'email off: both email goals are held for that reason and the rest still start')
  ok(/set email autonomy to draft/.test(gi.startedText(res.plan, new Map())), 'and the reply says how to switch it back on') }
console.log(`GOAL_INTAKE_OK ${checks} checks`)
