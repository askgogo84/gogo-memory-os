import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  calendarInputFromLifeEvent,
  lifecycleFingerprint,
  lifecycleMonitorTarget,
  lifecycleTerminalState,
} from '../lib/agent/life-event-integrations'
import { buildLifeEventPlan } from '../lib/agent/life-event-engine'

const calendar = calendarInputFromLifeEvent({
  id: 'evt-1',
  event_type: 'reservation',
  title: 'Dinner at Kappa Chakka Kandhari',
  start_at: '2026-09-20T19:30:00+05:30',
  timezone: 'Asia/Kolkata',
  location: 'Bengaluru',
  provider: 'Restaurant',
  metadata_json: { sourceUrl: 'https://example.com/reservation/123' },
}, { id: 'action-1' })
assert.ok(calendar)
assert.equal(calendar?.lifeEventId, 'evt-1')
assert.equal(calendar?.lifeEventActionId, 'action-1')
assert.equal(calendar?.endEstimated, true)
assert.equal(Date.parse(calendar!.endAt) - Date.parse(calendar!.startAt), 60 * 60_000)

const explicitEnd = calendarInputFromLifeEvent({
  id: 'evt-2', event_type: 'event', title: 'Demo Day',
  start_at: '2026-09-21T10:00:00Z', end_at: '2026-09-21T13:00:00Z',
  timezone: 'UTC', metadata_json: {},
})
assert.equal(explicitEnd?.endEstimated, false)
assert.equal(explicitEnd?.endAt, '2026-09-21T13:00:00.000Z')
assert.equal(calendarInputFromLifeEvent({ event_type:'bill', start_at:'2026-09-20T10:00:00Z' }), null)

const delivery = lifecycleMonitorTarget({
  event_type: 'delivery',
  metadata_json: { trackingUrl: 'https://carrier.example/track/abc' },
})
assert.ok(delivery)
assert.equal(delivery?.cadenceMinutes, 60)
assert.match(delivery!.objective, /status only/i)
assert.match(delivery!.objective, /Do not .*cancel/i)

const application = lifecycleMonitorTarget({
  event_type: 'application',
  metadata_json: { statusUrl: 'https://jobs.example/applications/1' },
})
assert.equal(application?.cadenceMinutes, 360)

const appointment = lifecycleMonitorTarget({
  event_type: 'appointment',
  metadata_json: { bookingUrl: 'https://clinic.example/appointments/abc123' },
})
assert.ok(appointment)
assert.equal(appointment?.cadenceMinutes, 120)
assert.match(appointment!.objective, /appointment or reservation/i)
assert.match(appointment!.objective, /Do not book, confirm, cancel, reschedule/i)

const reservation = lifecycleMonitorTarget({
  event_type: 'reservation',
  metadata_json: { statusUrl: 'https://restaurant.example/reservations/xyz' },
})
assert.ok(reservation)
assert.equal(reservation?.cadenceMinutes, 120)

const flightWatch = lifecycleMonitorTarget({
  event_type:'travel', subtype:'flight', title:'Air India AI505',
  metadata_json:{ flightNo:'AI505' },
}, { payload_json:{} })
assert.ok(flightWatch)
assert.equal(flightWatch?.cadenceMinutes, 60)
assert.match(flightWatch!.url, /flightaware\.com\/live\/flight\/AI505/i)
assert.match(flightWatch!.objective, /flight status/i)
assert.match(flightWatch!.objective, /Do not check in/i)
assert.equal(lifecycleMonitorTarget({ event_type:'travel', subtype:'train', metadata_json:{flightNo:'AI505'} }), null)

assert.equal(lifecycleMonitorTarget({ event_type:'subscription', metadata_json:{statusUrl:'https://example.com'} }), null)
assert.equal(lifecycleMonitorTarget({ event_type:'delivery', metadata_json:{trackingUrl:'javascript:alert(1)'} }), null)

