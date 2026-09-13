import assert from 'node:assert/strict'
import {
  calendarInputFromLifeEvent,
  lifecycleFingerprint,
  lifecycleMonitorTarget,
  lifecycleTerminalState,
} from '../lib/agent/life-event-integrations'

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
assert.doesNotMatch(delivery!.objective, /submit forms.*allowed/i)

const application = lifecycleMonitorTarget({
  event_type: 'application',
  metadata_json: { statusUrl: 'https://jobs.example/applications/1' },
})
assert.equal(application?.cadenceMinutes, 360)
assert.equal(lifecycleMonitorTarget({ event_type:'subscription', metadata_json:{statusUrl:'https://example.com'} }), null)
assert.equal(lifecycleMonitorTarget({ event_type:'delivery', metadata_json:{trackingUrl:'javascript:alert(1)'} }), null)

assert.deepEqual(lifecycleTerminalState('delivery', 'Your package was delivered at 14:10'), { terminal:true, label:'delivered' })
assert.deepEqual(lifecycleTerminalState('application', 'Congratulations — offer extended'), { terminal:true, label:'approved' })
assert.deepEqual(lifecycleTerminalState('application', 'Application is still under review'), { terminal:false, label:null })

assert.equal(lifecycleFingerprint('Status', 'In transit'), lifecycleFingerprint(' status ', '  in   transit '))
assert.notEqual(lifecycleFingerprint('Status', 'In transit'), lifecycleFingerprint('Status', 'Delivered'))

console.log('✅ Life-event calendar + lifecycle monitor integration regression passed')
