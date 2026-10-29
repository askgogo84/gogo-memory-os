// 29 Oct evening live run (51 cases): the failures found and fixed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src = (p: string) => readFileSync(p, 'utf8')

// Security: codes in email subjects, secrets handed to Gogo.
const { redactEmailAuthSecrets } = await import('../lib/security/email-redaction')
assert.doesNotMatch(redactEmailAuthSecrets('690267 is your verification code'), /690267/)
assert.equal(redactEmailAuthSecrets('This is your order'), 'This is your order')
const pm = await import('../lib/bot/process-message')
assert.equal(pm.secretDeclaration('Save my card number 4111 1111 1111 1111'), 'card')
assert.equal(pm.secretDeclaration('My OTP is 482913'), 'otp')
assert.equal(pm.secretDeclaration('my wifi password is hunter22'), 'password')
assert.equal(pm.secretDeclaration('My pin code is 560086'), null, 'a postal PIN code is not a secret')
assert.equal(pm.secretDeclaration('Remind me to pay the card bill of 4500 tomorrow'), null)
assert.match(src('lib/bot/process-message.ts'), /I don't save full card numbers, so nothing was stored/)
console.log('✓ OTP subjects masked; card numbers, OTPs and passwords are refused, never "Saved"')

// Two asks in one message.
assert.deepEqual(pm.splitReminderAndQuestion("Remind me to pay rent on the 1st and also what's the weather tomorrow?"), { reminder: 'Remind me to pay rent on the 1st', question: "what's the weather tomorrow?" })
assert.equal(pm.splitReminderAndQuestion('Remind me to call Nithin tomorrow at 11 am'), null)
assert.equal(pm.splitReminderAndQuestion("What's the weather and remind me?"), null)
console.log('✓ a reminder plus a question gets both answered')

// Reminder wording.
const rem = await import('../lib/bot/handlers/reminders')
assert.equal(rem.tidyReminderMessage('that I have a meeting'), 'Meeting')
assert.equal(rem.tidyReminderMessage('go the gym'), 'Go to the gym')
assert.equal(rem.tidyReminderMessage('call Nithin'), 'call Nithin', 'untouched messages keep their case')
console.log('✓ "that I have a meeting" is saved as "Meeting"')

// Email: bulk drafts, and "Don't send" never inside the draft.
const gr = await import('../lib/bot/handlers/gmail-read')
assert.ok(gr.BULK_DRAFT_RE.test("Draft replies to my unread work emails from today. Don't send anything."))
const cands = await gr.bulkDraftCandidates([
  { from: 'Quora Digest <digest-noreply@quora.com>', subject: 'Is having big X worth it?', snippet: '' },
  { from: 'The Sapient Directive <notifications@x.com>', subject: '690267 is your verification code', snippet: '' },
  { from: 'Nithin K L <nithin@tipplr.in>', subject: 'Menu update for Toit', snippet: 'Can you confirm the prices by Friday?' },
])
assert.deepEqual(cands.map((c: any) => c.subject), ['Menu update for Toit'], 'only mail a person wrote gets a draft')
const gs = await import('../lib/agent/gmail-send')
const reply = gs.parseGmailReplyCommand("Draft a reply to my latest email saying I'll get back by Friday. Don't send.")!
assert.equal(reply.body, "I'll get back by Friday"); assert.equal(reply.draftOnly, true)
assert.equal(gs.parseGmailReplyCommand('Reply to the Vercel email saying thanks, will pay today')!.body, 'thanks, will pay today')
console.log('✓ draft replies skip newsletters and codes; "Don\'t send" stays out of the email')

// Spending statement for a named month.
const ex = await import('../lib/bot/services/expense-storage')
const sep = ex.namedMonthRange('Make my monthly spending statement for September', new Date('2026-10-29T12:00:00Z'))!
assert.equal(sep.month, '2026-09'); assert.equal(sep.label, 'September 2026')
assert.equal(sep.start, '2026-08-31T18:30:00.000Z'); assert.equal(sep.end, '2026-09-30T18:30:00.000Z')
assert.equal(ex.namedMonthRange('statement for December', new Date('2026-10-29T12:00:00Z'))!.month, '2025-12', 'a later month name means last year')
assert.equal(ex.namedMonthRange('my spending this week'), null)
assert.match(src('lib/feature-intents-legacy.ts'), /spending\|expenses\?\|spends\?\)\\s\+\(\?:statement\|report\|summary\|breakdown\)/)
assert.match(src('app/api/expenses/route.ts'), /Cash spends:\* anything you paid in cash/)
console.log('✓ "spending statement for September" reads all of September and asks about cash')

