// 26 Oct live: approved booking/cart runs told only WhatsApp how they ended; the dashboard thread showed nothing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const w = readFileSync(new URL('../lib/agent/approved-browser-worker.ts', import.meta.url), 'utf8')
assert.match(w, /async function recordThreadOutcome\(actor: AgentActor, text: string\)/)
assert.match(w, /from\('conversations'\)\.insert\(\{ telegram_id: actor\.legacyTelegramId, role: 'assistant'/)
assert.match(w, /if \(actor\.whatsappId\) await sendWhatsApp\(actor\.whatsappId, outcome\)\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+await recordThreadOutcome\(actor, outcome\)/, 'same text on WhatsApp and in the thread')
assert.match(w, /await recordThreadOutcome\(actor, failure\)\.catch/, 'failures are recorded too')
console.log('Approved run outcome in thread passed')
