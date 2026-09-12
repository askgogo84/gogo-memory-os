import assert from 'node:assert/strict'
import fs from 'node:fs'

const helper = fs.readFileSync('lib/services/whatsapp-preview-routing.ts', 'utf8')
const featureRouter = fs.readFileSync('lib/feature-intents.ts', 'utf8')
const closure = fs.readFileSync('lib/agent/booking-closure.ts', 'utf8')

assert.match(helper, /bmsurl\.co/)
assert.match(helper, /bookmyshow\.com/)
assert.match(helper, /we\(\?:'\|’\)re watching|we(?:'|’)re watching/)

// BookMyShow links now run the full booking-closure mission instead of the old
// recognition-only handleBookingEventLink path.
assert.match(featureRouter, /closeBookingLink/)
assert.match(featureRouter, /isBookingOrEventLinkText/)
assert.match(featureRouter, /sendWhatsAppMediaMessage/)
assert.match(featureRouter, /retrieveEventCredential/)

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

console.log('✅ BookMyShow booking closure intent regression passed')
