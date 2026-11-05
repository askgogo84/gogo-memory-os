// 5 Nov live: "plan my day" was answered from memory ("nothing else scheduled") despite 3 meetings, and the
// briefing led with a weeks-old test task and showed no meetings.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'test'
const brain = await import('../lib/agent/brain')
for (const t of ['plan my day', 'Plan my day tomorrow', 'help me plan today', 'can you plan my day?', 'day plan', 'plan my schedule', 'organise my morning'])
  assert.equal(brain.isExactCommand(t), true, `day plan goes to its handler: ${t}`)
for (const t of ['what should I plan for dinner', 'plan a trip to Goa', 'my day was long', 'show my reminders'])
  assert.equal(brain.isExactCommand(t), false, `not a day plan: ${t}`)
const dp = await import('../lib/agent/day-plan')
for (const t of ['plan my day', 'Plan my day tomorrow', 'help me plan today', 'can you plan my day?']) assert.ok(dp.dayPlanRequest(t), `the day-plan handler accepts: ${t}`)
console.log('✓ day plans skip the brain and reach the calendar-aware handler')

const b = readFileSync('app/api/briefing/route.ts', 'utf8')
assert.match(b, /\.from\('todos'\)[\s\S]{0,400}\.order\('created_at', \{ ascending: false \}\)/, 'newest tasks first')
assert.match(b, /Date\.now\(\) - Date\.parse\(String\(t\.created_at \|\| ''\)\) <= 7 \* 86_400_000/, 'only a task from the last week can be top priority')
assert.match(b, /if \(!\/\^\[1-9\]\\d\{0,14\}\$\/\.test\(id\)\) return \[\]/, 'only a safe integer id reaches the calendar reader')
assert.match(b, /formatCalendar\(ctx\),\n\s+formatReminderBlock\(ctx\),/, 'calendar section before reminders')
assert.match(b, /Next up: \$\{nextMeeting\.time/, 'next meeting can lead')
assert.match(b, /setTimeout\(\(\) => r\(null\), 3000\)/, 'a slow calendar never holds the briefing')
// shortTask behaviour (copied from the route): first sentence, at most 90 characters.
const shortTask = (text: string) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); const first = t.split(/(?<=[.!?])\s/)[0]; return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first }
assert.ok(b.includes("const first = t.split(/(?<=[.!?])\\s/)[0]"))
assert.equal(shortTask('Pack kitchen (30-minute sessions). Include subtasks for each session: glassware'), 'Pack kitchen (30-minute sessions).')
assert.ok(shortTask('x'.repeat(120)).length <= 90)
console.log('✓ briefing: meetings shown, next meeting can lead, fresh tasks only, safe id, time-boxed')
console.log('Day plan and briefing checks passed')
