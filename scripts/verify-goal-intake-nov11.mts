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
ok(/Meeting tomorrow: What time should I remind you\?/.test(r!) && /Flight prices for next month: Flying from where\? to where\? which date\?/.test(r!), 'only the missing details are asked')
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
ok(/⏸ Flight prices for next month: waiting for which date\./.test(r!), 'a goal still missing a detail says what it waits for, without asking again')
ok(/⏸ Three business emails: waiting for who is it to, what should it say\./.test(r!), 'the emails wait for their details')
eq(events, ['organize a birthday on 2026-12-06 for 20 people'], 'the event goes to the Events flow with the details given')
ok(/\*Organize a birthday\*\nDraft started\./.test(r!), 'and its own reply is included')
eq(emails, [], 'no email was drafted without a recipient and a topic')
ok(/You can close WhatsApp/.test(r!), 'it says the work continues')
eq(stored, null, 'the plan is closed once started')
eq(later.length, 1, 'the slow ones finish in the background')
await later[0]()
eq(sent, ['Five investors for AskGogo: Found 5 results.'], 'and each sends its own message when done')

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
ok(/⏸ Email Nithin: next, once you send or drop the first email draft\./.test(r!), 'the second waits for the first')
eq(startedRuns.map(s => [s.kind, s.ownership, s.step.instruction]), [['todo', 'your_turn', 'Add a to-do: Call the bank']], 'only the person can call the bank: it goes on their to-do list')

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
  const res = await gi.startGoals(actor, many, { startRun: async ({ goal }: any) => ({ runId: goal.id, drive: async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 15)); live--; return { status: 'completed', text: 'ok' } } }) } as any)
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
  ok(/goal_kind === 'research'[\s\S]{0,500}if \(!sources\.length\) return \{ status:'blocked' as const, error:'goal_research_no_sources'/.test(pg2), 'research with no sources is not a finished task')
  const own = await import('../lib/agent/task-ownership')
  const checks = [...pg2.matchAll(/recordGoalVerification\(context, '([a-z_]+)'/g)].map(m => m[1])
  eq([checks.sort(), checks.every(c => own.VERIFICATION_CHECKS.has(c))], [['reminder_readback', 'research_sources_readback', 'todo_readback'], true], 'goal runs record which code check read the result back, and each is one Tasks accepts as "checked"')
  ok(/if \(!meta\.goal_batch_id\) return/.test(pg2) && /readBack === true\) await recordGoalVerification/.test(pg2), 'only for goal runs, and for a reminder only after the row was read back')
  eq(own.doneStateOf({ status: 'completed', metadata_json: { verification: { state: 'verified_completed', check: 'reminder_readback', at: new Date().toISOString() } } }), 'verified', 'which Tasks then shows as Done, checked')
  ok(/from\('agent_steps'\)\.select\('output_json'\)\.eq\('run_id', created\.runId\)\.eq\('telegram_id', String\(params\.actor\.legacyTelegramId\)\)/.test(pg2), 'the reply for a goal is read from what its own step produced, for this owner') }
const hook = route.indexOf("const intake = await import('@/lib/agent/goal-intake')"), eventsHook = route.indexOf("const entry = await import('@/lib/events/entry')")
ok(hook > 0 && hook < eventsHook, 'the WhatsApp hook runs before the Events early hook')
ok(/!preserveFriendFlow && !callCommand && !forwardedMessage && !approvalIntent\(text\) && process\.env\.VERCEL_ENV && process\.env\.GOGO_GOAL_INTAKE/.test(route), 'not for forwarded messages, approvals or calls; off without the flag')
const pgp = readFileSync(new URL('../lib/agent/persistent-general-plan.ts', import.meta.url), 'utf8')
ok(/export async function startPersistentGoalRun[\s\S]{0,400}if \(!PERSISTENT_SAFE_TOOLS\.has\(params\.step\.tool\)\) throw/.test(pgp), 'a goal run only uses the persistent planner’s safe tools')
ok(/requiresApproval: false, verificationRequired: true/.test(pgp.slice(pgp.indexOf('export async function startPersistentGoalRun'))), 'each goal run must verify its own result')
console.log(`GOAL_INTAKE_OK ${checks} checks`)
