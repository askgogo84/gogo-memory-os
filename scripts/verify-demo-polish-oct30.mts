// 30 Oct demo polish: Muse 16 (% move every 6 h), Muse 20 (no invented product claims), Muse 26 (plan without notes).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sr = await import('../lib/agent/stock-rule')
const m16 = sr.parseStockWatchCommand('Check Tata Motors every 6 hours and tell me if it moved more than 2% since your last update.')
assert.deepEqual(m16, { company: 'Tata Motors', kind: 'move', direction: 'any', pct: 2, level: null, defaulted: false, cadenceMinutes: 360 })
assert.equal(sr.parseStockWatchCommand('Check Tata Motors share price and alert me if it moves 3%')?.company, 'Tata Motors', '"Check" is not part of the company')
assert.equal(sr.parseStockWatchCommand('Check the iPhone 16 price and tell me if it moved more than 2%'), null, 'products are not share watches')
assert.equal(sr.parseStockWatchCommand('Tell me if Bitcoin moved 5%'), null)
assert.equal(sr.parseStockWatchCommand('Remind me to check Tata Motors at 5 pm'), null)
assert.match(readFileSync('lib/agent/stock-watch.ts', 'utf8'), /I check \$\{pace\} during market hours/)
const cw = readFileSync('lib/agent/content-workflows.ts', 'utf8')
assert.match(cw, /Never add capabilities, security claims/)
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /Missing saved notes or details are not ambiguity/)
assert.match(readFileSync('lib/services/claude.ts', 'utf8'), /PLANS FROM SAVED NOTES/)
console.log('✓ % move watches every N hours; launch posts never invent features; plans come even without saved notes')

// Email attention names the problem; planner and reminder receipts read like a person.
const att = await import('../lib/email/attention')
assert.equal(att.problemReason('[askgogo84/gogo-memory-os] PR run failed: AskGogo CI - security(P1)'), 'Security alert')
assert.equal(att.problemReason('[askgogo84/gogo-memory-os] PR run failed: Watch trip delivery status'), 'A build or CI run failed')
assert.equal(att.problemReason('Payment Failed And Shutdown Coming Soon'), 'Payment failed')
assert.equal(att.problemReason('Refund failed for your order'), 'Problem with an order')
const mt = await import('../lib/agent/mission-tools')
const now = new Date('2026-10-30T07:00:00Z')
assert.equal(mt.friendlyReminderWhen('2026-10-30T12:30:00Z', 'Asia/Kolkata', now), 'today at 6:00 pm')
assert.equal(mt.friendlyReminderWhen('2026-10-31T03:30:00Z', 'Asia/Kolkata', now), 'tomorrow at 9:00 am')
assert.match(mt.friendlyReminderWhen('2026-11-03T03:30:00Z', 'Asia/Kolkata', now), /^Tue, 3 Nov at 9:00 am$/)
const gp = readFileSync('lib/agent/general-planner.ts', 'utf8')
assert.match(gp, /receipts\.push\(String\(result\.text\)\)/)
assert.match(readFileSync('lib/agent/mission-tools.ts', 'utf8'), /📝 Added \$\{added\.join\(', '\)\} to your/)
console.log('✓ CI failures say so; "today at 6:00 pm"; a list + reminder plan reports both')

// Muse 20 live (30 Oct): unsupported launch claims are caught and rewritten once.
const cwm = await import('../lib/agent/content-workflows')
const post = 'We spent 8 months building it. End-to-end encrypted. Zero-knowledge architecture. Vault makes AskGogo the only AI assistant you can trust. Used by 2,000 users.'
const claims = cwm.unsupportedClaims(post, "Draft a LinkedIn post about launching AskGogo's Vault, in my style.")
for (const c of ['8 months', 'End-to-end encrypted', 'Zero-knowledge architecture', '2,000 users']) assert.ok(claims.some(x => x.toLowerCase().includes(c.toLowerCase())), `${c} flagged: ${claims}`)
assert.ok(claims.some(x => /^the only/i.test(x)))
assert.deepEqual(cwm.unsupportedClaims('Vault keeps documents encrypted for you.', 'Vault stores documents encrypted at rest'), [], 'a claim from the saved notes is allowed')
assert.match(cwm.claimRewriteRequest('Draft a post', post, claims), /remove every one of these claims/)
assert.match(readFileSync('lib/bot/process-message.ts', 'utf8'), /CONTENT_UNSUPPORTED_CLAIMS/)
console.log('✓ launch posts with invented numbers, security or "the only" claims are rewritten without them')

// 30 Oct live: "Summarise my week" listed a queued Toit table as booked; brain replies used **bold**.
const br = await import('../lib/agent/brain')
assert.equal(br.whatsAppMarkdown('**Preferences**\n## Week\n• **Tomorrow:** flight'), '*Preferences*\nWeek\n• *Tomorrow:* flight')
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /queued, running or waiting for approval is not done/)
assert.match(readFileSync('lib/agent/understanding-context.ts', 'utf8'), /— not done yet/)
console.log('✓ brain replies use WhatsApp bold and never present a queued booking as done')

// RL03 live: the grocery reminder was saved as "Set purchase reminder".
assert.equal(mt.reminderTaskFromRequest('Make a grocery list with milk, eggs and bread and remind me to buy them at 6 pm today'), 'buy milk, eggs and bread')
assert.equal(mt.reminderTaskFromRequest('Plan my week and remind me to call Nithin tomorrow at 11 am'), 'call Nithin')
assert.equal(mt.reminderTaskFromRequest('Plan my packing'), null)
assert.ok(cwm.unsupportedClaims('Your life is scattered across 47 apps and 6 inboxes.', 'Draft a post').length >= 2)
console.log('✓ planner reminders use the person\'s words; invented counts are caught')
