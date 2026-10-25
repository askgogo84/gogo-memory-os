import assert from 'node:assert/strict'
import { buildHelpReply } from '../lib/bot/handlers/whatsapp-premium'
import { detectIntent } from '../lib/bot/detect-intent'

for (const phrase of ['What can you do?', 'what can you do', 'HELP!', 'menu?']) {
  assert.equal(detectIntent(phrase).type, 'help_menu', phrase)
}
const reply=buildHelpReply().toLowerCase()
for(const term of ['memory','documents','google workspace','inbox','drive','calendar','daily gogo','brief','remind','gogo agent','background gogo','expenses','lists','voice','approval']) {
  assert.ok(reply.includes(term), `help reply must mention: ${term}`)
}
console.log('help menu capability regression passed')
