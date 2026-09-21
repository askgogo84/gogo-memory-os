import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page=readFileSync('app/admin/waitlist/page.tsx','utf8')
const admin=readFileSync('app/admin/page.tsx','utf8')

assert.match(page,/from\('waitlist'\)/)
assert.match(page,/phone_e164,email,country,whatsapp_opt_in,source,created_at,invited_at/)
assert.match(page,/Last 24 hours/)
assert.match(page,/Last 7 days/)
assert.match(page,/WhatsApp opt-in/)
assert.match(page,/Signup sources/)
assert.match(page,/name="q"/)
assert.match(page,/name="country"/)
assert.match(page,/name="optin"/)
assert.match(page,/name="status"/)
assert.match(page,/Invited/)
assert.match(page,/Waiting/)
assert.doesNotMatch(page,/\.update\(/)
assert.doesNotMatch(page,/\.insert\(/)
assert.doesNotMatch(page,/\.delete\(/)
assert.match(admin,/href="\/admin\/waitlist"/)
assert.match(admin,/waitlistCount/)

console.log('admin waitlist dashboard verification passed')
