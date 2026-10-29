// 29 Oct live (WhatsApp): "Yes" to the offers question reached chat, which said "I’ll track … and notify you when"
// (curly apostrophe) with no watch created.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const g = await import('../lib/bot/action-claim-guard')
const live = 'Got it, boss. I’ll track the iPhone 16 128GB price on Croma and notify you when it hits below ₹65,000 (including offers).'
const r = g.guardChatActionClaims(live, { userText: 'Yes' })
assert.equal(r.blocked, true); assert.equal(r.text, g.NO_WATCH_REPLY)
assert.equal(g.guardChatActionClaims(live.replace('’', "'"), { userText: 'Yes' }).blocked, true)
const ok = 'Croma lists the iPhone 16 128GB at ₹79,900 today.'
assert.equal(g.guardChatActionClaims(ok).text, ok, 'a plain answer is returned unchanged')
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(wa, /const priceReply = text\.length <= 60/)
assert.match(wa, /if \(priceReply \|\| wc\?\.parsePriceWatchCommand\?\.\(text\)\)/)
console.log('✓ "Yes" to the offers question reaches the price watch on WhatsApp; "I’ll track" from chat is blocked')
