import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const engine=readFileSync(new URL('../lib/agent/goal-engine.ts',import.meta.url),'utf8')
const worker=readFileSync(new URL('../lib/agent/goal-worker.ts',import.meta.url),'utf8')
const route=readFileSync(new URL('../app/api/agent/goals/route.ts',import.meta.url),'utf8')
const resume=readFileSync(new URL('../app/api/agent/goals/[id]/resume/route.ts',import.meta.url),'utf8')
const cron=readFileSync(new URL('../app/api/cron/agent-goals/route.ts',import.meta.url),'utf8')
const vercel=readFileSync(new URL('../vercel.json',import.meta.url),'utf8')

assert.match(engine,/MAX_GOAL_STEPS = 8/)
assert.match(engine,/private_action: ONLY reversible private AskGogo actions/i)
assert.match(engine,/Never send email, modify calendar, submit forms, book, purchase, share externally, delete data/i)
assert.match(engine,/evaluateAgentExecutionPolicy/)
assert.match(engine,/evaluateAgentSentinel/)
assert.match(engine,/\['memory','reminders','lists','tasks'\]/)
assert.match(engine,/classified\.risk==='low'/)
assert.match(engine,/createGoalArtifact/)
assert.match(engine,/type:'goal_review'/)
assert.match(route,/initializeBackgroundGoal/)
assert.match(cron,/CRON_SECRET/)
assert.doesNotMatch(cron,/searchParams\.get\('secret'\)/)
assert.match(vercel,/\/api\/cron\/agent-goals/)

// A due watcher is claimed before execution so overlapping cron invocations cannot
// advance the same background goal step twice.
assert.match(worker,/GOAL_REVIEW_LEASE_MINUTES/)
assert.match(worker,/claimGoalWatcher/)
assert.match(worker,/eq\('id',watcher\.id\)\.eq\('active',true\)/)
assert.match(worker,/select\('id'\)\.maybeSingle\(\)/)
assert.match(worker,/if\(!\(await claimGoalWatcher\(watcher,now\)\)\)continue/)

// Background progress must be visible as a real Agent Activity run rather than
// living only inside goal JSON. The run is linked back to the goal/watcher and
// carries progress, next action and blockers for later audit/continuity.
assert.match(worker,/type:'background_goal_review'/)
assert.match(worker,/source:'background_goal'/)
assert.match(worker,/from\('agent_runs'\)\.insert/)
assert.match(worker,/from\('agent_activity'\)\.insert/)
assert.match(worker,/event_type:failed\?'goal_review_failed':'goal_review_progress'/)
assert.match(worker,/nextAction:goal\?\.next_action/)
assert.match(worker,/blockers:Array\.isArray\(goal\?\.blockers\)/)

// Meaningful progress and blockers surface proactively in the app, including the
// exact next action where one exists; a worker exception also produces a visible
// failed Activity item rather than silently disappearing.
assert.doesNotMatch(worker,/Gogo advanced a goal/)
assert.doesNotMatch(worker,/Gogo paused safely/)
assert.match(worker,/Needs your attention/)
assert.match(worker,/Goal complete/)
assert.match(worker,/Needs your input/)
assert.match(worker,/Next: \$\{next\}/)
assert.match(worker,/recordGoalReview\(\{telegramId,watcher,goal,triggered:false,failed:true,now\}\)/)
assert.match(worker,/sendAgentPush/)

// A human review must not strand a goal forever. The resume route resolves one
// blocked step, clears blockers, reactivates/creates the goal-review watcher and
// wakes it immediately. It never executes the blocked consequential action itself.
assert.match(resume,/status==='blocked'/)
assert.match(resume,/humanReviewed:true/)
assert.match(resume,/blockers:\[\]/)
assert.match(resume,/eq\('type','goal_review'\)|type:'goal_review'/)
assert.match(resume,/next_check_at:now/)
assert.doesNotMatch(resume,/dispatchThroughSameBrain|runSecureBrowser|sendWhatsAppMessage/)

console.log('agent background goals verification passed')

assert.doesNotMatch(engine,/Gogo needs your input on a goal/,'goal messages should not narrate backend goal machinery')
assert.doesNotMatch(engine,/Gogo paused a goal before a consequential step/,'goal approval message should be outcome-first')
assert.match(engine,/I need your input on:/)
assert.match(engine,/I need your approval before:/)
assert.match(engine,/is complete/)
console.log('Outcome-first goal messaging verification passed')

const whatsappBridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
assert.doesNotMatch(whatsappBridge,/Background Gogo has a .*step plan/,'WhatsApp should not expose plan machinery when creating a goal')
assert.match(whatsappBridge,/I’ll keep working on/)
assert.match(whatsappBridge,/I’ll only interrupt you if I need your input or approval/)
assert.match(whatsappBridge,/Dashboard → Goals/)
console.log('Outcome-first WhatsApp goal creation verification passed')


