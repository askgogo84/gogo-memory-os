import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role'

const { inboundClaimNeedsRecovery } = await import('../lib/agent/brain-runtime-guard.ts')

const now=Date.parse('2026-09-21T12:00:00.000Z')
assert.equal(inboundClaimNeedsRecovery('completed',null,now),false)
assert.equal(inboundClaimNeedsRecovery('failed',null,now),true)
assert.equal(inboundClaimNeedsRecovery('claimed','2026-09-21T12:01:00.000Z',now),false)
assert.equal(inboundClaimNeedsRecovery('claimed','2026-09-21T11:59:00.000Z',now),true)
assert.equal(inboundClaimNeedsRecovery('claimed',null,now),true)

const whatsapp=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
assert.match(whatsapp,/claimInboundEvent\(\{/)
assert.match(whatsapp,/surface:'whatsapp'/)
assert.match(whatsapp,/eventKey:inboundMessageSid/)
assert.match(whatsapp,/WHATSAPP_INBOUND_DUPLICATE/)
assert.match(whatsapp,/acquireBrainUserLease\(brainUserKey, 90\)/)
assert.match(whatsapp,/brainUserKey = `user:\$\{resolvedUser\.telegramId\}`/)
assert.match(whatsapp,/releaseBrainUserLease/)
assert.match(whatsapp,/completeInboundEvent/)
assert.match(whatsapp,/failInboundEvent/)
assert.match(whatsapp,/status: 503/)

const telegram=readFileSync('app/api/webhooks/telegram/route.ts','utf8')
assert.match(telegram,/claimInboundEvent\(\{/)
assert.match(telegram,/surface:'telegram'/)
assert.match(telegram,/body\?\.update_id/)
assert.match(telegram,/resolveUser\(\{ channel:'telegram'/)
assert.match(telegram,/acquireBrainUserLease\(brainUserKey, 90\)/)
assert.match(telegram,/releaseBrainUserLease/)
assert.match(telegram,/completeInboundEvent/)
assert.match(telegram,/failInboundEvent/)
assert.match(telegram,/status:503/)

const guard=readFileSync('lib/agent/brain-runtime-guard.ts','utf8')
assert.match(guard,/inbound_event_reclaim_failed/)
assert.match(guard,/existingStatus==='failed'/)
assert.match(guard,/lease_until/)
assert.match(guard,/owner_token:ownerToken/)

console.log('Brain runtime inbound idempotency + serialization verification passed')
