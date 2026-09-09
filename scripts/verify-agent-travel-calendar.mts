import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseTravelCalendarPlan } from '../lib/agent/travel-calendar-plan'

const positives = [
  ['Find my Dubai flight and add it to my calendar', 'Dubai flight'],
  ['locate my New York flight then put it on my calender', 'New York flight'],
  ['get my BLR to DXB flight and schedule it in my calandar', 'BLR to DXB flight'],
] as const
for (const [text, target] of positives) {
  const plan = parseTravelCalendarPlan(text)
  assert.ok(plan, `should parse: ${text}`)
  assert.equal(plan.target, target)
}

for (const text of [
  'Add a meeting tomorrow at 4 pm',
  'Find my passport and remind me before it expires',
  'Find my hotel and add it to my calendar',
  'What is on my calendar?',
]) {
  assert.equal(parseTravelCalendarPlan(text), null, `must not claim: ${text}`)
}

const planSource = fs.readFileSync(new URL('../lib/agent/travel-calendar-plan.ts', import.meta.url), 'utf8')
const executeRoute = fs.readFileSync(new URL('../app/api/agent/runs/[id]/execute/route.ts', import.meta.url), 'utf8')

assert.match(planSource, /action_type:'calendar_change'/, 'Calendar mutation must use calendar_change approval')
assert.match(planSource, /stepState\(steps\[3\],'waiting_approval'\)/, 'calendar.create step must visibly wait for approval')
assert.ok(planSource.indexOf("action_type:'calendar_change'") < planSource.lastIndexOf('createCalendarEventAtIso('), 'approval preparation must appear before the actual Calendar write path')
assert.ok((planSource.match(/calendarEnabled\(tg\)/g) || []).length >= 2, 'Safe Mode Calendar permission must be checked at prepare and execute time')
assert.ok(!/\bpnr\b/i.test(planSource), 'PNR must not be copied into the compound Calendar plan')
assert.match(executeRoute, /memory_ticket_to_calendar/, 'approved execution route must recognize the compound plan')
assert.match(executeRoute, /executeApprovedTravelCalendarPlan/, 'approved compound plan must use its guarded executor')

console.log('✅ agent Memory → Calendar approval checks passed')
