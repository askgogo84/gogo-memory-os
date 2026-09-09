import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planner = readFileSync(new URL('../lib/agent/general-planner.ts', import.meta.url), 'utf8')
const runRoute = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
const executeRoute = readFileSync(new URL('../app/api/agent/runs/[id]/execute/route.ts', import.meta.url), 'utf8')

// Planner is bounded and allowlisted. Purchases are never delegated as an LLM
// planner tool; financial commitment remains behind existing deterministic paths.
assert.match(planner, /const MAX_STEPS = 6/)
assert.match(planner, /'web_search'/)
assert.match(planner, /'artifact'/)
assert.doesNotMatch(planner, /GeneralPlanTool[\s\S]*\| 'payments'/)
assert.match(planner, /payments\/purchases are NOT an available planner tool/i)

// The planning model only receives the current request, never raw stored memory,
// credentials, document values or email bodies.
assert.match(planner, /The plan sees ONLY this user request/i)
assert.doesNotMatch(planner, /anthropic\.messages\.create\([\s\S]*supabaseAdmin/)

// Every generated step is reclassified and rechecked by the deterministic server
// policy. The model cannot declare itself safe or grant its own permission.
assert.match(planner, /classifyAgentRequest\(step\.instruction\)/)
assert.match(planner, /evaluateAgentExecutionPolicy/)
assert.match(planner, /permissionFor\(tg,classified\.capability\)/)
assert.match(planner, /status:'waiting_approval'/)
assert.match(planner, /agent_approvals/)

// Approved plans are resumable, and one approval only applies to the exact ordinal
// stored in execution_payload.
assert.match(planner, /resumeApprovedGeneralPlan/)
assert.match(planner, /execution_payload\?\.ordinal/)
assert.match(planner, /approvedOrdinal===ordinal/)

// Artifacts are private server-side outputs tied back to the run.
assert.match(planner, /from\('agent_artifacts'\)/)
assert.match(planner, /source_refs:\[\{type:'agent_run',id:runId\}\]/)

// Specialist deterministic plans remain ahead of the general planner; simple
// requests still fall back to the existing same-brain single-action path.
const travelIndex = runRoute.indexOf('tryPrepareTravelCalendarPlan')
const expiryIndex = runRoute.indexOf('tryRunExpiryReminderPlan')
const generalIndex = runRoute.indexOf('tryRunGeneralPlan')
const fallbackIndex = runRoute.indexOf('runAgentCommand')
assert.ok(travelIndex >= 0 && expiryIndex >= 0 && generalIndex >= 0 && fallbackIndex >= 0)
assert.ok(generalIndex > travelIndex)
assert.ok(generalIndex > expiryIndex)
assert.ok(fallbackIndex < 500, 'runAgentCommand import is expected near top')
const generalCall = runRoute.lastIndexOf('tryRunGeneralPlan')
const fallbackCall = runRoute.lastIndexOf('runAgentCommand')
assert.ok(generalCall < fallbackCall, 'general planner must run before simple fallback')

// Approved execution route recognizes general plans and resumes them through the
// dedicated resumable executor instead of replaying the original command blindly.
assert.match(executeRoute, /planType === 'general_multi_tool'/)
assert.match(executeRoute, /resumeApprovedGeneralPlan/)

console.log('agent general planner verification passed')
