import assert from 'node:assert/strict'
import fs from 'node:fs'

const page=fs.readFileSync('app/dashboard/(app)/connections/page.tsx','utf8')
for(const name of ['Google Calendar','Gmail','Google Drive','Secure Browser','Vault','Travel context','CreditIQ']) {
  assert.ok(page.includes(name),`missing connection row: ${name}`)
}
assert.match(page,/Supported operations/)
assert.match(page,/Approval boundary/)
assert.match(page,/Verification/)
assert.match(page,/provider-grounded read-back/i)
assert.match(page,/outcome-unknown/i)
assert.match(page,/Secondary auth stays human-only/i)
assert.match(page,/inferred presence is labelled as inference/i)
assert.match(page,/gmail_send_connected/)
assert.match(page,/travel_tickets/)
assert.match(page,/agent_permissions/)
assert.match(page,/gmail_connected_at/)
assert.match(page,/google_calendar_connected_at/)
assert.doesNotMatch(page,/Healthy|All systems operational/i,'connections UI must not invent provider health')

console.log('✅ T6 Connections shows reach, supported operations, approval boundaries and genuine verification/availability')
