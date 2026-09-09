import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const router=readFileSync(new URL('../lib/feature-intents.ts',import.meta.url),'utf8')
const bridge=readFileSync(new URL('../lib/agent/whatsapp-bridge.ts',import.meta.url),'utf8')

assert.match(router,/routeLegacyFeatureIntent/)
assert.match(router,/const legacy = await routeLegacyFeatureIntent/)
assert.match(router,/if \(legacy\) return legacy/)
assert.match(router,/tryRunWhatsAppAgent/)
assert.ok(router.indexOf('routeLegacyFeatureIntent(phone, text, extra)') < router.indexOf('tryRunWhatsAppAgent({ user, text })'),'legacy router must run before Muse bridge')

assert.match(bridge,/tryCreateWebWatchFromCommand/)
assert.match(bridge,/tryRunBrowserCommand/)
assert.match(bridge,/tryPrepareTravelCalendarPlan/)
assert.match(bridge,/tryRunExpiryReminderPlan/)
assert.match(bridge,/tryRunGeneralPlan/)
assert.match(bridge,/initializeBackgroundGoal/)
assert.match(bridge,/latestPendingApproval/)
assert.match(bridge,/Reply \*APPROVE\*/)
assert.match(bridge,/executeApprovedTravelCalendarPlan/)
assert.match(bridge,/executeApprovedBrowserCommand/)
assert.match(bridge,/resumeApprovedGeneralPlan/)

console.log('WhatsApp Muse bridge verification passed')
