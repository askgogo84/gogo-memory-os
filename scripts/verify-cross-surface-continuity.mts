import assert from 'node:assert/strict'
import fs from 'node:fs'

const actor=fs.readFileSync('lib/agent/actor.ts','utf8')
const typed=fs.readFileSync('lib/agent/typed-object-context.ts','utf8')
const persistent=fs.readFileSync('lib/agent/persistent-general-plan.ts','utf8')
const dashboard=fs.readFileSync('app/api/dashboard/chat/route.ts','utf8')
const agentRoute=fs.readFileSync('app/api/agent/run/route.ts','utf8')
const whatsapp=fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const processMessage=fs.readFileSync('lib/bot/process-message.ts','utf8')

// One canonical owner identity must survive surface changes.
assert.match(actor,/legacyTelegramId/)
assert.match(actor,/whatsappId/)
assert.match(actor,/\.from\('users'\)/)
assert.match(actor,/\.eq\('telegram_id'/)

// Typed referents are stored owner-bound, not inside a single web/WhatsApp session.
assert.match(typed,/event_type:'typed_object_context'/)
assert.match(typed,/\.eq\('telegram_id',String\(telegramId\)\)/)
assert.doesNotMatch(typed,/surface:/)

// Persistent missions are owner-bound and carry source only as provenance.
assert.match(persistent,/\.eq\('telegram_id',String\(actor\.legacyTelegramId\)\)/)
assert.match(persistent,/source:\s*params\.surface/)
assert.match(persistent,/persistent_general_plan:\s*true/)

// Dashboard/web resolves the same canonical user/actor and uses the shared stores.
assert.match(dashboard,/resolveAgentActor\(\{ telegramId:String\(session\.telegramId\), surface:'web' \}\)/)
assert.match(dashboard,/\.from\('conversations'\)/)
assert.match(dashboard,/processIncomingMessage\(/)
assert.match(agentRoute,/resolveAgentActor\(session\)/)
assert.match(agentRoute,/tryRunPersistentGeneralPlan/)

// WhatsApp resolves the canonical user and writes the same conversation/agent state.
assert.match(whatsapp,/resolveUser/)
assert.match(whatsapp,/tryRunWhatsAppAgent/)
assert.match(whatsapp,/saveConversation/)
assert.match(processMessage,/\.from\('conversations'\)/)
assert.match(processMessage,/buildContextPack/)

// Tenant boundaries remain explicit on cross-surface state reads/writes.
assert.match(persistent,/\.eq\('telegram_id'/)
assert.match(typed,/\.eq\('telegram_id'/)
assert.match(agentRoute,/session\.telegramId/)

console.log('✅ T11 cross-surface continuity contract: canonical owner, shared context, persistent missions and tenant boundaries verified')
