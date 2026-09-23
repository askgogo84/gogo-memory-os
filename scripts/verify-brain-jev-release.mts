import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wa=readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts',import.meta.url),'utf8')
const bridge=readFileSync(new URL('../lib/agent/whatsapp-bridge.ts',import.meta.url),'utf8')
const autonomy=readFileSync(new URL('../lib/agent/adaptive-autonomy.ts',import.meta.url),'utf8')
const trust=readFileSync(new URL('../lib/agent/adaptive-trust.ts',import.meta.url),'utf8')
const jev=readFileSync(new URL('../lib/typesafe/jev-shadow.ts',import.meta.url),'utf8')
const router=readFileSync(new URL('../lib/agent/jev-router.ts',import.meta.url),'utf8')
const gmail=readFileSync(new URL('../lib/agent/gmail-send.ts',import.meta.url),'utf8')
const watchers=readFileSync(new URL('../lib/agent/watchers.ts',import.meta.url),'utf8')
const calendar=readFileSync(new URL('../lib/bot/handlers/calendar-mutations.ts',import.meta.url),'utf8')

assert.match(autonomy,/capabilityIsOff/)
assert.match(trust,/Adaptive Trust/)
assert.match(trust,/I will never change these automatically/)
assert.match(jev,/decisionReadiness/)
assert.match(router,/jevClarificationReply/)
assert.match(wa,/actualHandler:'jev-clarification-guard'/)
assert.match(bridge,/executeApprovedGmailSend/)
assert.match(gmail,/verifyGmailSentMessage/)
assert.match(gmail,/I will not retry automatically because that could duplicate/)
assert.match(watchers,/assessProductAvailabilityText/)
assert.match(calendar,/fullMatches/)
assert.match(wa,/promotedJevIntent\(brainObservation\?\.jev\)/)

const clarify=wa.indexOf('const jevClarify=jevClarificationReply')
const promote=wa.indexOf('const jevIntent=promotedJevIntent')
assert.ok(clarify>=0&&promote>clarify,'ambiguity guard must precede semantic promotion')

console.log('AskGogo Brain/Jev release contract passed')
