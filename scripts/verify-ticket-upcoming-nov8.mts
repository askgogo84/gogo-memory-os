// 8 Nov live: "Show me my movie qr code" sent the 12 Sep Mirzapur ticket; tonight's Ramayana (10:00 PM) had no QR image saved.
import assert from 'node:assert/strict'
import { isEventCredentialRetrieval, pickUpcomingEvent } from '../lib/agent/booking-closure'
const NOW = Date.parse('2026-11-08T16:21:00Z') // 9:51 pm IST
const rows = [
  { title: 'Mirzapur: The Movie (A)', subtype: 'movie_booking', provider: 'BookMyShow', start_at: '2026-09-12T16:40:00Z' },
  { title: 'Ramayana (3D)(Hindi) (U)', subtype: 'movie_booking', provider: 'BookMyShow', start_at: '2026-11-08T16:30:00Z' },
  { title: 'Coldplay', subtype: 'event_booking', provider: 'District', start_at: '2026-12-01T13:30:00Z' },
]
assert.equal(isEventCredentialRetrieval('Show me my movie qr code'), true)
assert.equal(pickUpcomingEvent(rows, 'Show me my movie qr code', NOW)!.title, 'Ramayana (3D)(Hindi) (U)')
assert.equal(pickUpcomingEvent(rows, 'show my ticket', NOW)!.title, 'Ramayana (3D)(Hindi) (U)')
assert.equal(pickUpcomingEvent(rows, 'show my coldplay ticket', NOW)!.title, 'Coldplay')
assert.equal(pickUpcomingEvent(rows.slice(0, 1), 'Show me my movie qr code', NOW), null, 'a past ticket is never offered')
// started 2 h ago still counts (you are in the hall); 4 h ago does not
assert.ok(pickUpcomingEvent(rows, 'my movie ticket', Date.parse('2026-11-08T18:30:00Z')))
assert.equal(pickUpcomingEvent(rows.slice(0, 2), 'my movie ticket', Date.parse('2026-11-08T20:31:00Z')), null)
console.log('verify-ticket-upcoming-nov8: 7 passed')
