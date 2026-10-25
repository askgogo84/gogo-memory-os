import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const report=readFileSync('lib/agent/shadow-report.ts','utf8')
const api=readFileSync('app/api/admin/shadow-brain/route.ts','utf8')

assert.match(api,/requireAdminSession/)
assert.match(api,/getShadowBrainReport/)
assert.doesNotMatch(api,/POST|PUT|PATCH|DELETE/)

assert.match(report,/shadow_brain_observation/)
assert.match(report,/shadow_router_outcome/)
assert.match(report,/pairingRate/)
assert.match(report,/capabilityAgreementRate/)
assert.match(report,/contextualLegacyRate/)
assert.match(report,/contextual_turn_on_generic_or_legacy_router/)

// No raw user message/body content is selected or returned.
assert.doesNotMatch(report,/select\([^)]*message[^)]*\)/)
assert.doesNotMatch(report,/input_text|raw_text|body_text|user_text/i)

// Read-only report: no writes.
assert.doesNotMatch(report,/\.insert\(/)
assert.doesNotMatch(report,/\.update\(/)
assert.doesNotMatch(report,/\.delete\(/)

console.log('Shadow Brain report verification passed')
