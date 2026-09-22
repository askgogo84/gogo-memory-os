import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAutonomyStatus, isConnectionStatus } from '../lib/agent/autonomy-status'

assert.equal(isAutonomyStatus('What are you working on for me?'),true)
assert.equal(isAutonomyStatus('Show me my agent status'),true)
assert.equal(isAutonomyStatus('What meetings do I have tomorrow?'),false)

assert.equal(isConnectionStatus('Which email am I connected to?'),true)
assert.equal(isConnectionStatus('What Google account am I connected to?'),true)
assert.equal(isConnectionStatus('Connect my calendar'),false)

const pulse=readFileSync('lib/agent/autonomy-pulse.ts','utf8')
const vercel=readFileSync('vercel.json','utf8')
const bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')

assert.match(pulse,/event_type:'autonomy_pulse_sent'/)
assert.match(pulse,/PULSE_COOLDOWN_MINUTES/)
assert.match(pulse,/quiet_hours/)
assert.match(pulse,/waiting_approval/)
assert.match(pulse,/life_events/)
assert.match(pulse,/agent_ideas/)
assert.match(vercel,/\/api\/cron\/autonomy-pulse/)
assert.match(bridge,/tryGetAutonomyStatus/)
assert.match(bridge,/tryGetConnectionStatus/)

console.log('Autonomy Pulse + live status verification passed')

assert.match(pulse,/stale_provider_access_limited/)
assert.match(pulse,/background_browser_resume_expired/)
assert.match(pulse,/fromMemoryTwin&&score<90/)
assert.match(pulse,/!fromMemoryTwin&&score<85/)
assert.match(pulse,/hasRecentWhatsAppSession/)
assert.match(pulse,/sendWhatsApp\(String\(user\.whatsapp_id\),message\)/)
assert.match(pulse,/sendWhatsAppReminderTemplate/)
assert.match(pulse,/delivery_mode:activeSession\?'freeform':'template'/)
console.log('Autonomy Pulse signal-quality and delivery-window verification passed')
