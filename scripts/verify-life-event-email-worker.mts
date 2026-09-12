import assert from 'node:assert/strict'
import fs from 'node:fs'
import { scoreBoardingPassCandidate, buildBoardingPassSearchText } from '../lib/agent/life-event-email-worker'

const worker = fs.readFileSync('lib/agent/life-event-email-worker.ts', 'utf8')
const route = fs.readFileSync('app/api/cron/life-event-email/route.ts', 'utf8')
const vercel = fs.readFileSync('vercel.json', 'utf8')

const exact = scoreBoardingPassCandidate({
  subject: 'Your IndiGo boarding pass for 6E 614',
  from: 'IndiGo <noreply@goindigo.in>',
  snippet: 'Check-in confirmed. Booking reference ABC123. Download your boarding pass.',
  provider: 'IndiGo',
  confirmationRef: 'ABC123',
  flightNo: '6E 614',
})
assert.equal(exact.accepted, true)
assert.ok(exact.score >= 12)

const attachmentOnly = scoreBoardingPassCandidate({
  subject: 'Your travel document',
  from: 'Air India',
  snippet: 'Please see attachment.',
  attachmentText: 'BOARDING PASS Air India AI 285 PNR Q7LMNP Check-in confirmed',
  provider: 'Air India',
  confirmationRef: 'Q7LMNP',
  flightNo: 'AI 285',
})
assert.equal(attachmentOnly.accepted, true)

const promo = scoreBoardingPassCandidate({
  subject: 'IndiGo sale - save 20% on your next flight',
  from: 'IndiGo',
  snippet: 'Limited time promotion and upgrade offer',
  provider: 'IndiGo',
  confirmationRef: 'ABC123',
  flightNo: '6E 614',
})
assert.equal(promo.accepted, false)

const genericBoardingPass = scoreBoardingPassCandidate({
  subject: 'Boarding pass is ready',
  from: 'Unknown Airline',
  snippet: 'Download boarding pass',
  provider: 'IndiGo',
  confirmationRef: 'ABC123',
  flightNo: '6E 614',
})
assert.equal(genericBoardingPass.accepted, false, 'boarding-pass wording alone must not match the wrong trip')

const query = buildBoardingPassSearchText(
  { provider: 'IndiGo', confirmation_ref: 'ABC123', metadata_json: { flightNo: '6E 614' } },
  { payload_json: {} },
)
assert.match(query, /boarding pass/i)
assert.match(query, /ABC123/)
assert.match(query, /6E 614/)
assert.match(query, /IndiGo/)

assert.match(worker, /action_type', 'email_watch'/)
assert.match(worker, /watch-boarding-pass-email/)
assert.match(worker, /searchWorkspaceEmails/)
assert.match(worker, /readWorkspaceEmailBrief/)
assert.match(worker, /no_strong_boarding_pass_match/)
assert.match(worker, /duplicateSuppressed/)
assert.match(worker, /gmailMessageId/)
assert.match(worker, /source_refs/)
assert.match(worker, /EMAIL_WATCH_RETRY_MINUTES/)
assert.match(worker, /workspace_not_connected/)
assert.match(worker, /sendAgentPush/)
assert.doesNotMatch(worker, /gmail\.modify|messages\/.*modify|trash|archive|mark.*read/i)

assert.match(route, /CRON_SECRET/)
assert.match(route, /processDueLifeEventEmailWatches/)
assert.match(vercel, /\/api\/cron\/life-event-email/)

console.log('✅ Gmail boarding-pass Life Event executor regression passed')
