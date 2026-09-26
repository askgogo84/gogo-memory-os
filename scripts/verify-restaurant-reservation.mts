import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  extractReservationRelease,
  isRestaurantReservationRequest,
  parseRestaurantReservationIntent,
} from '../lib/agent/restaurant-reservation'

const naruPrompt='Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM. If bookings are not open yet, monitor the release time and complete the reservation when it opens. Do not exceed any booking fee or deposit without asking me first.'
assert.equal(isRestaurantReservationRequest(naruPrompt),true)
const parsed=parseRestaurantReservationIntent(naruPrompt)
assert.ok(parsed)
assert.equal(parsed?.restaurant,'Naru Noodle Bar')
assert.equal(parsed?.partySize,2)
assert.equal(parsed?.preferredStart,'19:00')
assert.equal(parsed?.preferredEnd,'21:00')
assert.equal(parsed?.nextAvailable,true)
assert.equal(parsed?.requestedDate,'')

assert.equal(isRestaurantReservationRequest('Book me a dentist appointment in Bengaluru next week'),false)
assert.equal(isRestaurantReservationRequest('Remind me to book dinner tomorrow'),false)

const explicit=parseRestaurantReservationIntent('Reserve Naru Noodle Bar for 2 on 28th September 2026 between 7 PM and 9 PM.')
assert.equal(explicit?.requestedDate,'2026-09-28')

const providerText='SOLD OUT: Next opens on 28th September for bookings. Reservations open every Monday at 8 PM. Each slot duration is 90 minutes.'
const release=extractReservationRelease(providerText,'Asia/Kolkata',new Date('2026-09-26T12:00:00.000Z'))
assert.equal(release.soldOut,true)
assert.equal(release.releaseDate,'2026-09-28')
assert.equal(release.releaseTime,'20:00')
assert.equal(release.releaseAt,'2026-09-28T14:30:00.000Z')
assert.match(String(release.releaseRule),/2026-09-28/)
assert.match(String(release.releaseRule),/Monday/i)

const firstPartyText='Our online bookings open every Monday at 8:oopm. You can reserve your seat for dinner at 6:30pm or 8:30pm.'
const firstPartyRelease=extractReservationRelease(firstPartyText,'Asia/Kolkata',new Date('2026-09-26T12:00:00.000Z'))
assert.equal(firstPartyRelease.releaseDate,'2026-09-28')
assert.equal(firstPartyRelease.releaseTime,'20:00')
assert.equal(firstPartyRelease.releaseAt,'2026-09-28T14:30:00.000Z')
assert.match(String(firstPartyRelease.releaseRule),/Monday/i)

const agentRoute=fs.readFileSync('app/api/agent/run/route.ts','utf8')
const dashboardRoute=fs.readFileSync('app/api/dashboard/chat/route.ts','utf8')
const whatsappWebhook=fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const whatsappBridge=fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const bookingCron=fs.readFileSync('app/api/cron/booking-events/route.ts','utf8')
const reservation=fs.readFileSync('lib/agent/restaurant-reservation.ts','utf8')
const worker=fs.readFileSync('lib/agent/restaurant-reservation-worker.ts','utf8')
const genericLifeEventWorker=fs.readFileSync('lib/agent/life-event-worker.ts','utf8')
const autonomousCron=fs.readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')

assert.match(agentRoute,/tryRunRestaurantReservation/)
assert.ok(agentRoute.indexOf("const restaurantReservation = await tryRunRestaurantReservation") < agentRoute.indexOf("const appointmentFollowup = await tryRunAppointmentFollowup"), 'restaurant reservations must outrank appointment follow-up')
assert.match(dashboardRoute,/tryRunRestaurantReservation/)
assert.ok(dashboardRoute.indexOf("const restaurantReservation = await tryRunRestaurantReservation") < dashboardRoute.indexOf("const appointmentFollowup = await tryRunAppointmentFollowup"), 'dashboard restaurant routing must outrank appointment routing')
assert.match(whatsappWebhook,/isRestaurantReservationRequest/)
assert.ok(whatsappWebhook.indexOf('isRestaurantReservationRequest(text)') < whatsappWebhook.indexOf('const featureReply = await routeFeatureIntent'), 'WhatsApp reservation workflow must outrank legacy feature routing')
assert.match(whatsappBridge,/queueRestaurantReservationResearch/)
assert.doesNotMatch(whatsappBridge,/withWhatsAppBrowserBudget\(actor, tryRunRestaurantReservation/,'WhatsApp restaurant research must not die inside the 42s generic browser race')
assert.ok(whatsappBridge.indexOf('const restaurantReservation = await queueRestaurantReservationResearch') < whatsappBridge.indexOf('const appointmentRecovery = await'), 'durable restaurant queue must outrank appointment workflow')
assert.match(reservation,/restaurant_reservation_research/)
assert.match(reservation,/queueRestaurantReservationResearch/)
assert.match(reservation,/runQueuedRestaurantReservationResearch/)
assert.match(reservation,/Nothing will be booked or paid before the normal approval step/)
assert.match(autonomousCron,/runQueuedRestaurantReservationResearch/)
assert.match(autonomousCron,/restaurant_reservation_research/)
assert.match(autonomousCron,/reservationResearchClaimed/)
assert.match(autonomousCron,/300s worker owns the browser/)
assert.match(whatsappBridge,/armApprovedRestaurantReservation/)
assert.match(bookingCron,/processQueuedRestaurantReservations/)
assert.match(reservation,/known_provider_page/)
assert.match(reservation,/bookings\.airmenus\.in\/eatnaru\/order/)
assert.match(reservation,/discoverFirstPartyRulePage/)
assert.match(reservation,/restaurant_first_party_reservation_rules/)
assert.match(reservation,/first-party reservation policy/i)
assert.match(reservation,/RESTAURANT_FIRST_PARTY_RULE_INSPECTION_FAILED/)
assert.match(reservation,/\[oO0\]\{2\}/,'OCR-like 8:oopm release copy must normalize to 8:00pm')
assert.match(reservation,/maxBookingFeePaise:0/)
assert.match(reservation,/stop_before_fee_or_deposit/)
assert.doesNotMatch(reservation,/28th of every month/i)
assert.match(worker,/restaurant_reservation_outcome_unknown/)
assert.match(worker,/no automatic retry/i)
assert.match(worker,/approved booking fee\/deposit ceiling is ₹0/i)
assert.match(worker,/providerConfirmationVerified:true/)
assert.match(worker,/prepareBookingCalendarApproval/)
assert.match(genericLifeEventWorker,/neq\('action_key', 'restaurant-reservation-release'\)/)

console.log('✅ Restaurant reservation regression passed: provider-first release evidence → bounded approval → timed execution → verified completion')
