// Wajo-style step narration in chat (23 Oct): live line from the task's real current step, then "Completed N steps".
// Run: npx tsx scripts/verify-chat-step-narration.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { liveStepLine, shapeRunSteps, stateForStepTool } from '../lib/dashboard/run-steps-shared'

assert.equal(liveStepLine('Read the latest Zomato Instagram posts'), 'Reading the latest Zomato Instagram posts')
assert.equal(liveStepLine('Research flight options'), 'Researching flight options')
assert.equal(liveStepLine('Book the table'), 'Preparing to book the table', 'never narrate a booking as happening')
assert.equal(liveStepLine('Send the email to Nithin'), 'Preparing to send the email to Nithin')
assert.equal(liveStepLine('Zomato posts'), 'Zomato posts')
assert.equal(liveStepLine(''), 'Working on it')
assert.equal(stateForStepTool('web_search'), 'searching'); assert.equal(stateForStepTool('browser'), 'browsing'); assert.equal(stateForStepTool('travel'), 'flight')

const running = shapeRunSteps({ id: 'r', status: 'running', title: 'T' }, [{ title: 'Search', tool_name: 'web_search', status: 'completed' }, { title: 'Read posts', tool_name: 'browser', status: 'running' }])
assert.equal(running.done, false); assert.equal(running.steps.length, 2)
assert.equal(shapeRunSteps({ id: 'r', status: 'completed' }, []).done, true)
assert.equal(shapeRunSteps({ id: 'r', status: 'paused' }, []).done, true, 'a paused task stops polling')

const lib = readFileSync('lib/dashboard/run-steps.ts', 'utf8')
assert.match(lib, /from\('agent_runs'\)\.select\('id,status,title'\)\.eq\('id', runId\)\.eq\('telegram_id', tg\)/, 'run read is owner-scoped')
assert.match(lib, /\.eq\('run_id', runId\)\.eq\('telegram_id', tg\)/, 'steps read is owner-scoped')
assert.doesNotMatch(readFileSync('lib/dashboard/run-steps-shared.ts', 'utf8'), /supabase/, 'client helpers carry no database code')
assert.doesNotMatch(readFileSync('components/dashboard/run-steps.tsx', 'utf8'), /lib\/dashboard\/run-steps'/, 'client imports only the shared helpers')
for (const f of ['app/api/agent/runs/[id]/steps/route.ts', 'app/api/agent/runs/live/route.ts']) {
  const r = readFileSync(f, 'utf8'); assert.match(r, /requireAgentSession\(request\)/); assert.match(r, /session\.telegramId/)
}
const chat = readFileSync('components/dashboard/gogo-chat.tsx', 'utf8')
assert.match(chat, /\{message\.runId&&<div className="mb-1"><RunStepsLine runId=\{message\.runId\}\/><\/div>\}/)
assert.match(chat, /\{sending&&<RunStepsLine since=\{sentAt\} fallback="Gogo is working"\/>\}/)
assert.match(chat, /runId:typeof data\.runId==='string'\?data\.runId:null/)
console.log('Chat step narration: real steps only, owner-scoped, live line then "Completed N steps"')
