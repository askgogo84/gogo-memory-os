import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeUserInputForRouting } from '../lib/bot/input-normalizer.ts'
import { sanitizeWhatsAppReply } from '../lib/channels/whatsapp.ts'

const cases:[string,string][]=[
  ['5Save this as reminder I travel to US on 27th September','Save this as reminder I travel to US on 27th September'],
  ['svae this as remider call Mom','save this as reminder call Mom'],
  ['shwo my reminders','show my reminders'],
  ['connect calender','connect calendar'],
  ['craete a cheklist for my trip','create a checklist for my trip'],
]
for(const [input,want] of cases){
  const got=normalizeUserInputForRouting(input).text
  assert.equal(got,want,`${input} -> ${want}`)
}

// Do not "correct" arbitrary content, names, brands or identifiers.
for(const input of [
  'Add soft bras from Uniqlo to my US trip list',
  'shopping for Keum',
  'seat QR-L1,L2,L3',
  'Find Zepto and Blinkit prices',
]) assert.equal(normalizeUserInputForRouting(input).text,input,`content must remain unchanged: ${input}`)

const safe=sanitizeWhatsAppReply('Something went wrong — try once more?')
assert.doesNotMatch(safe,/something went wrong/i,'generic infrastructure error must never be user-visible')
assert.match(safe,/temporarily unavailable/i,'fallback should be conversational and truthful')

const router=fs.readFileSync('lib/feature-intents.ts','utf8')
const claude=fs.readFileSync('lib/services/claude.ts','utf8')
assert.match(router,/normalizeUserInputForRouting\(text\)/,'feature router must normalize before deterministic routing')
assert.match(claude,/ANTHROPIC_FREEFORM_FAILED_FALLING_BACK/,'free-form provider failure must be observed')
assert.match(claude,/askOpenAiFallback/,'free-form reasoning must have configured second-provider path')
assert.match(claude,/OPENAI_FALLBACK_MODEL/,'fallback model must be configurable')

console.log('✅ Input typo/noise recovery + WhatsApp failure sanitization + model failover regression passed')