// P1 owner-precision regression: exercise the REAL transpiled goal worker with inert
// DB/WhatsApp dependencies. A rounded 64-bit owner must never resolve a neighbour
// and notify their phone or run a private Same Brain action.
{
  const { runInNewContext } = await import('node:vm')
  const ts = await import('typescript')
  const source = readFileSync(new URL('../lib/agent/goal-engine.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText

  async function exerciseOwner(requestedId: string, fetchedRowId: string) {
    const ownerLookups: Array<string | number> = []
    const sentTo: string[] = []
    const privateActions: string[] = []
    const db = {
      from(table: string) {
        const filters: Record<string, unknown> = {}
        const query: any = {
          select() { return this },
          update() { return this },
          eq(key: string, value: unknown) {
            filters[key] = value
            if (table === 'users' && key === 'telegram_id') ownerLookups.push(value as string | number)
            return this
          },
          async maybeSingle() {
            if (table === 'agent_goals') return {
              data: {
                id: 'goal-1', title: 'Check owner binding', outcome: 'Review safely',
                status: 'active', progress: 0,
                plan_json: { version: 1, steps: [{
                  id: 'g1', kind: 'review', title: 'Human review',
                  instruction: 'Review a harmless task.', status: 'pending',
                }] },
              },
              error: null,
            }
            if (table === 'users') {
              // Real PostgREST exact filtering behaves on the decimal sent by code;
              // the original Number(...) rounds a distinct 64-bit owner to victim.
              const lookup = String(filters.telegram_id)
              const found = requestedId === '9007199254740993'
                ? lookup === '9007199254740992'
                : lookup === '42'
              return {
                data: found
                  ? { id: 'db-row', telegram_id: fetchedRowId, whatsapp_id: 'whatsapp:+919900001122', name: 'Different owner' }
                  : null,
                error: null,
              }
            }
            return { data: null, error: null }
          },
          then(ok: (value: unknown) => unknown, bad?: (error: unknown) => unknown) {
            return Promise.resolve({ data: null, error: null }).then(ok, bad)
          },
        }
        if (table === 'agent_ideas') query.insert = () => Promise.resolve({ error: null })
        return query
      },
    }
    const runtime: Record<string, unknown> = {}
    const requireStub = (name: string) => {
      if (name === '@anthropic-ai/sdk') return {
        __esModule: true,
        default: class { messages = { create: async () => ({ content: [] }) } },
      }
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (name === '@/lib/channels/whatsapp') return {
        sendWhatsAppMessage: async (destination: string) => { sentTo.push(destination) },
      }
      if (name === './same-brain') return {
        dispatchThroughSameBrain: async () => { privateActions.push('dispatched'); return { text: 'ok', handledBy: 'fixture' } },
      }
      return {}
    }
    runInNewContext(js, { exports: runtime, require: requireStub, process, console, Date, setTimeout })
    const processWatcher = runtime.processGoalReviewWatcher as (watcher: unknown, now: Date) => Promise<unknown>
    const result = await processWatcher({
      id: 'watcher-1', telegram_id: requestedId, goal_id: 'goal-1', cadence_minutes: 60,
    }, new Date('2026-10-26T09:00:00Z'))
    return { ownerLookups, sentTo, privateActions, result }
  }

  const collision = await exerciseOwner('9007199254740993', '9007199254740992')
  assert.equal(collision.ownerLookups.length, 0, 'unsafe 64-bit owner must be rejected before any users lookup')
  assert.equal(collision.sentTo.length, 0, 'must never notify a rounded neighbouring owner')
  assert.equal(collision.privateActions.length, 0, 'must not dispatch on behalf of rounded owner')
  assert.equal((collision.result as any).failed, true, 'unverifiable owner pauses the goal')

  const mismatched = await exerciseOwner('42', '43')
  assert.equal(mismatched.ownerLookups.length, 1, 'valid owner reaches exact lookup')
  assert.equal(String(mismatched.ownerLookups[0]), '42')
  assert.equal(mismatched.sentTo.length, 0, 'DB row owner must match before contacting WhatsApp')
  assert.equal((mismatched.result as any).failed, true)

  const valid = await exerciseOwner('42', '42')
  assert.equal(valid.ownerLookups.length, 1, 'safe owner is not accidentally disabled')
  assert.equal(String(valid.ownerLookups[0]), '42')
  assert.equal(valid.sentTo.length, 1, 'valid human-review goal retains normal notification')
  assert.equal((valid.result as any).failed, false)
  assert.equal(valid.privateActions.length, 0, 'review steps never dispatch private actions')
  console.log('P1 exact-owner background-goal actor isolation: 3 inert cases passed')
}
