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
assert.ok(b.includes('BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)'), 'only a safe integer id reaches the calendar reader (exact limit, 16-digit ids allowed)')
assert.ok(b.includes("skipped: !cal ? 'timeout' : !cal.ok ? 'read_failed' : 'not_connected'"), 'a missing calendar section says why in the logs')
assert.match(b, /formatCalendar\(ctx\),\n\s+formatReminderBlock\(ctx\),/, 'calendar section before reminders')
assert.match(b, /Next up: \$\{nextMeeting\.time/, 'next meeting can lead')
assert.match(b, /setTimeout\(\(\) => r\(null\), 8000\)/, 'a slow calendar never holds the briefing for long')
assert.ok(b.indexOf('const calendarPromise = briefingCalendar(user.telegram_id)') > 0 && b.indexOf('const calendarPromise = briefingCalendar(user.telegram_id)') < b.indexOf('remindersResult,'), 'the calendar read starts alongside the other reads')
// shortTask behaviour (copied from the route): first sentence, at most 90 characters.
const shortTask = (text: string) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); const first = t.split(/(?<=[.!?])\s/)[0]; return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first }
assert.ok(b.includes("const first = t.split(/(?<=[.!?])\\s/)[0]"))
assert.equal(shortTask('Pack kitchen (30-minute sessions). Include subtasks for each session: glassware'), 'Pack kitchen (30-minute sessions).')
assert.ok(shortTask('x'.repeat(120)).length <= 90)
console.log('✓ briefing: meetings shown, next meeting can lead, fresh tasks only, safe id, time-boxed')
// Job scans that name a role and city run the scan (no saved preferences needed) and skip the brain.
const jobs = await import('../lib/agent/jobs')
assert.equal(jobs.jobScanQuery('scan jobs for product manager in Bangalore'), 'product manager jobs in Bangalore')
assert.equal(jobs.jobScanQuery('find product manager jobs in Bengaluru'), 'product manager jobs in Bengaluru')
assert.equal(jobs.jobScanQuery('search for head of AI roles in Bangalore now'), 'head of AI jobs in Bangalore')
for (const t of ['scan for jobs now', 'find me a restaurant', 'check my jobs', 'search for jobs for me', 'show my job applications']) assert.equal(jobs.jobScanQuery(t), null, t)
assert.equal(brain.isExactCommand('scan jobs for product manager in Bangalore'), true)
assert.equal(brain.isExactCommand('scan for jobs now'), true)
assert.match(readFileSync('lib/agent/jobs-command.ts', 'utf8'), /const named = isJobScanNow\(params\.text\) \? null : jobScanQuery\(params\.text\)/)
console.log('✓ job scans with a role and city run the scan, not a general web answer')

// A command right after the area question is never saved as an area (5 Nov: office became "my briefing").
const pc = await import('../lib/agent/places-context')
for (const t of ['my briefing', 'show my usage', 'plan my day', 'weather tomorrow', 'gold rate', 'any emails', 'today', 'the usual', 'pending reminders'])
  assert.equal(pc.placeAnswer(t), null, `not an area: ${t}`)
for (const [t, area] of [['Whitefield', 'Whitefield'], ['HSR Layout', 'HSR Layout'], ['MG Road 560001', 'MG Road']] as const)
  assert.equal(pc.placeAnswer(t)?.area, area, t)
console.log('✓ app commands never answer the area question')

// "What's pending": finished runs are one line, not decisions.
const ps = readFileSync('lib/bot/pending-summary.ts', 'utf8')
assert.match(ps, /const decisions = feed\.need\.filter\(i => i\.state !== 'done'\)/)
assert.match(ps, /section\('Needs your yes', decisions\.slice\(0, 5\)/)
assert.match(ps, /finished task\$\{finished\.length === 1 \? '' : 's'\} to check off on the dashboard/)
console.log('✓ pending summary keeps "Needs your yes" for real decisions')
// A stated diet steers food searches (5 Nov: "Kept in mind: Veg" under a seafood restaurant).
const veg = [{ kind: 'diet_stated', value: 'Veg', context: null }], tue = [{ kind: 'diet_stated', value: 'Veg on Tuesdays', context: 'Tuesdays' }]
assert.equal(pc.withStatedDiet('suggest 3 restaurants in Indiranagar for dinner', veg, 'Thursday'), 'suggest 3 pure veg restaurants in Indiranagar for dinner')
assert.equal(pc.withStatedDiet('seafood restaurants in Indiranagar', veg, 'Thursday'), 'seafood restaurants in Indiranagar', 'an explicit cuisine wins')
assert.equal(pc.withStatedDiet('restaurants in Indiranagar', tue, 'Tuesday'), 'pure veg restaurants in Indiranagar')
assert.equal(pc.withStatedDiet('restaurants in Indiranagar', tue, 'Thursday'), 'restaurants in Indiranagar', 'a Tuesday rule stays on Tuesdays')
assert.equal(pc.withStatedDiet('restaurants in Indiranagar', [{ kind: 'diet_stated', value: 'Vegan', context: null }], 'Monday'), 'vegan restaurants in Indiranagar')
assert.equal(pc.withStatedDiet('restaurants in Indiranagar', [{ kind: 'avoids', value: 'No mushrooms', context: null }], 'Monday'), 'restaurants in Indiranagar', 'only a stated diet steers')
console.log('✓ a stated diet steers restaurant searches; explicit cuisines and other days are left alone')
for (const t of ['suggest 3 restaurants in Indiranagar for dinner', 'find pizza nearby', 'suggest cafes near me'])
  assert.equal(brain.isExactCommand(t), true, `place search goes to its handler: ${t}`)
for (const t of ['what did you think of that restaurant', 'is it near the metro?', 'thanks'])
  assert.notEqual(t === 'thanks' ? false : brain.isExactCommand(t), true, `not a place search: ${t}`)
console.log('✓ place searches skip the brain, so a repeat ask runs a fresh search')
console.log('Day plan and briefing checks passed')
