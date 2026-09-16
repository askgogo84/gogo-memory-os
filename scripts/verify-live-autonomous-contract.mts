import assert from 'node:assert/strict'
import fs from 'node:fs'

const bridge = fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const appRun = fs.readFileSync('app/api/agent/run/route.ts','utf8')
const specialist = fs.readFileSync('lib/agent/specialist-routing.ts','utf8')
const liveRoute = fs.readFileSync('app/api/agent/live/route.ts','utf8')

const waSpecialistMarker = 'if (shouldPreferSpecialistTravel(params.text))'
const waPersistentMarker = 'const persistent = await tryRunPersistentGeneralPlan'
const waGeneralMarker = 'const general = await tryRunGeneralPlan'

assert.ok(bridge.includes(waSpecialistMarker), 'WhatsApp specialist travel routing guard must exist')
assert.ok(bridge.includes(waPersistentMarker), 'WhatsApp must use persistent autonomous runtime for safe multi-step plans')
assert.ok(bridge.includes(waGeneralMarker), 'WhatsApp legacy general planner fallback must remain available')
assert.ok(bridge.indexOf(waSpecialistMarker) < bridge.indexOf(waPersistentMarker), 'WhatsApp pure travel research must beat the multi-tool planner')
assert.ok(bridge.indexOf(waPersistentMarker) < bridge.indexOf(waGeneralMarker), 'WhatsApp persistent runtime must beat the legacy general planner')
assert.ok(bridge.includes("decision === 'approve' ? 'queued' : 'paused'"), 'WhatsApp approval resolution must preserve queued/paused run transition')

const appSpecialistMarker = 'if (shouldPreferSpecialistTravel(text))'
const appPersistentMarker = 'const persistentPlan = await tryRunPersistentGeneralPlan'
const appGeneralMarker = 'const generalPlan = await tryRunGeneralPlan'
assert.ok(appRun.includes(appSpecialistMarker), 'app/dashboard API must use the same specialist travel routing guard')
assert.ok(appRun.indexOf(appSpecialistMarker) < appRun.indexOf(appPersistentMarker), 'app pure travel research must beat the persistent general planner')
assert.ok(appRun.indexOf(appPersistentMarker) < appRun.indexOf(appGeneralMarker), 'app persistent runtime must beat legacy general planner')

assert.ok(specialist.includes('current fare|current fares|live sources?|best available'), 'shared specialist policy must recognize live/current travel language')
assert.ok(specialist.includes('remind\\s+me'), 'shared specialist policy must leave reminder compounds to the planner')

for (const state of [
  'idle','planning','searching','browsing','comparing','preparing_action','waiting_for_site',
  'waiting_for_user','waiting_approval','watching','verified','completed','blocked','failed',
]) {
  assert.ok(liveRoute.includes(`'${state}'`), `live contract must expose ${state}`)
}

for (const source of ['agent_runs','agent_steps','agent_activity','agent_approvals']) {
  assert.ok(liveRoute.includes(`from('${source}')`), `live contract must read ${source}`)
}

assert.ok(liveRoute.includes('contractVersion:1'), 'live contract must be explicitly versioned')
assert.ok(liveRoute.includes('activeRuns'), 'live contract must expose active runs')
assert.ok(liveRoute.includes('recentRuns'), 'live contract must expose recent runs')
assert.ok(liveRoute.includes('presentationState'), 'live contract must expose presentation state for character/UI binding')

console.log('✅ Live autonomous run contract + cross-surface specialist routing + persistent runtime regression passed')
