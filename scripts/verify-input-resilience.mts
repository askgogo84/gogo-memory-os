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

for(const input of [
  'Add soft bras from Uniqlo to my US trip list',
  'shopping for Keum',
  'seat QR-L1,L2,L3',
  'Find Zepto and Blinkit prices',
  'Add Calandar to my baby names',
  'Remember that my project codename is Remider',
  'create a checklist:\n1. Calandar\n2. Remider\n3. Keum',
]) assert.equal(normalizeUserInputForRouting(input).text,input,`content must remain unchanged: ${input}`)

const safe=sanitizeWhatsAppReply('Something went wrong — try once more?')
assert.doesNotMatch(safe,/something went wrong/i,'exact generic infrastructure error must never be user-visible')
assert.match(safe,/temporarily unavailable/i,'fallback should be conversational and truthful')

for(const input of [
  'Your subscription setup hit an error: something went wrong. Reply *upgrade* to try again.',
  'Draft: "Something went wrong in yesterday’s demo, but we recovered."',
  'I found the root cause — something went wrong only after the provider redirect.',
]) assert.equal(sanitizeWhatsAppReply(input),input,`legitimate content must survive sanitizer: ${input}`)

const router=fs.readFileSync('lib/feature-intents.ts','utf8')
const claude=fs.readFileSync('lib/services/claude.ts','utf8')
assert.match(router,/normalizeUserInputForRouting\(text\)/,'feature router must normalize before deterministic routing')
assert.match(router,/if\(normalized\.changed\)[\s\S]*dispatchThroughSameBrain\(\{actor,text\}\)/,'repaired commands declined by specialist routing must continue through the mature brain with repaired text')
assert.match(claude,/OPENAI_ROUTINE_FAILED_FALLING_BACK/,'routine provider failure must be observed')
assert.match(claude,/ANTHROPIC_PREMIUM_FALLBACK_FAILED/,'premium fallback failure must be observed')
assert.match(claude,/OPENAI_ROUTINE_MODEL/,'routine model must be configurable')
assert.match(claude,/runRoutineWithPremiumFallback/,'routine reasoning must use cheap-primary/premium-fallback path')

console.log('✅ Input typo/noise recovery + payload preservation + downstream propagation + WhatsApp failure sanitization + cost-safe provider failover regression passed')
