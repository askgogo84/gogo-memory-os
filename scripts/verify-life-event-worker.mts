import assert from 'node:assert/strict'
import fs from 'node:fs'

const worker = fs.readFileSync('lib/agent/life-event-worker.ts', 'utf8')
const execution = fs.readFileSync('lib/agent/life-event-execution.ts', 'utf8')
const executeRoute = fs.readFileSync('app/api/agent/runs/[id]/execute/route.ts', 'utf8')
const cronRoute = fs.readFileSync('app/api/cron/life-events/route.ts', 'utf8')
const vercel = fs.readFileSync('vercel.json', 'utf8')

assert.match(worker, /prepare-web-checkin/)
assert.match(worker, /runSecureBrowser/)
assert.match(worker, /mode:\s*'draft'/)
assert.match(worker, /Do not submit check-in/)
assert.match(worker, /Do not purchase a paid seat or add-on/)
assert.match(worker, /checkin-submit-approval/)
assert.match(worker, /action_type:\s*'booking'/)
assert.match(worker, /Free allocation only/)
assert.match(worker, /No paid seat\/add-on without separate approval/)
assert.match(worker, /human_auth_required/)
assert.match(worker, /password, OTP, CAPTCHA, passkey/i)

// Booking reference can be used transiently inside the isolated browser objective,
// but the run metadata must only record that it exists, not the value itself.
assert.match(worker, /confirmation_ref_present:\s*true/)
assert.doesNotMatch(worker, /metadata:\s*\{[^}]*confirmationRef:/s)

assert.match(execution, /plan_type\s*\|\|\s*''\)\s*!==\s*'life_event_checkin'/)
assert.match(execution, /eq\('status',\s*'approved'\)/)
assert.match(execution, /Use free seat allocation only/)
assert.match(execution, /Do not buy baggage, meals, upgrades, insurance, priority boarding/)
assert.match(execution, /mode:\s*'execute'/)
assert.match(execution, /human_auth_required/)
assert.match(execution, /status:\s*'executed'/)
assert.match(execution, /lifecycle_state:\s*'watching'/)

assert.match(executeRoute, /executeApprovedLifeEventCheckin/)
assert.match(executeRoute, /planType === 'life_event_checkin'/)
assert.match(cronRoute, /CRON_SECRET/)
assert.match(cronRoute, /processDueLifeEventActions/)
assert.match(vercel, /\/api\/cron\/life-events/)
assert.match(vercel, /\*\/5 \* \* \* \*/)

console.log('✅ Life Event background executor regression passed')
