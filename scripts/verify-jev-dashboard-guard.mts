import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
// 14 Oct: the dashboard chat gets the same Jev clarification guard WhatsApp has. When Jev is sure a
// contextual sentence does not say which object it means, Gogo asks instead of letting the broad planner
// act on the wrong one. Grounded reminder commands ("move it") are never second-guessed. Jev still only asks.
// Run: npx tsx scripts/verify-jev-dashboard-guard.mts
const actor = { legacyTelegramId: 101, userId: 'fixture-owner', whatsappId: 'fixture', name: 'Fixture' }
const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(file: string, mocks: Record<string, any>, fallback: any = {}) {
  const exports: any = {}
  vm.runInNewContext(compile(file), { exports, module: { exports }, require: (name: string) => mocks[name] || fallback, URL, console })
  return exports
}
const history: any[] = []
const db = { from(table: string) {
  const q: any = { select() { return q }, eq() { return q }, maybeSingle() { return q }, insert(rows: any) { assert.equal(table, 'conversations'); history.push(...(Array.isArray(rows) ? rows : [rows])); return q },
    then(resolve: any, reject: any) { return Promise.resolve({ data: table === 'users' ? { telegram_id: 101, whatsapp_id: 'fixture', name: 'Fixture' } : null, error: null }).then(resolve, reject) } }
  return q
} }
const jevRouter = load('lib/agent/jev-router.ts', { '@/lib/supabase-admin': { supabaseAdmin: db } })

let genericPlans = 0
let observed: any = null
const noops = new Proxy({}, { get: () => async () => null })
const routeMocks: any = {
  crypto: { randomUUID: () => 'fixture-event' },
  'next/server': { NextResponse: { json: (body: any, options?: any) => ({ body, status: options?.status || 200 }) } },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/dashboard/session': { getSession: async () => ({ telegramId: '101' }) },
  '@/lib/agent/actor': { resolveAgentActor: async () => actor },
  '@/lib/bot/handlers/friend-reminders': { detectFriendReminder: () => null, isFriendReminderFollowupCandidate: () => false },
  '@/lib/agent/watch-command': { tryGetWatcherStatusFromCommand: async () => null, tryRunPriceWatchClarification: async () => null, tryStopWatcherFromCommand: async () => null, tryUpdateWebWatchFromCommand: async () => null, tryCreateWebWatchFromCommand: async () => null, tryCreateInboxTriageWatchFromCommand: async () => null },
  '@/lib/dashboard/day-chat': { detectDashboardDayIntent: () => null },
  '@/lib/agent/read-only-schedule': { detectReadOnlyScheduleRequest: () => null },
  '@/lib/agent/shadow-brain': { observeShadowBrainTurn: async () => ({ jev: observed }) },
  '@/lib/agent/jev-router': jevRouter,
  '@/lib/agent/general-planner': { tryRunGeneralPlan: async () => { genericPlans++; return { handledBy: 'general-plan', text: 'planner ran', status: 'completed' } } },
}
const route = load('app/api/dashboard/chat/route.ts', routeMocks, noops)
const post = (text: string) => route.POST({ headers: { get: () => 'https://app.askgogo.in' }, nextUrl: { host: 'app.askgogo.in' }, json: async () => ({ text }) })
const jev = (over: Record<string, any> = {}) => ({
  ok: true, contextual: true,
  intent: { choice: 'reminder_mutation', confidence: 0.92 },
  decisionReadiness: { choice: 'clarify', confidence: 0.95 },
  referentKind: { choice: 'reminder', confidence: 0.9 },
  ...over,
})

// 1. Sure and contextual: ask, do not plan.
observed = jev()
let r = await post('Cancel the one I told you about')
assert.equal(r.body.handledBy, 'jev-clarification-guard')
assert.match(r.body.text, /not certain which reminder/i)
assert.equal(genericPlans, 0, 'the planner must not run when Jev asks which object')
assert.ok(history.some(row => row.role === 'assistant' && /not certain which reminder/i.test(row.content)), 'the question is saved to the conversation')

// 2. A grounded reminder command goes on to the normal handlers.
genericPlans = 0
r = await post('Move it to 5 pm')
assert.notEqual(r.body.handledBy, 'jev-clarification-guard')
assert.equal(genericPlans, 1, 'grounded reminder commands are not second-guessed')

// 3. Not sure enough, not contextual, or no reading: never asks.
for (const [label, reading] of [
  ['readiness below 0.9', jev({ decisionReadiness: { choice: 'clarify', confidence: 0.8 } })],
  ['ready', jev({ decisionReadiness: { choice: 'ready', confidence: 0.99 } })],
  ['not contextual', jev({ contextual: false })],
  ['classifier failed', { ...jev(), ok: false }],
  ['no reading', null],
] as const) {
  observed = reading; genericPlans = 0
  r = await post('Cancel the one I told you about')
  assert.notEqual(r.body.handledBy, 'jev-clarification-guard', label)
  assert.equal(genericPlans, 1, label + ': normal handling continues')
}

// 4. The grounded-command rule matches the WhatsApp route and stays out of calendar sentences.
const g = jevRouter.isGroundedReminderCommand
for (const t of ['move it to 5pm', 'what reminders do I have', 'show my reminders', 'reschedule that reminder', 'when is my reminder for the dentist']) assert.equal(g(t), true, t)
for (const t of ['move the meeting to 5pm', 'cancel the one I told you about', 'send it']) assert.equal(g(t), false, t)

// 5. The log line carries readiness and referent confidence.
const brain = fs.readFileSync('lib/agent/shadow-brain.ts', 'utf8')
assert.ok(brain.includes('readinessConfidence:') && brain.includes('referentConfidence:'))
// 6. The guard sits before the broad planner in the dashboard route.
const src = fs.readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(src.indexOf('jevClarificationReply(webObservation') > 0 && src.indexOf('jevClarificationReply(webObservation') < src.indexOf('await tryRunGeneralPlan'))
console.log('verify-jev-dashboard-guard: ok')