assert.deepEqual(lifecycleTerminalState('delivery', 'Your package was delivered at 14:10'), { terminal:true, label:'delivered' })
assert.deepEqual(
  lifecycleTerminalState('delivery', 'Previous orders: Shoes delivered yesterday. Current order AB123 is in transit.', { confirmationRef:'AB123' }),
  { terminal:false, label:null },
  'a delivered word from another order must not terminate the tracked order',
)
assert.deepEqual(
  lifecycleTerminalState('delivery', 'Previous orders: Shoes delivered yesterday. Order AB123 — current status: delivered.', { confirmationRef:'AB123' }),
  { terminal:true, label:'delivered' },
  'terminal status is valid when it is associated with the tracked order',
)
assert.deepEqual(
  lifecycleTerminalState('purchase', 'Help: delivered items can be returned within 7 days. Current status: shipped'),
  { terminal:false, label:null },
  'generic help/history text must not be interpreted as the current tracked status',
)
assert.deepEqual(lifecycleTerminalState('application', 'Congratulations — offer extended'), { terminal:true, label:'approved' })
assert.deepEqual(lifecycleTerminalState('application', 'Application is still under review'), { terminal:false, label:null })
assert.deepEqual(lifecycleTerminalState('appointment', 'Appointment ABC123 cancelled by the clinic', { confirmationRef:'ABC123' }), { terminal:true, label:'cancelled' })
assert.deepEqual(lifecycleTerminalState('appointment', 'Appointment ABC123 confirmed for tomorrow', { confirmationRef:'ABC123' }), { terminal:false, label:null })
assert.deepEqual(lifecycleTerminalState('reservation', 'Reservation XYZ completed', { confirmationRef:'XYZ' }), { terminal:true, label:'completed' })
assert.deepEqual(lifecycleTerminalState('travel', 'Flight AI505 cancelled'), { terminal:false, label:null }, 'flight watch alerts must not close the whole travel lifecycle')

const appointmentPlan = buildLifeEventPlan({
  telegramId: 1,
  eventType: 'appointment',
  subtype: 'doctor',
  source: 'test',
  title: 'Doctor appointment',
  startAt: '2026-09-20T10:00:00+05:30',
  timezone: 'Asia/Kolkata',
  metadata: { bookingUrl: 'https://clinic.example/appointments/abc123' },
}, Date.parse('2026-09-18T00:00:00Z'))
assert.ok(appointmentPlan.actions.some(a => a.actionKey === 'appointment-calendar-draft'))
assert.ok(appointmentPlan.actions.some(a => a.actionKey === 'appointment-readiness' && a.actionType === 'notify'))
assert.ok(appointmentPlan.actions.some(a => a.actionKey === 'appointment-change-watch' && a.actionType === 'monitor'))

const flightPlan = buildLifeEventPlan({
  telegramId: 1,
  eventType: 'travel',
  subtype: 'flight',
  source: 'travel_ticket_pdf',
  title: 'Air India AI 505 · Bengaluru → Delhi',
  provider: 'Air India',
  startAt: '2026-09-20T10:00:00+05:30',
  timezone: 'Asia/Kolkata',
  confirmationRef: 'ABC123',
  metadata: {
    airlineCode: 'AI',
    flightNo: 'AI505',
    checkinOpensAt: '2026-09-18T10:00:00+05:30',
    checkInUrl: 'https://www.airindia.com/check-in',
  },
}, Date.parse('2026-09-17T00:00:00Z'))
assert.ok(flightPlan.actions.some(a => a.actionKey === 'prepare-web-checkin'))
assert.ok(flightPlan.actions.some(a => a.actionKey === 'watch-boarding-pass-email'))
assert.ok(flightPlan.actions.some(a => a.actionKey === 'checkin-submit-approval' && a.requiresApproval && a.irreversible))
assert.ok(flightPlan.actions.some(a => a.actionKey === 'travel-disruption-watch'))

assert.equal(lifecycleFingerprint('Status', 'In transit'), lifecycleFingerprint(' status ', '  in   transit '))
assert.notEqual(lifecycleFingerprint('Status', 'In transit'), lifecycleFingerprint('Status', 'Delivered'))

