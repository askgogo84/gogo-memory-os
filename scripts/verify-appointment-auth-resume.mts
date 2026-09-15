import assert from 'node:assert/strict'
import fs from 'node:fs'
import { appointmentAuthResumeIntent } from '../lib/agent/appointment-auth-resume'
import { isAppointmentResearchRequest } from '../lib/agent/appointment-research'

// Strict human-auth resume commands.
assert.equal(appointmentAuthResumeIntent('OTP done'), 'auth_done')
assert.equal(appointmentAuthResumeIntent('I completed the authentication'), 'auth_done')
assert.equal(appointmentAuthResumeIntent('appointment booked'), 'booking_done')
assert.equal(appointmentAuthResumeIntent('I confirmed the appointment'), 'booking_done')
assert.equal(appointmentAuthResumeIntent('check appointment confirmation'), 'check_confirmation')
assert.equal(appointmentAuthResumeIntent('find me a dentist in Bengaluru'), null)
assert.equal(appointmentAuthResumeIntent('my OTP is 123456'), null, 'OTP values must never be accepted as resume commands')

// Public inventory discovery remains the normal appointment path.
assert.equal(isAppointmentResearchRequest('Find me a dentist appointment in Bengaluru next week'), true)

const resume = fs.readFileSync('lib/agent/appointment-auth-resume.ts','utf8')
const research = fs.readFileSync('lib/agent/appointment-research.ts','utf8')
const recovery = fs.readFileSync('lib/agent/appointment-followup-recovery.ts','utf8')
const browser = fs.readFileSync('lib/agent/browser-command.ts','utf8')

// Resume is routed by the same appointment brain on every surface that calls research.
assert.match(research,/tryResumeAppointmentAfterHumanAuth/)
assert.ok(research.indexOf('tryResumeAppointmentAfterHumanAuth(params)') < research.indexOf('isAppointmentResearchRequest(params.text)'))

// Durable handoff must be bound to a prepared, provider+city locked appointment.
assert.match(resume,/appointment_prepared === true/)
assert.match(resume,/providerLocked === true/)
assert.match(resume,/locationLocked === true/)
assert.match(resume,/human_auth_required/)
assert.match(resume,/provider_access_limited/)
assert.match(resume,/waiting_provider_confirmation/)
assert.match(resume,/handoffUrl/)

// Never ingest OTP/password values through chat.
assert.match(resume,/I will not ask for or store your OTP\/password/)
assert.doesNotMatch(resume,/otpValue|passwordValue|oneTimePassword/)

// Provider confirmation must be independently verified before Life Event creation.
assert.match(resume,/findAppointmentEmail/)
assert.match(resume,/confirmationVerified:false/)
assert.match(resume,/providerConfirmationVerified:true/)
assert.ok(resume.indexOf("extracted.status!=='confirmed'") < resume.indexOf('registerLifeEvent({'))
assert.match(resume,/source:'gmail_provider_confirmation'/)
assert.match(resume,/eventType:'appointment'/)

// Browser blocker remains a pause, not a success, and city lock remains enforced.
assert.match(browser,/provider_access_limited/)
assert.match(browser,/status:'paused'/)
assert.match(recovery,/providerLocked:true,locationLocked:true/)
assert.match(recovery,/do not navigate to a branch or page for another city/)

console.log('✅ Appointment auth-resume regression passed: public inventory unchanged; OTP/login handoff preserves provider+city and verifies provider confirmation before Life Event creation')
