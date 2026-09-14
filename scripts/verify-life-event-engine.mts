import assert from 'node:assert/strict'
import { buildLifeEventPlan, lifeEventDedupeKey } from '../lib/agent/life-event-engine'

const now = new Date('2026-09-11T06:00:00.000Z').getTime()

const flight = {
  telegramId: 1,
  eventType: 'travel' as const,
  subtype: 'flight',
  source: 'pdf',
  title: 'IndiGo 6E123 BLR → BOM',
  provider: 'IndiGo',
  startAt: '2026-09-15T04:30:00.000Z',
  confirmationRef: 'ABC123',
  location: 'BLR → BOM',
  metadata: {
    airlineCode: '6E',
    flightNo: '6E123',
    checkinOpensAt: '2026-09-13T04:30:00.000Z',
    checkInUrl: 'https://www.goindigo.in/web-check-in.html',
  },
}

const flightPlan = buildLifeEventPlan(flight, now)
assert.equal(flightPlan.lifecycleState, 'planned')
assert.equal(flightPlan.actions.some(a => a.actionKey === 'prepare-web-checkin' && a.requiresApproval === false), true)
assert.equal(flightPlan.actions.some(a => a.actionKey === 'checkin-submit-approval' && a.requiresApproval === true && a.irreversible === true), true)
assert.equal(flightPlan.actions.some(a => a.actionKey === 'watch-boarding-pass-email' && a.capability === 'email'), true)
assert.equal(flightPlan.actions.some(a => a.actionKey === 'travel-disruption-watch'), true)
assert.equal(flightPlan.actions.find(a => a.actionKey === 'prepare-web-checkin')?.payload.boundary, 'prepare_only_until_user_approval')

const concertPlan = buildLifeEventPlan({
  telegramId: 1, eventType: 'event', subtype: 'concert', source: 'image', title: 'Coldplay Live',
  startAt: '2026-10-18T13:30:00.000Z', location: 'DY Patil Stadium',
}, now)
assert.equal(concertPlan.actions.some(a => a.actionKey === 'event-calendar-draft' && a.requiresApproval), true)
assert.equal(concertPlan.actions.some(a => a.actionKey === 'event-readiness'), true)
assert.equal(concertPlan.actions.some(a => a.actionKey === 'event-change-watch'), true)

const appointmentPlan = buildLifeEventPlan({
  telegramId: 1, eventType: 'appointment', subtype: 'doctor', source: 'email', title: 'Dentist appointment',
  startAt: '2026-10-15T10:30:00.000Z',
}, now)
assert.equal(appointmentPlan.actions.some(a => a.actionKey === 'appointment-calendar-draft' && a.requiresApproval), true)
assert.equal(appointmentPlan.actions.some(a => a.actionKey === 'appointment-readiness'), true)
assert.equal(appointmentPlan.actions.some(a => a.actionKey === 'appointment-day-before'), true)

const purchasePlan = buildLifeEventPlan({
  telegramId: 1,
  eventType: 'purchase',
  subtype: 'online_order',
  source: 'email',
  title: 'Order #123',
  metadata: {
    estimatedDeliveryAt: '2026-09-14T10:00:00.000Z',
    returnDeadlineAt: '2026-09-30T18:30:00.000Z',
    warrantyEndsAt: '2027-09-12T00:00:00.000Z',
  },
}, now)
assert.equal(purchasePlan.actions.some(a => a.actionKey === 'delivery-monitor'), true)
assert.equal(purchasePlan.actions.some(a => a.actionKey === 'delivery-due'), true)
assert.equal(purchasePlan.actions.some(a => a.actionKey === 'return-deadline'), true)
assert.equal(purchasePlan.actions.some(a => a.actionKey === 'warranty-expiry'), true)
assert.equal(purchasePlan.actions.find(a => a.actionKey === 'delivery-monitor')?.payload.readReceiptAware, true)

const subscriptionPlan = buildLifeEventPlan({
  telegramId: 1,
  eventType: 'subscription',
  subtype: 'software',
  source: 'email',
  title: 'Annual software renewal',
  startAt: '2026-10-11T06:00:00.000Z',
  metadata: { cancellationDeadlineAt: '2026-10-08T06:00:00.000Z' },
}, now)
assert.equal(subscriptionPlan.actions.some(a => a.actionKey === 'bill-review'), true)
assert.equal(subscriptionPlan.actions.some(a => a.actionKey === 'renewal-notice'), true)
assert.equal(subscriptionPlan.actions.some(a => a.actionKey === 'cancellation-deadline'), true)
assert.equal(subscriptionPlan.actions.find(a => a.actionKey === 'bill-review')?.payload.neverAutoPay, true)

const passportPlan = buildLifeEventPlan({
  telegramId: 1,
  eventType: 'document',
  subtype: 'passport',
  source: 'image',
  title: 'Passport',
  endAt: '2027-02-10T00:00:00.000Z',
}, now)
assert.equal(passportPlan.actions.some(a => a.actionKey === 'document-expiry-30d'), true)
assert.equal(passportPlan.actions.some(a => a.actionKey === 'document-expiry-7d'), true)
assert.equal(passportPlan.actions.some(a => a.actionKey === 'document-renewal-prep'), true)
assert.equal(passportPlan.actions.find(a => a.actionKey === 'document-renewal-prep')?.payload.noExternalSubmission, true)

const keyA = lifeEventDedupeKey(flight)
const keyB = lifeEventDedupeKey({ ...flight })
assert.equal(keyA, keyB)
assert.equal(keyA.length, 40)

for (const step of [...flightPlan.actions, ...purchasePlan.actions, ...subscriptionPlan.actions, ...passportPlan.actions]) {
  if (step.actionType === 'approval') assert.equal(step.requiresApproval, true)
  assert.notEqual(step.payload['rawCardNumber'], true)
}

console.log('✅ Universal Life Event Engine regression passed across travel, appointments, purchases, subscriptions and documents')
