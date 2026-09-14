import assert from 'node:assert/strict'
import fs from 'node:fs'

const persistent=fs.readFileSync('lib/agent/persistent-general-plan.ts','utf8')
const route=fs.readFileSync('app/api/agent/run/route.ts','utf8')
const cron=fs.readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'))

assert.match(persistent,/planGeneralAgentRequest/)
assert.match(persistent,/createAutonomousRun/)
assert.match(persistent,/executeAutonomousRun/)
assert.match(persistent,/recoverStaleAutonomousSteps/)
assert.match(persistent,/resumePersistentGeneralPlan/)
assert.match(persistent,/executeVerifiedMissionMemory/)
assert.match(persistent,/executeVerifiedMissionList/)
assert.match(persistent,/executeVerifiedMissionReminder/)
assert.match(persistent,/executeVerifiedMissionWebSearch/)
assert.match(persistent,/verificationRequired:\s*true/)
assert.match(persistent,/persistent_general_plan:\s*true/)
assert.match(persistent,/maxAttempts:\s*4/)
assert.match(persistent,/drivePersistentRun/)

assert.match(route,/tryRunPersistentGeneralPlan/)
assert.ok(route.indexOf('tryRunPersistentGeneralPlan') < route.indexOf('tryRunGeneralPlan({'),'persistent runtime must be attempted before legacy general planner')
assert.match(route,/persistentPlan/)

assert.match(cron,/CRON_SECRET/)
assert.match(cron,/resumePersistentGeneralPlan/)
assert.match(cron,/\.eq\('type','autonomous'\)/)
assert.match(cron,/\.in\('status',\['running','queued'\]\)/)

const autonomousCron=vercel.crons.find((item:any)=>item.path==='/api/cron/autonomous-runs')
assert.ok(autonomousCron,'persistent autonomous cron must be scheduled')
assert.equal(autonomousCron.schedule,'* * * * *')

console.log('✅ Persistent general-plan routing + resume worker regression passed')
