import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const helper = readFileSync(new URL('../lib/agent/workspace-meeting-approval.ts', import.meta.url), 'utf8')
const runRoute = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
const executeRoute = readFileSync(new URL('../app/api/agent/runs/[id]/execute/route.ts', import.meta.url), 'utf8')
const prep = readFileSync(new URL('../lib/agent/workspace-meeting-plan.ts', import.meta.url), 'utf8')

assert.match(helper, /action_type:\s*'calendar_change'/, 'Workspace meeting execution must use the Calendar approval boundary')
assert.match(helper, /\.eq\('status',\s*'approved'\)/, 'Execution must require an explicitly approved approval row')
assert.match(helper, /sendUpdates=all/, 'Approved Calendar creation must explicitly send the Calendar invitation')
assert.match(helper, /attendees:\s*\[\{ email: params\.invite\.attendee \}\]/, 'Approved Calendar invite must use the resolved attendee')
assert.match(helper, /eventIdForRun/, 'Calendar execution must derive an idempotent event id from the run')
assert.match(helper, /response\.status === 409/, 'Calendar retry must verify an already-created deterministic event instead of duplicating it')
assert.match(helper, /The prepared Gmail reply will remain unsent/, 'Approval copy must state that Gmail is not being sent')
assert.doesNotMatch(helper, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/, 'Workspace approval execution must not silently send Gmail')
assert.doesNotMatch(helper, /Authorization[^\n]*(metadata_json|agent_activity)/, 'OAuth credentials must never be persisted to Activity/run metadata')
assert.match(runRoute, /attachWorkspaceMeetingApproval/, 'Prepared Workspace meetings must be converted into an exact approval card')
assert.match(runRoute, /prepared\.status === 'waiting_approval' \? 202 : 200/, 'Workspace approval must surface as HTTP 202 while waiting')
assert.match(executeRoute, /planType === 'workspace_meeting_prep'/, 'Approved execution router must recognize Workspace meeting plans')
assert.match(executeRoute, /executeApprovedWorkspaceMeetingPlan/, 'Approved execution router must use the Workspace-specific executor')
assert.match(prep, /emailSent:false,calendarScheduled:false,approvalRequiredForExecution:true/, 'Preparation must remain non-consequential before approval')
assert.match(prep, /threadId:String\(email\.threadId\|\|''\)/, 'Prepared artifact must preserve the source Gmail thread id')

console.log('workspace meeting approval regression: ok')
