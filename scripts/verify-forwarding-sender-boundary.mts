// Synthetic only: Gmail forwarding-confirmation sender must match the actual mailbox,
// never an attacker-controlled display name or a suffix/lookalike domain.
import assert from 'node:assert/strict'
import { gmailForwardingConfirmation } from '../lib/email/mime'

const subject = '(#123456789) Gmail Forwarding Confirmation - Receive Mail from owner@example.test'
const text = 'Synthetic forwarding confirmation, no real account or provider.'
const message = (from: string) => ({ from, subject, text })

// This assertion intentionally fails against original source, which matches substrings.
for (const from of [
  '"forwarding-noreply@google.com" <attacker@example.test>',
  'Fake forwarding-noreply@google.com <attacker@example.test>',
  'forwarding-noreply@google.com.evil.test',
  'attacker+forwarding-noreply@google.com@evil.test',
  'attacker@example.test, forwarding-noreply@google.com',
  'Forwarding noreply at Google <attacker@example.test>',
]) {
  assert.equal(gmailForwardingConfirmation(message(from)), null,
    'A display-name substring or other mailbox cannot claim Gmail confirmation: ' + from)
}
for (const from of [
  'forwarding-noreply@google.com',
  'Google Forwarding <forwarding-noreply@google.com>',
  '"Gmail Forwarding" <forwarding-noreply@google.com>',
]) {
  const result = gmailForwardingConfirmation(message(from))
  assert.ok(result, 'Actual exact Gmail mailbox must retain legitimate confirmation handling: ' + from)
  assert.equal(result?.code, '123456789')
  assert.equal(result?.forwarder, 'owner@example.test')
}
assert.equal(gmailForwardingConfirmation({ from: 'Google Forwarding <forwarding-noreply@google.com>', subject: 'Ordinary news', text }), null)
console.log('PASS FORWARDING_SENDER_BOUNDARY: exact mailbox only, harmless subjects ignored; synthetic only')
