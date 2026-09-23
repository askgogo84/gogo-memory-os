import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bridge=readFileSync(new URL('../lib/agent/whatsapp-bridge.ts',import.meta.url),'utf8')
assert.match(bridge,/capabilityIsOff\(actor\.legacyTelegramId,'reminders'\)/)
const jevPos=bridge.indexOf("if(params.intent==='reminder_read'||params.intent==='reminder_mutation')")
const jevGate=bridge.indexOf("capabilityIsOff(actor.legacyTelegramId,'reminders')",jevPos)
const jevExec=bridge.indexOf('tryRunExpiryReminderPlan',jevPos)
assert.ok(jevPos>=0&&jevGate>jevPos&&jevGate<jevExec,'Jev reminder specialist must enforce off before execution')
const genericPos=bridge.lastIndexOf('tryRunExpiryReminderPlan')
const genericGate=bridge.lastIndexOf("capabilityIsOff(actor.legacyTelegramId,'reminders')",genericPos)
assert.ok(genericGate>=0&&genericGate<genericPos,'generic compound reminder path must enforce off before execution')
console.log('reminder autonomy off gates cover Jev and compound paths')
