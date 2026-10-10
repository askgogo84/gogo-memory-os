// Muse parity batch 2 (11 Oct live tests): 16 promised a 6-hourly check with no watch behind it;
// 18 drafted email replies went to web search; 37 subscriptions went to chat.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { guardChatActionClaims } = await import('../lib/bot/action-claim-guard.ts')
const live16 = "Got it boss. I'll check Tata Motors every 6 hours starting at 7:05 am IST today and alert you if it moves more than 2% since the last update."
assert.equal(guardChatActionClaims(live16).blocked, true, 'the exact live promise is blocked')
for (const t of ["I'll keep an eye on it and ping you when it drops", "I have set up an alert for you", "I'll monitor the price daily"]) assert.equal(guardChatActionClaims(t).blocked, true, t)
for (const t of ["I'll explain how SIPs work.", 'Tata Motors closed at ₹1,020 today.', 'Want me to set a reminder for that?']) assert.equal(guardChatActionClaims(t).blocked, false, t)

const { isStockMoveAlertRequest } = await import('../lib/bot/process-message.ts')
assert.equal(isStockMoveAlertRequest('Check Tata Motors every 6 hours and tell me if it moved more than 2% since your last update.'), true)
assert.equal(isStockMoveAlertRequest('alert me if Infosys drops 3%'), true)
assert.equal(isStockMoveAlertRequest('What is 2% of 500?'), false)

const { detectIntent } = await import('../lib/bot/detect-intent.ts')
assert.equal((await detectIntent("Draft replies to my unread work emails from today. Don't send anything.")).type, 'read_gmail')

const { subscriptionReviewText, readOnlySubscriptionAuditPlan } = await import('../lib/agent/general-planner.ts')
const t37 = 'Review my subscriptions, list amounts and renewal dates, and ask me which ones to cancel.'
assert.match(String(subscriptionReviewText(t37)), /last 90 days/)
assert.ok(readOnlySubscriptionAuditPlan(t37), 'the read-only Gmail audit runs')
assert.equal(subscriptionReviewText('Cancel my Netflix subscription'), null, 'a cancellation is not a review')
assert.match(readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), /Boolean\(subscriptionReviewText\(text\)\) \|\|/)

console.log('Muse batch 2 fixes: no promised monitoring from chat, stock alerts honest, email drafts to Gmail, subscriptions audit')
