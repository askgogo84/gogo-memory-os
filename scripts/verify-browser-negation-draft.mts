import assert from 'node:assert/strict'
import { parseBrowserCommand } from '../lib/agent/browser-command'

// Exact live 3 Oct test incorrectly asked for purchase approval.
const amazonRead=parseBrowserCommand('Open https://www.amazon.in/ in the browser. Find Sony WH-1000XM5 headphones. Report the matching model, listed price and source only if visible. Read only. Do not sign in, add to cart or buy.')
assert.equal(amazonRead?.mode,'read')
assert.equal(amazonRead?.risk,'low')
assert.equal(amazonRead?.approvalAction,undefined)

const readOnly = parseBrowserCommand('Open https://example.com and inspect availability. Fill only safe non-sensitive search fields if needed. Make no provider-side changes. Stop before any final action, login, OTP, CAPTCHA, authentication challenge, or financial step.')
assert.ok(readOnly)
assert.equal(readOnly?.mode, 'draft')
assert.equal(readOnly?.approvalAction, undefined)

const execute = parseBrowserCommand('Open https://example.com and book this appointment for me.')
assert.ok(execute)
assert.equal(execute?.mode, 'execute')
assert.equal(execute?.approvalAction, 'booking')

// A URL path is navigation data, not authorization. `/booking` must not turn a
// read-only inspection into an execution request.
const bookingUrlRead = parseBrowserCommand('Open https://clinic.example/booking/doctor-123 and inspect live appointment slots. Do not book, confirm, call, or create anything.')
assert.ok(bookingUrlRead)
assert.equal(bookingUrlRead?.mode, 'read')
assert.equal(bookingUrlRead?.approvalAction, undefined)

const bookingUrlDraft = parseBrowserCommand('Open https://clinic.example/booking/doctor-123 and fill only safe search fields to reveal availability. Do not book or confirm anything.')
assert.ok(bookingUrlDraft)
assert.equal(bookingUrlDraft?.mode, 'draft')
assert.equal(bookingUrlDraft?.approvalAction, undefined)

const flightRead = parseBrowserCommand('Open https://airline.example/booking/search and check fares. Do not purchase, pay, book, or submit anything.')
assert.ok(flightRead)
assert.equal(flightRead?.mode, 'read')
assert.equal(flightRead?.approvalAction, undefined)

const explicitBooking = parseBrowserCommand('Open https://clinic.example/booking/doctor-123 and book the 4 PM slot for me.')
assert.ok(explicitBooking)
assert.equal(explicitBooking?.mode, 'execute')
assert.equal(explicitBooking?.approvalAction, 'booking')

console.log('✅ Browser appointment/travel negation + booking URL isolation regression passed')
