// 8 Nov live: "Ramayana movie" → "Nothing has been booked yet." The booking was the owner's own (from email); a reminder
// carried the ticket ("🎟️ Ramayana … AUDI 05, seats L16"), but no Life Event existed, so the guard found no evidence.
import assert from 'node:assert/strict'
import { guardCompletionClaimsWith, isTicketReminder } from '../lib/bot/completion-claim-guard'
const NOW = Date.parse('2026-11-08T16:22:40Z')
const ticket = { kind: 'booking' as const, label: '🎟️ Ramayana (3D)(Hindi) (U) at 10:00 PM at PVR: Orion Mall, Dr Rajkumar Ro…, AUDI 05, seats L16,', at: '2026-11-07T16:20:00Z' }
assert.equal(isTicketReminder(ticket.label), true)
assert.equal(isTicketReminder('Ramayana (3D) (Hindi) starts in 2 hours at PVR. Your ticket/QR is saved'), true)
assert.equal(isTicketReminder('book Ramayana tickets for Saturday'), false)
assert.equal(isTicketReminder('call Divya'), false)
// the named claim is now supported by the ticket reminder
let r = guardCompletionClaimsWith('Your Ramayana tickets are booked for tonight at 10 PM, Audi 05.', [ticket], [], NOW)
assert.equal(r.blocked, false)
// a different named booking is still blocked
r = guardCompletionClaimsWith('Your Coldplay tickets are booked for Saturday.', [ticket], [], NOW)
assert.equal(r.blocked, true)
// an unnamed claim with only an old ticket reminder is still blocked
r = guardCompletionClaimsWith('All set, booked!', [ticket], [], NOW)
assert.equal(r.blocked, true)
console.log('verify-claim-guard-ticket-reminder-nov9: 7 passed')
