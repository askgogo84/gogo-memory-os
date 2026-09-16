import assert from 'node:assert/strict'
import fs from 'node:fs'

const bridge = fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const liveRoute = fs.readFileSync('app/api/agent/live/route.ts','utf8')

const specialistMarker = 'if (shouldPreferSpecialistTravel(params.text))'
const generalMarker = 'const general = await tryRunGeneralPlan'
assert.ok(bridge.includes(specialistMarker), 'specialist travel routing guard must exist')
assert.ok(bridge.indexOf(specialistMarker) < bridge.indexOf(generalMarker), 'pure travel research must run before the general planner')
assert.match(bridge, /current fare\|current fares\|live sources\?\|best available/i, 'live/current travel language should be recognized')
assert.match(bridge, /remind\\s\+me|set\\s\+\(\?:a\\s\+\)\?reminder/, 'compound cross-feature missions must remain planner-owned')

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

console.log('✅ Live autonomous run contract + specialist travel precedence regression passed')