const worker = fs.readFileSync('lib/agent/life-event-integration-worker.ts', 'utf8')
const cron = fs.readFileSync('app/api/cron/life-events/route.ts', 'utf8')
const bookingCalendar = fs.readFileSync('lib/agent/booking-calendar-execution.ts', 'utf8')
const flightBridge = fs.readFileSync('lib/agent/travel-ticket-life-event-bridge.ts', 'utf8')
const travelTickets = fs.readFileSync('lib/services/travel-tickets.ts', 'utf8')

assert.match(worker, /processCalendarDraft/)
assert.match(worker, /prepareBookingCalendarApproval/)
assert.match(worker, /processLifecycleMonitor/)
assert.match(worker, /runSecureBrowser/)
assert.match(worker, /mode:\s*'draft'/)
assert.match(worker, /evaluateAgentExecutionPolicy/)
assert.match(worker, /evaluateAgentSentinel/)
assert.match(worker, /processBillReview/)
assert.match(worker, /paymentExecuted:false/)
assert.match(worker, /Gogo has not paid, renewed, cancelled or changed anything/)
assert.match(worker, /lastFingerprint/)
assert.match(worker, /lifecycleTerminalState/)
assert.match(worker, /human_auth_required/)
assert.match(worker, /RETRY_BACKOFF_MINUTES/)
assert.match(worker, /retryOrBlock/)
assert.match(worker, /integrationRetryCount/)
assert.match(worker, /booking-change-watch/)
assert.match(worker, /DEDICATED_MONITOR_ACTION_KEYS/)

assert.match(flightBridge, /travel_tickets/)
assert.match(flightBridge, /findExistingLifeEvent/)
assert.match(flightBridge, /travel_ticket_id/)
assert.match(flightBridge, /ignoreDuplicates:true/)
assert.match(flightBridge, /Never reset lifecycle_state/)
assert.match(flightBridge, /while \(checked < ceiling\)/)
assert.match(flightBridge, /\.range\(offset, offset \+ take - 1\)/)
assert.match(flightBridge, /flightaware\.com\/live\/flight/)
assert.match(flightBridge, /registerLifeEvent/)
assert.match(flightBridge, /Backfill only/)
assert.match(flightBridge, /checkinOpensAt/)
assert.match(flightBridge, /checkInUrl/)
assert.match(flightBridge, /autonomousSource:'travel_ticket_bridge'/)
assert.doesNotMatch(flightBridge, /lifecycle_state:\s*'planned'/, 'bridge must never reset worker lifecycle state')
assert.match(travelTickets, /travel_tickets/)
assert.match(travelTickets, /planLegReminders/)
assert.match(travelTickets, /checkin_open_now/)

assert.match(cron, /syncUpcomingFlightTicketsToLifeEvents/)
assert.ok(cron.indexOf('syncUpcomingFlightTicketsToLifeEvents()') < cron.indexOf('processDueLifeEventEmailWatches()'), 'saved flights must be adopted before lifecycle workers run')
assert.match(cron, /processDueLifeEventIntegrations/)
assert.ok(cron.indexOf('processDueLifeEventIntegrations()') < cron.indexOf('processDueLifeEventActions()'), 'concrete integrations must run before the legacy fallback worker')
assert.match(cron, /CRON_SECRET/)

assert.match(bookingCalendar, /lifeEventActionId\?:string/)
assert.match(bookingCalendar, /life_event_action_id/)
assert.match(bookingCalendar, /life_event_actions/)
assert.match(bookingCalendar, /status:'completed'/)
assert.match(bookingCalendar, /bookingCalendarEventId/)
assert.match(bookingCalendar, /relinkExistingPending/)
assert.match(bookingCalendar, /approval_relinked/)
assert.match(bookingCalendar, /booking_calendar_persistence_failed/)

console.log('✅ Life-event calendar + safe saved-flight adoption + live disruption watch + appointment/reservation lifecycle regression passed')
