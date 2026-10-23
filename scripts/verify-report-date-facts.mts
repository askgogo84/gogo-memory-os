// 22–23 Oct live: a research brief called 30 Oct 2026 a Thursday (it is a Friday), and a calendar check printed
// "Overlap: Daily Connect-Standup Call ↔ Daily Connect-Standup Call" six times. Run: npx tsx scripts/verify-report-date-facts.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test'; process.env.ANTHROPIC_API_KEY ||= 'test'
const { dateFactsFor } = await import('../lib/agent/general-planner')
const now = new Date('2026-10-23T05:00:00Z')
assert.deepEqual(dateFactsFor('Research Naru Noodle Bar for 30 October 2026, 7-9 pm, party of two', now), ['30 October 2026 is a Friday'])
assert.deepEqual(dateFactsFor('dinner on Oct 24 and lunch 2026-11-14', now), ['24 October 2026 is a Saturday', '14 November 2026 is a Saturday'])
assert.deepEqual(dateFactsFor('flights on 31 Feb', now), [], 'impossible dates are dropped, not normalised')
assert.deepEqual(dateFactsFor('no dates here', now), [])
const planner = readFileSync('lib/agent/general-planner.ts', 'utf8')
assert.match(planner, /DATE_FACTS: \$\{JSON\.stringify\(dateFactsFor\(/)
assert.match(planner, /DATE_FACTS are computed weekdays: use them exactly and never calculate a weekday yourself\./)
const cal = readFileSync('lib/agent/calendar-read.ts', 'utf8')
assert.match(cal, /Duplicate copies: \$\{g\.first\} overlaps itself \(\$\{g\.count\} pairs\)/)
assert.match(cal, /sort\(\(a,b\)=>Number\(a\.first===a\.second\)-Number\(b\.first===b\.second\)\)/, 'real clashes listed before duplicate copies')
console.log('Report date facts: weekdays computed, not guessed; duplicate-copy overlaps collapse to one line')
