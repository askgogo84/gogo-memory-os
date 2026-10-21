// Round 6 → 7 fixes (21 Oct): the failures and flaws found in the live use-case run stay fixed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder'
process.env.OPENAI_API_KEY ||= 'ci-placeholder'
process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder'
const { detectIntent } = await import('../lib/bot/detect-intent.ts')
const { isGreeting, isHelpAsk, getDirectWhatsappPremiumReply } = await import('../lib/bot/handlers/whatsapp-direct-premium.ts')
const { isPendingAsk } = await import('../lib/bot/pending-summary.ts')
const { HELP_MENU } = await import('../lib/bot/handlers/welcome.ts')

// #39: a showtimes question is a lookup, never a reminder.
for (const q of ['Movies showing near Rajajinagar this Sunday evening', 'What movies are playing near Indiranagar on Saturday', 'Concerts happening in Bangalore this Friday'])
  assert.notEqual((await detectIntent(q)).type, 'set_reminder', q)
assert.equal((await detectIntent('Remind me Sunday evening to book movie tickets')).type, 'set_reminder', 'an explicit reminder still is one')

// #31, #34, #49: greeting and help get the approved copy on both surfaces.
for (const g of ['Hi', 'hello!', 'hey gogo', 'Hi there']) assert.ok(isGreeting(g), g)
for (const n of ['history', 'hi, book a table for 2']) assert.ok(!isGreeting(n), n)
for (const h of ['help', 'What can you do?', 'what can you do for me', 'show me the menu', 'Features']) {
  assert.ok(isHelpAsk(h), h)
  assert.equal(getDirectWhatsappPremiumReply(h)?.text, HELP_MENU, h)
}
assert.ok(!isHelpAsk('can you help me book a table'), 'a real request is not the help menu')

// #48: "What's pending?" is the person's own open items, not a web search.
for (const p of ["What's pending?", 'anything pending for me', 'what do I need to do today', "what's left"]) assert.ok(isPendingAsk(p), p)
for (const n of ["What's pending with my HDFC payment", 'Is the bank transaction pending?']) assert.ok(!isPendingAsk(n), n)

// The dashboard route answers these before any slow matcher.
const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(route.indexOf("import('@/lib/bot/handlers/welcome')") < route.indexOf('tryResolvePendingQuestion({'), 'quick replies run first')
assert.match(route, /handledBy: 'pending-summary'/)
// #22: a shouted reply goes back to sentence case; codes keep their case.
const { calmShouting, dropRedactedLinks } = await import('../lib/bot/format-response.ts')
const calm = calmShouting('YOUR CAR IS PARKED AT B2, SLOT 14. I SAVED THIS FOR YOU EARLIER TODAY.')
assert.match(calm, /^Your car is parked at B2, slot 14\. I saved this for you earlier today\.$/)
assert.equal(calmShouting('Your PNR is TSAJKDX for the IndiGo flight tomorrow morning.'), 'Your PNR is TSAJKDX for the IndiGo flight tomorrow morning.')
// #7: a link whose address carries the redaction marker keeps its words only.
assert.equal(dropRedactedLinks('Directed by Nelson ([Times of India](https://toi.in/articleshow/[sensitive detail withheld].cms))'), 'Directed by Nelson (Times of India)')
assert.doesNotMatch(dropRedactedLinks('See https://example.com/a/[sensitive detail withheld]/x for more'), /withheld/)
// #23: asking what Gogo remembers about a named booking is a saved-ticket lookup; "My bookings" is not.
const { isTicketRetrievalAsk, ticketQueryTokens } = await import('../lib/services/asset-memory.ts')
assert.ok(isTicketRetrievalAsk('What do you remember about my Jailer booking?'))
assert.ok(!isTicketRetrievalAsk('My bookings'))
assert.ok(!isTicketRetrievalAsk('book tickets for Jailer 2'))
assert.deepEqual(ticketQueryTokens('What do you remember about my Jailer booking?'), ['jailer'])
const uf = readFileSync('lib/agent/understand-first.ts', 'utf8')
assert.match(uf, /ticket_recall_specialist/)
// #14: a named reminder cancel goes straight to the reminder editor on the dashboard.
assert.match(route, /handledBy: 'edit-reminder'/)
console.log('Round 7 use-case fixes: showtimes, greeting, help, pending, caps, redaction, ticket recall and cancel routing passed')
