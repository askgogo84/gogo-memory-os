import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const engine=readFileSync(new URL('../lib/agent/goal-engine.ts',import.meta.url),'utf8')
const worker=readFileSync(new URL('../lib/agent/goal-worker.ts',import.meta.url),'utf8')
const route=readFileSync(new URL('../app/api/agent/goals/route.ts',import.meta.url),'utf8')
const resume=readFileSync(new URL('../app/api/agent/goals/[id]/resume/route.ts',import.meta.url),'utf8')
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

// A due watcher is claimed before execution so overlapping cron invocations cannot
// advance the same background goal step twice.
assert.match(worker,/GOAL_REVIEW_LEASE_MINUTES/)
assert.match(worker,/claimGoalWatcher/)
assert.match(worker,/eq\('id',watcher\.id\)\.eq\('active',true\)/)
assert.match(worker,/select\('id'\)\.maybeSingle\(\)/)
assert.match(worker,/if\(!\(await claimGoalWatcher\(watcher,now\)\)\)continue/)

// Background progress must be visible as a real Agent Activity run rather than
// living only inside goal JSON. The run is linked back to the goal/watcher and
// carries progress, next action and blockers for later audit/continuity.
assert.match(worker,/type:'background_goal_review'/)
assert.match(worker,/source:'background_goal'/)
assert.match(worker,/from\('agent_runs'\)\.insert/)
assert.match(worker,/from\('agent_activity'\)\.insert/)
assert.match(worker,/event_type:failed\?'goal_review_failed':'goal_review_progress'/)
assert.match(worker,/nextAction:goal\?\.next_action/)
assert.match(worker,/blockers:Array\.isArray\(goal\?\.blockers\)/)

// Meaningful progress and blockers surface proactively in the app, including the
// exact next action where one exists; a worker exception also produces a visible
// failed Activity item rather than silently disappearing.
assert.match(worker,/Gogo advanced a goal/)
assert.match(worker,/Gogo paused safely/)
assert.match(worker,/Gogo needs your attention/)
assert.match(worker,/Next: \$\{next\}/)
assert.match(worker,/recordGoalReview\(\{telegramId,watcher,goal,triggered:false,failed:true,now\}\)/)
assert.match(worker,/sendAgentPush/)

// A human review must not strand a goal forever. The resume route resolves one
// blocked step, clears blockers, reactivates/creates the goal-review watcher and
// wakes it immediately. It never executes the blocked consequential action itself.
assert.match(resume,/status==='blocked'/)
assert.match(resume,/humanReviewed:true/)
assert.match(resume,/blockers:\[\]/)
assert.match(resume,/eq\('type','goal_review'\)|type:'goal_review'/)
assert.match(resume,/next_check_at:now/)
assert.doesNotMatch(resume,/dispatchThroughSameBrain|runSecureBrowser|sendWhatsAppMessage/)

console.log('agent background goals verification passed')