// Watches: a standing search, a price alert before any reminder, stopping by "alert"/"search".
const wc = await import('../lib/agent/watch-command')
const flat: any = wc.parseWebWatchCommand('Find me a 2BHK to rent in Rajajinagar under ₹35,000 and keep looking every day')
assert.ok(flat); assert.match(flat.query, /2BHK to rent in Rajajinagar under ₹35,000/); assert.equal(flat.cadenceMinutes, 1440)
const chat = src('app/api/dashboard/chat/route.ts')
assert.ok(chat.indexOf('if(earlyPrice||earlyKeepLooking){') > chat.indexOf('tryUnderstandFirst({') && chat.indexOf('if(earlyPrice||earlyKeepLooking){') < chat.indexOf('runCompoundShoppingFriendRequests('), 'price alerts are claimed right after understand-first, before planners')
assert.match(src('app/api/webhooks/whatsapp/route.ts'), /PRICE_WATCH_EARLY_FAILED/)
assert.match(src('lib/agent/watch-command.ts'), /\(\?:alerts\?\|search\|tracker\|tracking\|price\\s\+alert\)\\s\*\[\.!\]\*\$/)
console.log('✓ "keep looking every day" is a watch; price alerts are watches; "stop the X alert" stops it')

// Follow-up check on a reply.
const rw = await import('../lib/agent/reply-watch')
const fri = rw.parseReplyWatch("If Nithin doesn't reply to my last email by Friday, remind me", new Date('2026-10-29T13:00:00Z'))!
assert.equal(fri.name, 'Nithin'); assert.equal(fri.atIso, '2026-10-30T04:30:00.000Z', 'Friday 10:00 IST')
assert.equal(rw.replyCheckName(fri.message), 'Nithin')
assert.equal(rw.parseReplyWatch('Remind me to email Nithin on Friday'), null)
assert.match(src('app/api/cron/reminders/route.ts'), /latestEmailFrom\(Number\(reminder\.telegram_id\), name/)
console.log('✓ "if Nithin doesn\'t reply by Friday" checks Gmail on Friday and nudges only without a reply')

// Alerts, connections, follow-ups, documents.
const ap = await import('../lib/agent/alert-preferences-shared')
assert.equal(ap.alertFrequencyCommand('Message me less often, only important stuff'), 'less')
assert.equal(ap.alertFrequencyCommand('Remind me less often to drink water'), null)
assert.equal(ap.alertFrequencyCommand('message me more often'), 'more')
const less = ap.applyAlertFrequency(ap.DEFAULT_ALERT_PREFERENCES, 'less')
assert.equal(less.checkEveryMinutes, 240); assert.equal(less.topics.ideas, false); assert.equal(less.topics.bills, true)
const as = await import('../lib/agent/autonomy-status')
assert.equal(as.isConnectionCapabilityQuery('What apps are connected to you?'), true)
assert.equal(as.isConnectionCapabilityQuery('Which apps are good for budgeting?'), false)
const ol = await import('../lib/agent/open-loops')
assert.equal(ol.isOpenLoopQuery('Which emails am I waiting on replies for?'), true)
const jr = await import('../lib/agent/jev-router')
const jev: any = { ok: true, contextual: true, actionMode: { choice: 'consequential_write', confidence: 0.4 }, decisionReadiness: { choice: 'clarify', confidence: 0.95 }, referentKind: { choice: 'other_context', confidence: 0.3 } }
assert.match(jr.jevClarificationReply(jev, 'Ask Claude to review this business plan and summarise its feedback for me.')!, /^Send me the business plan first/)
assert.match(jr.jevClarificationReply(jev, 'Move it')!, /not certain which item/)
console.log('✓ "message me less often" changes alert settings; connected apps, waiting-on replies and missing documents are answered')

// Planner: reminders are private, a "review calendar" step never writes a month-long event.
assert.match(src('lib/agent/general-planner.ts'), /step\.tool === 'reminders' \|\| step\.tool === 'lists'/)
const mt = await import('../lib/agent/mission-tools')
assert.equal(mt.longSpanAllowed('2026-10-29', '2026-11-25', 'packing plan before my move'), false)
assert.equal(mt.longSpanAllowed('2026-11-12', '2026-11-14', 'Goa trip'), true)
assert.equal(mt.longSpanAllowed('2026-10-29', '2026-11-25', 'Europe trip'), true)
console.log('✓ planner reminders need no approval; no multi-week calendar block for a packing plan')

// Copy and local search.
assert.match(src('lib/agent/context-brain.ts'), /without mentioning lookups or retrieval/)
assert.match(src('lib/bot/process-message.ts'), /g\.status === 'blocked' \? ' \(needs your input\)'/)
assert.doesNotMatch(src('lib/agent/typed-time-routing.ts'), /clarify\(`The selected object is/)
const ws = await import('../lib/web-search')
assert.equal(ws.withHomeCity("Check what's playing at PVR Forum Mall", 'Bengaluru'), "Check what's playing at PVR Forum Mall Bengaluru")
assert.equal(ws.withHomeCity('PVR Lulu Mall Kochi', 'Bengaluru'), 'PVR Lulu Mall Kochi')
assert.equal(ws.withHomeCity('best electric scooters', 'Bengaluru'), 'best electric scooters')
console.log('✓ no "retrieval was incomplete", goals say "needs your input", cinemas default to the home city')
