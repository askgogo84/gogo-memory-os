import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planner = readFileSync(new URL('../lib/agent/general-planner.ts', import.meta.url), 'utf8')
const runRoute = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
const executeRoute = readFileSync(new URL('../app/api/agent/runs/[id]/execute/route.ts', import.meta.url), 'utf8')

// Planner is bounded and allowlisted, but deep enough for a real personal-agent
// mission (memory + research + lists + tasks + reminder + approval + artifact).
assert.match(planner, /const MAX_STEPS = 10/)
assert.match(planner, /Cover every explicit deliverable/i)
assert.match(planner, /Prefer safe, reversible work first/i)
assert.match(planner, /place the artifact after the safe preparatory work but BEFORE/i)
assert.match(planner, /'web_search'/)
assert.match(planner, /'artifact'/)
assert.doesNotMatch(planner, /GeneralPlanTool[\s\S]*\| 'payments'/)
assert.match(planner, /payments\/purchases are NOT an available planner tool/i)

// The planning model only receives the current user request through a local prompt
// variable. It is not passed a Supabase row, raw stored memory, or credential value.
assert.match(planner, /The plan sees ONLY this user request/i)
assert.match(planner, /User request: \$\{JSON\.stringify\(String\(text \|\| ''\)\.slice\(0, 1800\)\)\}/)
assert.match(planner, /messages: \[\{ role: 'user', content: prompt \}\]/)

// Every generated step is reclassified and rechecked by deterministic server
// policy. The model cannot declare itself safe or grant its own permission.
assert.match(planner, /classifyAgentRequest\(step\.instruction\)/)
assert.match(planner, /evaluateAgentExecutionPolicy/)
assert.match(planner, /permissionFor\(tg,classified\.capability\)/)
assert.match(planner, /status:'waiting_approval'/)
assert.match(planner, /agent_approvals/)

// Tool names are contracts, not suggestions. A Tasks step writes to the real todos
// store directly and verifies success there instead of letting free-form NLP turn a
// task into a reminder while Activity still reports green.
assert.match(planner, /async function executeTaskStep/)
assert.match(planner, /from\('todos'\)/)
assert.match(planner, /verifiedStore:'todos'/)
assert.match(planner, /if \(step\.tool === 'tasks'\) return executeTaskStep/)

// Missing temporal dependencies must pause honestly. A "24 hours before selected
// departure" reminder/calendar action cannot invent a timestamp from unrelated
// history and then be marked completed.
assert.match(planner, /export function missingMissionInput/)
assert.match(planner, /Choose the departure date and time first/i)
assert.match(planner, /event_type:eventType/)
assert.match(planner, /'input_required'/)
assert.match(planner, /inputRequired:true/)
assert.match(planner, /status:'paused'/)

// Draft artifacts should be produced before a later approval/input boundary when
// they can summarize the safe preparatory work.
assert.match(planner, /placeArtifactBeforeDeferredWork/)
assert.match(planner, /steps\.splice\(deferredIndex, 0, artifact\)/)

// Approval progress is based on the actual plan length, not MAX_STEPS.
assert.match(planner, /params\.totalSteps/)
assert.match(planner, /params\.plan\.steps\.length/)

// Approved plans are resumable, and one approval only applies to the exact ordinal
// stored in execution_payload.
assert.match(planner, /resumeApprovedGeneralPlan/)
assert.match(planner, /execution_payload\?\.ordinal/)
assert.match(planner, /approvedOrdinal===ordinal/)

// Artifacts are private server-side outputs tied back to the run.
assert.match(planner, /from\('agent_artifacts'\)/)
assert.match(planner, /source_refs:\[\{type:'agent_run',id:runId\}\]/)

// Specialist deterministic cross-feature plans remain ahead of the general planner.
// BUT simple travel research must be after the general planner, otherwise a multi-
// feature trip mission collapses into a one-step fare search.
const travelCalendarCall = runRoute.lastIndexOf('tryPrepareTravelCalendarPlan')
const expiryCall = runRoute.lastIndexOf('tryRunExpiryReminderPlan')
const generalCall = runRoute.lastIndexOf('tryRunGeneralPlan')
const travelResearchCall = runRoute.lastIndexOf('tryRunTravelResearch')
const fallbackCall = runRoute.lastIndexOf('runAgentCommand')
assert.ok(travelCalendarCall >= 0 && expiryCall >= 0 && generalCall >= 0 && travelResearchCall >= 0 && fallbackCall >= 0)
assert.ok(generalCall > travelCalendarCall)
assert.ok(generalCall > expiryCall)
assert.ok(generalCall < travelResearchCall, 'multi-step planner must run before simple travel research')
assert.ok(generalCall < fallbackCall, 'general planner must run before simple fallback')

// Approved execution route recognizes general plans and resumes them through the
// dedicated resumable executor instead of replaying the original command blindly.
assert.match(executeRoute, /planType === 'general_multi_tool'/)
assert.match(executeRoute, /resumeApprovedGeneralPlan/)

console.log('agent general planner verification passed')
