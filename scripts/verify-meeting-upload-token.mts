// Offline: recorder-link token binds the exact number, expires, and fails closed.
import assert from 'node:assert/strict'
import { signMeetingUploadToken, verifyMeetingUploadToken, meetingUploadE164 } from '../lib/security/meeting-upload-token.ts'

const env = { CRON_SECRET: 'fixture-secret-not-real' }
const now = Date.UTC(2026, 10, 9, 12, 0, 0)
const t = signMeetingUploadToken('+919900000001', now, env)
assert.match(t, /^\d+\.[a-f0-9]{64}$/)
assert.equal(verifyMeetingUploadToken(t, '+919900000001', now, env), true, 'valid token accepted')
assert.equal(verifyMeetingUploadToken(t, '9900000001', now, env), true, 'same number in local form accepted')
assert.equal(meetingUploadE164('9900000001'), '+919900000001')
assert.equal(verifyMeetingUploadToken(t, '+919900000002', now, env), false, 'other number refused')
assert.equal(verifyMeetingUploadToken(t, '+919900000001', now + 25 * 3600_000, env), false, 'expired refused')
assert.equal(verifyMeetingUploadToken(t, '+919900000001', now, { CRON_SECRET: 'other' }), false, 'other key refused')
assert.equal(verifyMeetingUploadToken(t, '+919900000001', now, {}), false, 'missing secret fails closed')
assert.equal(signMeetingUploadToken('+919900000001', now, {}), '', 'no token minted without secret')
assert.equal(verifyMeetingUploadToken('', '+919900000001', now, env), false)
assert.equal(verifyMeetingUploadToken(t.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), '+919900000001', now, env), false, 'tampered refused')
const far = `${Math.floor(now / 1000) + 30 * 86400}.${'0'.repeat(64)}`
assert.equal(verifyMeetingUploadToken(far, '+919900000001', now, env), false, 'over-long expiry refused')
assert.equal(verifyMeetingUploadToken(env.CRON_SECRET, '+919900000001', now, env), false, 'raw cron secret is not a token')
console.log('meeting upload token: exact-number binding, expiry and fail-closed checks passed (offline)')
