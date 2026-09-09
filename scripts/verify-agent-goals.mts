import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const engine=readFileSync(new URL('../lib/agent/goal-engine.ts',import.meta.url),'utf8')
const route=readFileSync(new URL('../app/api/agent/goals/route.ts',import.meta.url),'utf8')
const cron=readFileSync(new URL('../app/api/cron/agent-goals/route.ts',import.meta.url),'utf8')
const vercel=readFileSync(new URL('../vercel.json',import.meta.url),'utf8')

assert.match(engine,/MAX_GOAL_STEPS = 8/)
assert.match(engine,/private_action: ONLY reversible private AskGogo actions/i)
assert.match(engine,/Never send email, modify calendar, submit forms, book, purchase, share externally, delete data/i)
assert.match(engine,/evaluateAgentExecutionPolicy/)
assert.match(engine,/evaluateAgentSentinel/)
assert.match(engine,/\['memory','reminders','lists','tasks'\]/)
assert.match(engine,/classified\.risk==='low'/)
assert.match(engine,/createGoalArtifact/)
assert.match(engine,/type:'goal_review'/)
assert.match(route,/initializeBackgroundGoal/)
assert.match(cron,/CRON_SECRET/)
assert.doesNotMatch(cron,/searchParams\.get\('secret'\)/)
assert.match(vercel,/\/api\/cron\/agent-goals/)
console.log('agent background goals verification passed')
