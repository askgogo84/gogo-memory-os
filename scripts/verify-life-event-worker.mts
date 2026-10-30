import assert from 'node:assert/strict'
import fs from 'node:fs'

const worker = fs.readFileSync('lib/agent/life-event-worker.ts', 'utf8')
const execution = fs.readFileSync('lib/agent/life-event-execution.ts', 'utf8')
const secureComputer = fs.readFileSync('lib/agent/secure-computer.ts', 'utf8')
const executeRoute = fs.readFileSync('app/api/agent/runs/[id]/execute/route.ts', 'utf8')
const whatsappBridge = fs.readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8')
const cronRoute = fs.readFileSync('app/api/cron/life-events/route.ts', 'utf8')
const checkinMigration = fs.readFileSync('supabase/life-events-v2-checkin-url.sql', 'utf8')
const vercel = fs.readFileSync('vercel.json', 'utf8')

assert.match(worker, /prepare-web-checkin/)
assert.match(worker, /runSecureBrowser/)
assert.match(worker, /mode:\s*'draft'/)
assert.match(worker, /evaluateAgentExecutionPolicy/)
assert.match(worker, /evaluateAgentSentinel/)
assert.match(worker, /agent_permissions/)
assert.match(worker, /capability:\s*'browser'/)
assert.match(worker, /Do not submit check-in/)
assert.match(worker, /Do not purchase (?:a paid |a )?seat or add-on/)
assert.match(worker, /checkin-submit-approval/)
assert.match(worker, /action_type:\s*'booking'/)
assert.match(worker, /Free allocation only/)
assert.match(worker, /No paid seat\/add-on without separate approval/)
assert.match(worker, /human_auth_required/)
assert.match(worker, /password, OTP, CAPTCHA, passkey/i)
assert.match(worker, /deferAction\(action, DEFER_PENDING_EXECUTOR_MINUTES/)
assert.match(worker, /due_at:\s*dueAt/)
assert.match(worker, /eq\('status', 'running'\)/)
assert.match(worker, /expectedStatus === 'running'.*eq\('updated_at', action\.updated_at\)/s)
assert.match(worker, /staleBefore/)
assert.match(worker, /reclaimed/)
assert.match(worker, /stopUncertainReclaimedCheckin/)
assert.match(worker, /checkin_execution_uncertain/)

assert.match(worker, /confirmation_ref_present:\s*true/)
assert.doesNotMatch(worker, /metadata:\s*\{[^}]*confirmationRef:/s)

assert.match(execution, /life_event_checkin/)
assert.match(execution, /evaluateAgentExecutionPolicy/)
assert.match(execution, /evaluateAgentSentinel/)
assert.match(execution, /agent_permissions/)
assert.match(execution, /approvalStatus:\s*'approved'/)
assert.match(execution, /irreversible:\s*true/)
assert.match(execution, /approved:\s*true/)
assert.match(execution, /eq\('status',\s*'approved'\)/)
assert.match(execution, /eq\('status', 'queued'\)/)
assert.match(execution, /agent_run_already_claimed/)
assert.match(execution, /hasCheckinSuccessEvidence/)
assert.match(execution, /finalAction\?\.kind === 'submit'/)
assert.match(execution, /terminalConfirmation/)
assert.doesNotMatch(execution, /\|boarding pass\|/)
assert.match(execution, /checkin_confirmation_not_verified/)
assert.match(execution, /checkin_execution_uncertain/)
assert.match(execution, /will not retry automatically/i)
assert.match(execution, /Use free seat allocation only/)
assert.match(execution, /Do not buy baggage, meals, upgrades, insurance, priority boarding/)
assert.match(execution, /mode:\s*'execute'/)
assert.match(execution, /human_auth_required/)
assert.match(execution, /status:\s*'executed'/)
assert.match(execution, /lifecycle_state:\s*'watching'/)

// Non-execute browser work may now click safe search/filter controls, but the
// browser still detects and blocks consequential submit/book/buy/check-in controls.
assert.match(secureComputer, /isConsequentialControl/)
assert.match(secureComputer, /consequential=await isConsequentialControl/)
assert.match(secureComputer, /payload\.mode!=='execute' && consequential/)
assert.match(secureComputer, /check\\s\*-\?\\s\*in/)
assert.match(secureComputer, /confirm\(\?:ation\)\?/)
assert.match(secureComputer, /safeResearch/)
assert.match(secureComputer, /consequential/)

assert.match(checkinMigration, /when '6E' then 'https:\/\/www\.goindigo\.in\/web-check-in\.html'/)
assert.match(checkinMigration, /when 'AI' then 'https:\/\/www\.airindia\.com\/in\/en\/manage\/webcheckin\.html|when 'AI' then 'https:\/\/www\.airindia\.com\/in\/en\/manage\/web-checkin\.html'/)
assert.match(checkinMigration, /when 'IX' then 'https:\/\/www\.airindiaexpress\.com\/checkin-home'/)
assert.match(checkinMigration, /when 'EY' then 'https:\/\/www\.etihad\.com\/en\/manage\/check-in'/)
assert.match(checkinMigration, /checkInUrlVerified/)
assert.match(checkinMigration, /Backfill existing promoted flights/)

assert.match(executeRoute, /executeApprovedLifeEventCheckin/)
assert.match(executeRoute, /planType === 'life_event_checkin'/)
assert.match(whatsappBridge, /executeApprovedLifeEventCheckin/)
assert.match(whatsappBridge, /planType === 'life_event_checkin'/)
assert.match(cronRoute, /CRON_SECRET/)
assert.match(cronRoute, /processDueLifeEventActions/)
assert.match(vercel, /\/api\/cron\/life-events/)
assert.match(vercel, /\*\/5 \* \* \* \*/)

// Actual resolver execution with an inert users-table fake: no provider,
// browser, real database, or user information is accessed by these cases.
const resolverSource = worker.match(/async function resolveActor\(telegramId: string\): Promise<AgentActor> \{[\s\S]*?\n\}/)?.[0]
assert.ok(resolverSource, 'must exercise the real life-event browser actor resolver')
const resolverJavaScript = resolverSource!
  .replace('telegramId: string', 'telegramId')
  .replace(': Promise<AgentActor>', '')
function inertLifeEventActorLookup(persisted: any) {
  const reads: Array<{ table: string; column: string; value: unknown }> = []
  const fakeSupabase = {
    from(table: string) {
      assert.equal(table, 'users', 'browser actor may only resolve through users')
      return {
        select(_columns: string) {
          return {
            eq(column: string, value: unknown) {
              reads.push({ table, column, value })
              return {
                async maybeSingle() { return { data: persisted, error: null } }
              }
            }
          }
        }
      }
    }
  }
  // The only generated code is the unchanged function body extracted above.
  // Its sole dependency is this strict synthetic users-table adapter.
  const resolve = new Function('supabaseAdmin', resolverJavaScript + '\nreturn resolveActor;')(fakeSupabase) as
    (owner: string) => Promise<{ userId: string; legacyTelegramId: number; whatsappId: string; name: string }>
  return { resolve, reads }
}
const ownerA = '9007199254740992'
const ownerB = '9007199254740993'
{
  const lookup = inertLifeEventActorLookup({
    id: 'synthetic-actor-A', telegram_id: ownerA, whatsapp_id: 'whatsapp:+15550000001', name: 'Account A',
  })
  await assert.rejects(lookup.resolve(ownerB), /life_event_actor_(?:unsafe_owner|owner_mismatch)/,
    'an adjacent 64-bit owner must not select another owner as browser actor')
  assert.equal(lookup.reads.length, 0, 'unsafe owner fails before private user lookup')
}
for (const malformed of ['', '01', '+42', '1e3', '9007199254740992', '9007199254740993', 'not-an-id']) {
  const lookup = inertLifeEventActorLookup({ id: 'synthetic-actor-A', telegram_id: '42' })
  await assert.rejects(lookup.resolve(malformed), /life_event_actor_unsafe_owner/,
    'noncanonical or unsafe browser actor owner must fail closed')
  assert.equal(lookup.reads.length, 0, 'invalid owner causes no private read')
}
{
  const lookup = inertLifeEventActorLookup({
    id: 'synthetic-actor-B', telegram_id: '43', whatsapp_id: 'whatsapp:+15550000002',
  })
  await assert.rejects(lookup.resolve('42'), /life_event_actor_owner_mismatch/,
    'a mismatched persisted user row must never become the check-in browser actor')
}
{
  const lookup = inertLifeEventActorLookup({
    id: 'synthetic-actor-42', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Synthetic',
  })
  const actor = await lookup.resolve('42')
  assert.equal(actor.userId, 'synthetic-actor-42')
  assert.equal(actor.legacyTelegramId, 42)
  assert.equal(actor.whatsappId, 'whatsapp:+15550000042')
  assert.deepEqual(lookup.reads, [{ table: 'users', column: 'telegram_id', value: '42' }],
    'query precise canonical string, never JavaScript Number')
}
{
  const lookup = inertLifeEventActorLookup({
    id: 'synthetic-actor-negative', telegram_id: -42, whatsapp_id: 'whatsapp:+15550000042',
  })
  assert.equal((await lookup.resolve('-42')).legacyTelegramId, -42)
  assert.equal(lookup.reads[0]?.value, '-42')
}

console.log('✅ Life Event background executor regression passed')
