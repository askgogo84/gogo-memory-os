import assert from 'node:assert/strict'
import fs from 'node:fs'

const helper = fs.readFileSync('lib/services/whatsapp-preview-routing.ts', 'utf8')
const featureRouter = fs.readFileSync('lib/feature-intents.ts', 'utf8')
const queue = fs.readFileSync('lib/agent/booking-queue.ts', 'utf8')
const closure = fs.readFileSync('lib/agent/booking-closure.ts', 'utf8')

assert.match(helper, /bmsurl\.co/)
assert.match(helper, /bookmyshow\.com/)
assert.match(helper, /we\(\?:'\|’\)re watching|we(?:'|’)re watching/)

// BookMyShow links acknowledge quickly and queue the expensive full closure mission.
assert.match(featureRouter, /queueBookingClosure/)
assert.match(featureRouter, /isBookingOrEventLinkText/)
assert.match(featureRouter, /sendWhatsAppMediaMessage/)
assert.match(featureRouter, /retrieveEventCredential/)
assert.doesNotMatch(featureRouter, /await closeBookingLink/)
assert.match(queue, /booking-closure/)
assert.match(queue, /opening the provider link and checking your connected email/i)

assert.match(closure, /titleFrom/)
assert.match(closure, /movie_booking/)
assert.match(closure, /bookingUrl/)
assert.match(closure, /resolvedUrl/)
assert.match(closure, /findGmailTicketEvidence/)
assert.match(closure, /readProviderTicketPage/)
assert.match(closure, /prepareBookingCalendarApproval/)
assert.match(closure, /booking-change-watch/)
assert.match(closure, /Ticket \/ QR captured and saved/)
assert.match(closure, /show my movie ticket/i)
assert.match(closure, /Provider-issued event entry credential/)

console.log('✅ BookMyShow queued booking closure intent regression passed')
