import assert from 'node:assert/strict'
import { buildHelpReply } from '../lib/bot/handlers/whatsapp-premium'

const reply=buildHelpReply().toLowerCase()
for(const term of ['memory','documents','google workspace','inbox','drive','calendar','daily gogo','brief','remind','gogo agent','background gogo','expenses','lists','voice','approval']) {
  assert.ok(reply.includes(term), `help reply must mention: ${term}`)
}
assert.ok(!reply.includes('content creation'), 'stale generic content-creation wording must stay out')
console.log('help menu capability regression passed')
