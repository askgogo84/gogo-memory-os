import assert from 'node:assert/strict'
import fs from 'node:fs'
import { scoreBoardingPassCandidate, buildBoardingPassSearchTexts } from '../lib/agent/life-event-email-worker'

const worker=fs.readFileSync('lib/agent/life-event-email-worker.ts','utf8')
const route=fs.readFileSync('app/api/cron/life-events/route.ts','utf8')

const searches=buildBoardingPassSearchTexts({provider:'IndiGo',confirmation_ref:'ABC123',metadata_json:{flightNo:'6E614'}},{payload_json:{}})
assert.ok(searches.length>=3,'must search multiple boarding/check-in alternatives')
assert.ok(searches.some(x=>/boarding pass/i.test(x)))
assert.ok(searches.some(x=>/check-in confirmation/i.test(x)))
assert.ok(searches.every(x=>/ABC123|6E614|IndiGo/i.test(x)),'each search must retain trip identity')

const exact=scoreBoardingPassCandidate({subject:'Your boarding pass for 6E 614',snippet:'PNR ABC123',provider:'IndiGo',confirmationRef:'ABC123',flightNo:'6E614'})
assert.equal(exact.accepted,true,'strong trip-bound boarding-pass evidence should match')
const promo=scoreBoardingPassCandidate({subject:'Boarding pass sale offer',snippet:'Save 20%',provider:'IndiGo',confirmationRef:'ABC123',flightNo:'6E614'})
assert.equal(promo.accepted,false,'promo copy without trip identity in the message must not match')

assert.match(worker,/\.eq\('action_type',\s*'email_watch'\)/,'email worker must own only email_watch actions')
assert.match(worker,/duplicateSuppressed/,'duplicate boarding-pass evidence must be suppressed')
assert.match(worker,/gmailMessageId/,'Gmail provenance must be persisted')
const emailPos=route.indexOf('processDueLifeEventEmailWatches()')
const genericPos=route.indexOf('processDueLifeEventActions()')
assert.ok(emailPos>=0&&genericPos>emailPos,'email watches must run before the generic life-event worker in the same cron invocation')

console.log('✅ Gmail boarding-pass lifecycle regression passed')
