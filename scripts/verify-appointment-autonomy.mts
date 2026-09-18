import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isAppointmentResearchRequest, appointmentBookableScore } from '../lib/agent/appointment-research'
import { appointmentPrepareOptionNumber, locationLockedResult } from '../lib/agent/appointment-followup-recovery'

assert.equal(isAppointmentResearchRequest('Find me a dentist appointment in Bengaluru next week'), true)
assert.equal(isAppointmentResearchRequest('Look for available dermatologist appointment options near Indiranagar tomorrow'), true)
assert.equal(isAppointmentResearchRequest('Book a dental appointment in Bengaluru next week'), true)
assert.equal(isAppointmentResearchRequest('Create a calendar appointment tomorrow at 4 PM'), false)
assert.equal(isAppointmentResearchRequest('Find cheap flights to Mumbai'), false)

assert.ok(appointmentBookableScore({title:'Book Appointment',snippet:'Choose a slot',url:'https://clinic.example/book-appointment'}) > appointmentBookableScore({title:'Our Clinics',snippet:'Dentist near me',url:'https://clinic.example/our-clinics'}))

const exactFailedProductionFollowup = 'Prepare option 2 and check the available appointment slots for next week. Do not confirm or book anything yet.'
assert.equal(appointmentPrepareOptionNumber(exactFailedProductionFollowup), 2)
assert.equal(appointmentPrepareOptionNumber('Open option #5 and inspect availability'), 5)
assert.equal(appointmentPrepareOptionNumber('Find me a dentist appointment in Bengaluru next week'), null)

// Production regression: once Bengaluru + Clove is selected, a same-provider New Delhi
// URL must never replace it. A city-neutral booking endpoint remains acceptable because
// the browser can still select the locked city without drifting to another branch.
assert.equal(locationLockedResult({url:'https://clovedental.in/dentist-near-me/new-delhi/safdarjung-enclave',title:'Clove Dental Safdarjung Enclave'}, 'Bengaluru'), false)
assert.equal(locationLockedResult({url:'https://clovedental.in/dentist-near-me/bengaluru',title:'Clove Dental Bengaluru'}, 'Bengaluru'), true)
assert.equal(locationLockedResult({url:'https://clovedental.in/appointments',title:'Book Appointment'}, 'Bengaluru'), true)

const agentRoute = fs.readFileSync('app/api/agent/run/route.ts', 'utf8')
const executeRoute = fs.readFileSync('app/api/agent/runs/[id]/execute/route.ts', 'utf8')
const chatRoute = fs.readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const research = fs.readFileSync('lib/agent/appointment-research.ts', 'utf8')
const followup = fs.readFileSync('lib/agent/appointment-followup.ts', 'utf8')
const recovery = fs.readFileSync('lib/agent/appointment-followup-recovery.ts', 'utf8')
const browser = fs.readFileSync('lib/agent/browser-command.ts', 'utf8')
const secureComputer = fs.readFileSync('lib/agent/secure-computer.ts', 'utf8')

assert.match(agentRoute, /tryRunAppointmentResearch/)
assert.match(agentRoute, /tryRunAppointmentFollowup/)
assert.match(agentRoute, /tryRecoverAppointmentOption/)
assert.match(agentRoute, /appointmentPrepareOptionNumber/)
assert.ok(agentRoute.indexOf('appointmentPrepareOptionNumber(text)') < agentRoute.indexOf('tryRunAppointmentResearch({ actor'), 'numbered appointment follow-up must be consumed before any new provider search')
assert.ok(agentRoute.indexOf('tryRunAppointmentFollowup') < agentRoute.indexOf('tryRunBrowserCommand({ actor'), 'appointment follow-up must resume before generic browser routing')
assert.ok(agentRoute.indexOf('tryRunAppointmentResearch({ actor') < agentRoute.indexOf('tryRunPersistentGeneralPlan({'), 'appointment discovery must run before open-ended persistent planning')
assert.match(agentRoute, /I will not start a new search in another location/)

assert.match(chatRoute, /tryRunAppointmentResearch/)
assert.match(chatRoute, /tryRunAppointmentFollowup/)
assert.ok(chatRoute.indexOf('tryRunAppointmentFollowup({ actor') < chatRoute.indexOf('tryRunGeneralPlan({'), 'Talk to Gogo must preserve appointment follow-up before generic planning')

assert.match(research, /readOnly:\s*true/)
assert.match(research, /mutated:\s*false/)
assert.match(research, /I have not claimed a slot is live/)
assert.match(research, /bookableScore/)
assert.match(research, /bookableRanked/)
assert.match(research, /ranked direct booking\/appointment paths ahead of generic clinic pages/i)

assert.match(recovery, /appointment_selection/)
assert.match(recovery, /resolveBookableTarget/)
assert.match(recovery, /site:\$\{originalHost\}/)
assert.match(recovery, /sameProviderHost/)
assert.match(recovery, /locationLockedResult/)
assert.match(recovery, /providerLocked:true,locationLocked:true/)
assert.match(recovery, /Keep the provider AND city locked/)
assert.match(recovery, /retireStaleBookingApprovals/)
assert.match(recovery, /execution_payload/)
assert.match(recovery, /Superseded by a later explicit read-only appointment availability check/)
assert.match(recovery, /hasLiveSlotEvidence/)
assert.match(recovery, /availabilityVerified/)
assert.match(recovery, /could not verify actual live appointment dates\/times/i)
assert.match(recovery, /const objective = `Open [\s\S]*Fill only safe non-sensitive search fields if needed to reveal available dates or times/)
assert.match(recovery, /Navigate within this provider website/)
assert.match(recovery, /Make no provider-side changes/)
assert.match(recovery, /Stop before any final action, login, OTP, CAPTCHA, authentication challenge, or financial step/)
assert.match(recovery, /recoveredContext:\s*true/)
assert.match(recovery, /bookablePathResolved/)
assert.doesNotMatch(recovery, /I only inspected availability and made no provider-side changes/)
assert.doesNotMatch(recovery, /Do not confirm, submit, book, pay, authenticate/)

assert.match(secureComputer, /provider_access_limited/)
assert.match(secureComputer, /your access to this site has been limited/)
assert.match(secureComputer, /const navTimeout = 45000/)
assert.match(browser, /result.status==='blocked'/)
assert.match(browser, /provider_access_limited/)
assert.match(browser, /status:'paused'/)

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

console.log('✅ Appointment autonomy regression passed: city-locked provider selection → blocked-site fail-safe → live-slot evidence → exact-slot approval → verified Life Event')
