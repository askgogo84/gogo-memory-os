import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runRoute = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
const chatRoute = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
const whatsapp = readFileSync(new URL('../lib/agent/whatsapp-bridge.ts', import.meta.url), 'utf8')
const planner = readFileSync(new URL('../lib/agent/general-planner.ts', import.meta.url), 'utf8')
const computer = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

function after(haystack:string, a:string, b:string, label:string){
  const ai=haystack.lastIndexOf(a), bi=haystack.lastIndexOf(b)
  assert.ok(ai>=0 && bi>=0 && ai < bi, label)
}

// One Gogo everywhere: complex missions own the route before simple travel search.
after(runRoute, 'tryRunGeneralPlan', 'tryRunTravelResearch', 'Agent missions must precede simple travel research')
after(chatRoute, 'tryRunGeneralPlan', 'tryRunTravelResearch', 'Talk to Gogo missions must precede simple travel research')
after(whatsapp, 'tryRunGeneralPlan', 'tryRunTravelResearch', 'WhatsApp missions must precede simple travel research')

// Planner depth is sufficient for memory + research + multiple actions + approval + artifact.
assert.match(planner, /const MAX_STEPS = 10/)
assert.match(planner, /Cover every explicit deliverable/i)
assert.match(planner, /Prefer safe, reversible work first/i)
assert.match(planner, /place the artifact after the safe preparatory work but BEFORE/i)
assert.match(planner, /missingMissionInput/)
assert.match(planner, /executeTaskStep/)

// India-first compute: functions and per-user secure computers default to Mumbai.
assert.deepEqual(vercel.regions, ['bom1'])
assert.match(computer, /GOGO_SANDBOX_REGION/)
assert.match(computer, /\|\| 'bom1'/)
assert.match(computer, /region:SANDBOX_REGION/)
assert.match(computer, /Sandbox\.getOrCreate/)
assert.match(computer, /persistent:true/)
assert.match(computer, /playwright install --with-deps chromium/)

// Background Gogo remains server-driven even when the user closes the app.
const cronPaths = new Map((vercel.crons || []).map((c:any)=>[c.path,c.schedule]))
assert.equal(cronPaths.get('/api/cron/reminders'), '* * * * *')
assert.equal(cronPaths.get('/api/cron/agent-watchers'), '*/15 * * * *')
assert.equal(cronPaths.get('/api/cron/agent-goals'), '*/15 * * * *')
assert.ok(cronPaths.has('/api/cron/daily-briefings'))

console.log('✅ India-first one-Gogo launch architecture checks passed')
