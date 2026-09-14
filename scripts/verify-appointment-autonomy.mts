import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isAppointmentResearchRequest } from '../lib/agent/appointment-research'

assert.equal(isAppointmentResearchRequest('Find me a dentist appointment in Bengaluru next week'), true)
assert.equal(isAppointmentResearchRequest('Look for available dermatologist appointment options near Indiranagar tomorrow'), true)
assert.equal(isAppointmentResearchRequest('Book a dental appointment in Bengaluru next week'), true)
assert.equal(isAppointmentResearchRequest('Create a calendar appointment tomorrow at 4 PM'), false)
assert.equal(isAppointmentResearchRequest('Find cheap flights to Mumbai'), false)

const agentRoute = fs.readFileSync('app/api/agent/run/route.ts', 'utf8')
const executeRoute = fs.readFileSync('app/api/agent/runs/[id]/execute/route.ts', 'utf8')
const chatRoute = fs.readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const research = fs.readFileSync('lib/agent/appointment-research.ts', 'utf8')
const followup = fs.readFileSync('lib/agent/appointment-followup.ts', 'utf8')

assert.match(agentRoute, /tryRunAppointmentResearch/)
assert.match(agentRoute, /tryRunAppointmentFollowup/)
assert.ok(agentRoute.indexOf('tryRunAppointmentFollowup') < agentRoute.indexOf('tryRunBrowserCommand({ actor'), 'appointment follow-up must resume before generic browser routing')
assert.ok(agentRoute.indexOf('tryRunAppointmentResearch({ actor') < agentRoute.indexOf('tryRunPersistentGeneralPlan({'), 'appointment discovery must run before open-ended persistent planning')

assert.match(chatRoute, /tryRunAppointmentResearch/)
assert.match(chatRoute, /tryRunAppointmentFollowup/)
assert.ok(chatRoute.indexOf('tryRunAppointmentFollowup({ actor') < chatRoute.indexOf('tryRunGeneralPlan({'), 'Talk to Gogo must preserve appointment follow-up before generic planning')

assert.match(research, /readOnly:\s*true/)
assert.match(research, /mutated:\s*false/)
assert.match(research, /I have not claimed a slot is live/)
assert.match(research, /options:\s*options\.map/)

assert.match(followup, /latestAppointmentResearch/)
assert.match(followup, /appointment_selection/)
assert.match(followup, /Prepare the appointment form flow/)
assert.match(followup, /Stop before final confirmation, submission, authentication or payment/)
assert.match(followup, /agent_approvals/)
assert.match(followup, /action_type:\s*'booking'/)
assert.match(followup, /risk_level:\s*'high'/)
assert.match(followup, /appointment_prepared:\s*true/)
assert.match(followup, /Do not purchase paid add-ons/)
assert.match(followup, /approvalRequired:\s*true/)
assert.match(followup, /need the exact appointment date and time/)
assert.match(followup, /scheduled_at/)
assert.match(followup, /finalizeApprovedAppointmentRun/)
assert.match(followup, /providerConfirmationVerified:\s*true/)
assert.match(followup, /registerLifeEvent/)
assert.match(followup, /eventType:\s*'appointment'/)
assert.match(followup, /appointment_browser_closure/)
assert.match(followup, /I therefore did not create calendar\/reminder\/watch follow-ups/)

assert.match(executeRoute, /finalizeApprovedAppointmentRun/)
assert.ok(executeRoute.indexOf('executeApprovedBrowserCommand') < executeRoute.indexOf('finalizeApprovedAppointmentRun'), 'provider action must execute before appointment closure verification')

console.log('✅ Appointment autonomy regression passed: discover → persist option → draft → exact-slot approval → provider verification → Life Event')