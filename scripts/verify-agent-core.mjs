import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8') }
function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

const types = read('lib/agent/types.ts')
const policy = read('lib/agent/policy.ts')
const runtime = read('lib/agent/runtime.ts')
const brain = read('lib/agent/same-brain.ts')
const route = read('app/api/gogo/run/route.ts')
const sql = read('supabase/agent-core-v1.sql')

check('agent surfaces are WhatsApp/iOS/Android/web', /'whatsapp'\s*\|\s*'ios'\s*\|\s*'android'\s*\|\s*'web'/.test(types))
check('new agent surface contract excludes Telegram', !/AgentSurface[^\n]*telegram/i.test(types))
check('canonical actor includes users.id', /userId:\s*string/.test(types))
check('legacy telegram id is explicitly compatibility-only actor data', /legacyTelegramId:\s*number/.test(types))
check('policy has green amber red levels', /'green'\s*\|\s*'amber'\s*\|\s*'red'/.test(types))
check('amber/red requests require confirmation', /confirmationRequired:\s*true/.test(policy))
check('runtime can pause for confirmation', /awaiting_confirmation/.test(runtime))
check('runtime can confirm an existing run', /confirmGogoAgentRun/.test(runtime))
check('runtime records visible agent steps', /createAgentStep/.test(runtime) && /updateAgentStep/.test(runtime))
check('agent reuses deterministic feature router', /routeFeatureIntent/.test(brain))
check('agent reuses production same-brain processor', /processIncomingMessage/.test(brain) && /channel:\s*'whatsapp'/.test(brain))
check('public web run endpoint is same-origin protected', /sameOrigin\(req\)/.test(route))
check('public web run endpoint derives identity from session', /getSession/.test(route) && /\.eq\('telegram_id', legacyTelegramId\)/.test(route))
check('client cannot choose arbitrary user identity', !/body\.(?:userId|telegramId|whatsappId)/.test(route))
check('agent schema persists runs', /create table if not exists public\.agent_runs/i.test(sql))
check('agent schema persists steps', /create table if not exists public\.agent_steps/i.test(sql))
check('agent schema supports only WhatsApp/native/web surfaces', /source_surface in \('whatsapp','ios','android','web'\)/.test(sql))
check('agent tables enable RLS', /alter table public\.agent_runs enable row level security/i.test(sql) && /alter table public\.agent_steps enable row level security/i.test(sql))

console.log('✅ agent core Phase 1 checks passed')
