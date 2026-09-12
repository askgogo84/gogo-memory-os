import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isBookingOrEventLinkText, shouldTreatMediaAsLinkPreview } from '../lib/services/whatsapp-preview-routing'

const exactBookMyShowForward = "Hey there, we're watching Mirzapur: The Movie (A). Find ticket details and other benefits, here https://bmsurl.co/BMSTNY/5Mjc6DKmzL"

assert.equal(isBookingOrEventLinkText(exactBookMyShowForward), true)
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: exactBookMyShowForward, mediaType: 'image/jpeg', numMedia: 1, mediaUrl: 'https://api.twilio.com/example-preview-thumbnail' }), true, 'BookMyShow link thumbnail must be treated as preview media, not a user document')
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: 'My passport photo', mediaType: 'image/jpeg', numMedia: 1, mediaUrl: 'https://api.twilio.com/real-user-image' }), false, 'real user images must remain real images')
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: 'Dinner photo https://example.com/restaurant', mediaType: 'image/jpeg', numMedia: 1, mediaUrl: 'https://api.twilio.com/real-food-photo' }), false, 'a user photo with an incidental URL must not be suppressed')
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: 'Booking Details - BookMyShow https://in.bookmyshow.com/events/example', mediaType: 'image/png', numMedia: 1, mediaUrl: 'https://api.twilio.com/preview' }), true)

const route = fs.readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(route, /shouldTreatMediaAsLinkPreview/)
assert.match(route, /previewThumbnailOnly/)
assert.match(route, /isImageContentType\(firstMediaType\) && !previewThumbnailOnly/)
assert.match(route, /WHATSAPP_LINK_PREVIEW_MEDIA_IGNORED/)

const featureRouter = fs.readFileSync('lib/feature-intents.ts', 'utf8')
const queue = fs.readFileSync('lib/agent/booking-queue.ts', 'utf8')
assert.match(featureRouter, /queueBookingClosure/)
assert.match(featureRouter, /isBookingOrEventLinkText/)
assert.match(queue, /registerLifeEvent/)
assert.match(queue, /eventType:\s*'event'/)
assert.match(queue, /source:\s*'whatsapp_booking_link'/)
assert.match(queue, /I’m handling this booking now/)
assert.match(queue, /action_key:\s*'booking-closure'/)

console.log('✅ WhatsApp booking/link preview routing regression passed')
