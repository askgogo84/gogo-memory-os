// Muse parity batch 1 (10 Oct live tests): cases 07, 26, 29, 35, the repeated "needs verification"
// status lines, and the Toit reviews page.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 26: a weekday alone no longer turns a task into a reminder; explicit reminders still do.
const { detectIntent } = await import('../lib/bot/detect-intent.ts')
assert.notEqual((await detectIntent("From my saved notes, prep a 30-minute plan for Sunday's cricket coaching session.")).type, 'set_reminder')
assert.notEqual((await detectIntent('Make a packing list for Friday')).type, 'set_reminder')
assert.equal((await detectIntent('Remind me to call Srini on Sunday at 5 pm')).type, 'set_reminder')
assert.equal((await detectIntent('call mom tomorrow at 6 pm')).type, 'set_reminder', 'a bare time-cued note is still a reminder')
assert.equal((await detectIntent('Plan a reminder for Sunday to pay rent')).type, 'set_reminder', 'asking for a reminder wins')

// 29: plain usage questions use the meter.
const { isUsageCommand } = await import('../lib/bot/process-message.ts')
for (const t of ['How much of my plan have I used this month?', "what's my usage", 'how many credits do I have left', 'usage', 'show my plan usage this month']) assert.equal(isUsageCommand(t), true, t)
for (const t of ['how much is the plan', 'plan a trip to Goa', 'what is the usage of turmeric']) assert.equal(isUsageCommand(t), false, t)

// 07: "then move it to 5 pm" sets the final time and leaves the title clean.
const { parseCalendarCreate } = await import('../lib/bot/handlers/calendar-actions.ts')
const ev: any = parseCalendarCreate('Add a meeting with Srini tomorrow at 4 pm, then move it to 5 pm.')
assert.ok(ev && !ev.needsTime && !ev.needsDate, JSON.stringify(ev))
assert.doesNotMatch(JSON.stringify(ev), /then move it/i)
assert.match(JSON.stringify(ev), /17:00|T17|5:00\s*pm|"hour":17/i, JSON.stringify(ev))

// 35: daily reminders across a date range; failures are logged with the step and error.
const mt = readFileSync('lib/agent/mission-tools.ts', 'utf8')
assert.match(mt, /const daily=await dailyMissionReminders\(\{actor,step,missionText\}\)\s*if\(daily\)return daily/)
assert.match(mt, /created\.length<21/)
assert.match(mt, /\|\|'19:00'/)
assert.match(readFileSync('lib/agent/general-planner.ts', 'utf8'), /GENERAL_PLAN_STEP_FAILED:/)

// Status digest: one line per task title; unverified outcomes stop after two days.
const pulse = readFileSync('lib/agent/autonomy-pulse.ts', 'utf8')
assert.match(pulse, /if\(seenRunTitles\.has\(titleKey\)\)continue/)
assert.match(pulse, /outcome_unknown'&&ageHours>48\)continue/)

// 04: the booking page, not reviews; plain language.
const rr = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
assert.match(rr, /reviews\?\|menu\|photos\?/)
assert.doesNotMatch(rr, /invent a release time|blocked read-only inspection/)

console.log('Muse batch 1 fixes: reminders hijack, usage, calendar move, daily reminders, status dedupe, booking page')
