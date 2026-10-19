// Muse "what are you working on" / per-task status cards (19 Oct). "any update?", "status?",
// "how's the Goa trip going", "what's happening with my booking" and "status of my flight booking
// task" read the owner's own tasks. Live flight status, the usage meter, shop orders, reminders,
// news and calendar reads keep their own handlers. Run: npx tsx scripts/verify-task-status-query.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
// Placeholders only so module-level clients construct; every read below goes through injected deps.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder-service-role-key'
process.env.OPENAI_API_KEY ||= 'ci-placeholder-openai-key'; process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder-anthropic-key'

const ts_ = await import('../lib/agent/task-status.ts')
const { parseTaskStatusQuery, formatRunStatus, tryGetTaskStatus, matchRunByTitle, lastRunActivity } = ts_
const { isAutonomyStatus } = await import('../lib/agent/autonomy-status.ts')
const { detectIntent } = await import('../lib/bot/detect-intent.ts')
const { isUsageCommand } = await import('../lib/bot/process-message.ts')
const { isOpenLoopQuery } = await import('../lib/agent/open-loops.ts')
const { isOrderStatusQuestion } = await import('../lib/agent/order-email-status.ts')

// 1. General asks -> the "what Gogo is working on" digest.
for (const t of ['any update?', 'Any updates?', 'status?', 'Status', 'status update please', "what's the status?", 'what is the status',
  'what are you working on', 'What are you working on for me?', 'what are u working on right now', "what're you working on",
  'what are you doing for me', 'Show me my agent status', 'how are my tasks going', 'status of my tasks', 'any updates on my tasks',
  "what’s happening with my tasks", 'Gogo, any update?', 'give me a status update']) {
  assert.equal(isAutonomyStatus(t), true, `general status: ${t}`)
  assert.deepEqual(parseTaskStatusQuery(t), { kind: 'all' }, `general parse: ${t}`)
}

// 2. Named asks -> one task.
const named = (t: string) => { const q = parseTaskStatusQuery(t); assert.equal(q?.kind, 'named', t); return (q as any).phrase as string }
assert.equal(named("how's the Goa trip going"), 'goa trip')
assert.equal(named('How is my Goa trip coming along?'), 'goa trip')
assert.equal(named("what's happening with my booking"), 'booking')
assert.match(named('status of my flight booking task'), /^flight booking/)
assert.match(named("what's the status of my flight booking task?"), /^flight booking/)
assert.equal(named('any update on the Toit reservation?'), 'toit reservation')
assert.equal(named('where are we on my passport renewal'), 'passport renewal')
for (const t of ["how's the Goa trip going", "what's happening with my booking", 'status of my flight booking task'])
  assert.equal(isAutonomyStatus(t), false, `named asks are not the general digest: ${t}`)

// 3. CRITICAL negatives: other handlers own these; neither status matcher may claim them.
const negatives = [
  "what's the status of flight 6E123", 'flight status AI 505', 'what is the status of AI 505', 'is 6E203 delayed?', "how's my flight",
  'what is my usage', "what's my usage", 'usage status', 'usage', 'show my plan usage this month',
  'status of my order on amazon', 'Where is my Amazon order?', "what's happening with my swiggy order", 'status of my delivery',
  "what's my reminder status", 'status of my reminders', 'any update on the news', 'any news', "what's the latest",
  "what's on my calendar tomorrow", 'What meetings do I have tomorrow?', 'status of my meeting with Srini', "how's my day looking",
  "how's the weather", 'status of my gmail', 'status of my price watch', 'how are my investments doing', 'how is my goal going',
  'show my pending tasks', 'my pending tasks', 'my tasks', 'tasks', 'show tasks',
  'status of my booking and cancel it', 'what is the status of my booking, then rebook', 'how are you doing', "how's it going",
  'what are you doing tonight', 'update my address', 'plan a trip to Goa',
  // personal phrasings are about life, not a task card (19 Oct review)
  'how is my mom doing', "how's my mom doing", 'How is my dad doing?', 'how is my wife doing', 'how is my business doing',
  'how is my business going', "how's my health doing", 'how are you doing?', 'how is my family doing', 'how is my startup going',
]
for (const t of negatives) {
  assert.equal(parseTaskStatusQuery(t), null, `must not claim: ${t}`)
  assert.equal(isAutonomyStatus(t), false, `general digest must not claim: ${t}`)
}
// ...and their owners still have them.
for (const t of ["what's the status of flight 6E123", 'flight status AI 505', 'what is the status of AI 505'])
  assert.equal((await detectIntent(t)).type, 'web_search', `live flight status keeps its lookup: ${t}`)
for (const t of ['what is my usage', "what's my usage", 'usage']) assert.equal(isUsageCommand(t), true, `meter keeps: ${t}`)
assert.equal(isOrderStatusQuestion('Where is my Amazon order?'), true, 'order email status keeps shop orders')
assert.equal(isOpenLoopQuery('show my pending tasks'), true, 'open loops keeps pending tasks')
assert.equal((await detectIntent('any update on the news')).type, 'web_search', 'news keeps its search')
console.log('PASS parser: general, named and negative routes')

// 4. Formatter copy.
const NOW = new Date('2026-10-19T10:00:00.000Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString()
const run = (over: any) => ({ id: 'r1', telegram_id: '100', title: 'Goa trip plan', status: 'running', summary: '', progress: null, updated_at: ago(5), error: null, metadata_json: {}, ...over })
const steps = [
  { id: 's1', run_id: 'r1', telegram_id: '100', ordinal: 1, title: 'Search flights BLR to GOI', status: 'completed', started_at: ago(30), completed_at: ago(20) },
  { id: 's2', run_id: 'r1', telegram_id: '100', ordinal: 2, title: 'Shortlist hotels in North Goa', status: 'running', started_at: ago(12) },
  { id: 's3', run_id: 'r1', telegram_id: '100', ordinal: 3, title: 'Prepare the plan', status: 'queued' },
]
{
  const r = run({ progress: 45 })
  const text = formatRunStatus(r, steps, lastRunActivity(r, steps), NOW)
  assert.match(text, /\*Goa trip plan\*/)
  assert.match(text, /Status: Running now/)
  assert.match(text, /Step 2 of 3: Shortlist hotels in North Goa/)
  assert.match(text, /Progress: 45%/)
  assert.match(text, /Last activity: Started: Shortlist hotels in North Goa \(12 min ago\)/)
  assert.match(text, /Waiting on: nothing from you right now/)
  assert.doesNotMatch(text, /Outcome unknown|approval|sign in/i)
}
{
  const text = formatRunStatus(run({ progress: undefined }), steps, null, NOW)
  assert.doesNotMatch(text, /Progress:/, 'no progress line without agent_runs.progress')
}
{
  const r = run({ status: 'waiting_approval', title: 'Book Toit table', summary: 'Table for 4 at 8 pm is ready to confirm.' })
  const s = [{ ...steps[0] }, { ...steps[1], status: 'waiting_approval', title: 'Confirm the reservation', started_at: ago(3) }]
  const text = formatRunStatus(r, s, lastRunActivity(r, s), NOW)
  assert.match(text, /Status: Waiting for your approval/)
  assert.match(text, /Waiting on: your approval\. Nothing consequential happens until you approve or reject it\./)
  assert.match(text, /Table for 4 at 8 pm/)
}
{
  const r = run({ status: 'paused', title: 'IRCTC train search', metadata_json: { handoff: { takeoverUrl: 'https://example.test/takeover' } }, updated_at: ago(90) })
  const text = formatRunStatus(r, [], lastRunActivity(r, []), NOW)
  assert.match(text, /Status: Paused — needs you to sign in/)
  assert.match(text, /Waiting on: your sign-in on the provider's site\. I won't sign in for you\./)
  assert.match(text, /\(2 h ago\)/)
  assert.doesNotMatch(text, /takeover|https?:/i, 'no takeover URL leaks into the card')
}
{
  const r = run({ status: 'paused', title: 'Flight booking BLR to DEL', metadata_json: { secondary_auth: { reason: 'otp' } } })
  const text = formatRunStatus(r, [], null, NOW)
  assert.match(text, /Status: Paused — needs a one-time code from you/)
  assert.match(text, /Waiting on: a one-time code \(OTP\) that only you can enter on the secure sign-in screen\. Please don't send the code in chat\./)
  const viaStep = formatRunStatus(run({ status: 'failed' }), [{ ordinal: 1, title: 'Sign in', status: 'failed', error: 'human_auth_required', output_json: { authReason: 'otp' }, completed_at: ago(2) }], null, NOW)
  assert.match(viaStep, /Status: Stopped at a sign-in step/)
  assert.match(viaStep, /one-time code \(OTP\)/)
}
{
  const r = run({ status: 'failed', title: 'Cult slot search', summary: 'The provider page did not load.', error: 'provider_timeout' })
  const text = formatRunStatus(r, [], lastRunActivity(r, []), NOW)
  assert.match(text, /Status: Failed/)
  assert.match(text, /It did not finish\. Nothing further is running for it\./)
  assert.doesNotMatch(text, /provider_timeout|Waiting on/, 'no raw error code, no waiting claim')
}
{
  const r = run({ status: 'outcome_unknown', title: 'Pay electricity bill' })
  const text = formatRunStatus(r, [], null, NOW)
  assert.match(text, /Status: Outcome unknown/)
  assert.match(text, /could not confirm whether this went through\. Please check with the provider before retrying/)
  assert.doesNotMatch(text, /Status: Completed|succeeded/i)
}
{
  const r = run({ status: 'running', updated_at: ago(60 * 30) })
  const text = formatRunStatus(r, [], lastRunActivity(r, []), NOW)
  assert.match(text, /No activity for over 24 hours, so I can't confirm it is still progressing\./)
  assert.match(text, /\(1 day ago\)/)
}
{
  const text = formatRunStatus(run({ status: 'paused', error: 'stale_provider_access_limited' }), [], null, NOW)
  assert.match(text, /Status: Closed — closed session/)
  assert.doesNotMatch(text, /Waiting on/)
}
console.log('PASS formatter: running, approval, sign-in, OTP, failed, outcome unknown, stale, closed')

// 5. Named match vs none, owner isolation.
const store = {
  runs: [
    run({ id: 'goa-old', title: 'Goa trip plan', status: 'completed', updated_at: ago(60 * 24 * 10) }),
    run({ id: 'goa', title: 'Goa trip plan — December', status: 'running', progress: 60, updated_at: ago(4) }),
    run({ id: 'flight', title: 'Flight booking: BLR to DEL', status: 'waiting_approval', updated_at: ago(8) }),
    run({ id: 'secret', telegram_id: '200', title: 'Goa trip SECRET of user 200', status: 'running', updated_at: ago(1) }),
  ],
  steps: [...steps.map(s => ({ ...s, run_id: 'goa' })), { ...steps[0], id: 'x', run_id: 'goa', telegram_id: '200', title: 'LEAKED STEP' }],
}
const calls: Array<[string, string]> = []
const deps = (leak = false) => ({
  now: () => NOW,
  async listRuns(tg: string) { calls.push(['runs', tg]); return store.runs.filter(r => leak || r.telegram_id === tg) },
  async listSteps(tg: string, runId: string) { calls.push(['steps', tg]); return store.steps.filter(s => s.run_id === runId && (leak || s.telegram_id === tg)) },
})
{
  const res = await tryGetTaskStatus({ telegramId: 100 }, "how's the Goa trip going", deps())
  assert.ok(res, 'named match returns a card')
  assert.equal(res!.handledBy, 'task-status'); assert.equal(res!.runId, 'goa', 'active run beats an older completed one')
  assert.equal(res!.readOnly, true); assert.equal(res!.mutated, false)
  assert.match(res!.text, /Goa trip plan — December/); assert.match(res!.text, /Progress: 60%/)
  assert.doesNotMatch(res!.text, /other task/, 'a 10-day-old completed run is not a candidate')
  assert.doesNotMatch(res!.text, /SECRET|LEAKED/)
  assert.ok(calls.every(([, tg]) => tg === '100'), 'every read is owner scoped')
  const flight = await tryGetTaskStatus({ telegramId: 100 }, 'status of my flight booking task', deps())
  assert.equal(flight!.runId, 'flight'); assert.match(flight!.text, /Waiting for your approval/)
  const booking = await tryGetTaskStatus({ telegramId: 100 }, "what's happening with my booking", deps())
  assert.equal(booking!.runId, 'flight', '"booking" matches the booking task title')
}
assert.equal(await tryGetTaskStatus({ telegramId: 100 }, "how's the Kerala trip going", deps()), null, 'no matching run -> null so routing continues')
assert.equal(await tryGetTaskStatus({ telegramId: 100 }, 'any update?', deps()), null, 'general asks belong to autonomy-status')
assert.equal(await tryGetTaskStatus({ telegramId: 100 }, 'flight status AI 505', deps()), null)
{
  // Even if the store returned another owner's rows, they are dropped.
  const res = await tryGetTaskStatus({ telegramId: 100 }, "how's the Goa trip going", deps(true))
  assert.equal(res!.runId, 'goa'); assert.doesNotMatch(res!.text, /SECRET|LEAKED/)
  const other = await tryGetTaskStatus({ telegramId: 200 }, "how's the Goa trip going", deps())
  assert.equal(other!.runId, 'secret'); assert.doesNotMatch(other!.text, /December/)
  await assert.rejects(() => tryGetTaskStatus({ telegramId: 0 }, "how's the Goa trip going", deps()), /task_status_owner_missing/)
}
assert.equal(matchRunByTitle(store.runs, 'kerala trip', NOW), null, 'every phrase word must appear in the title')
{
  // Two live matches -> the "others" hint.
  const twoLive = { runs: [...store.runs, run({ id: 'goa2', title: 'Goa trip hotels', status: 'queued', updated_at: ago(30) })], steps: store.steps }
  const res = await tryGetTaskStatus({ telegramId: 100 }, "how's the Goa trip going", { now: () => NOW, listRuns: async (tg: string) => twoLive.runs.filter(r => r.telegram_id === tg), listSteps: async () => [] })
  assert.equal(res!.runId, 'goa'); assert.match(res!.text, /1 other task also match/)
}
console.log('PASS tryGetTaskStatus: named match, none -> null, owner isolation')

// 5b. Precision (19 Oct review): stale/finished runs, personal asks, weak overlaps, DB errors.
{
  const review = [
    run({ id: 'mom', title: 'Book doctor appointment for mom', status: 'completed', updated_at: ago(60 * 24 * 48) }),
    run({ id: 'biz-old', title: 'Research business loan options', status: 'failed', updated_at: ago(60 * 24 * 3) }),
    run({ id: 'toit', title: 'Toit table for Saturday', status: 'running', updated_at: ago(10) }),
  ]
  const rd = (rows: any[]) => ({ now: () => NOW, listRuns: async (tg: string) => rows.filter(r => r.telegram_id === tg), listSteps: async () => [] })
  for (const t of ['how is my mom doing', 'how is my business doing', 'how are you doing', "how's my dad doing", 'how is my wife doing'])
    assert.equal(await tryGetTaskStatus({ telegramId: 100 }, t, rd(review)), null, `personal ask never returns a card: ${t}`)
  // Old finished runs are not candidates even with a full, explicit match.
  assert.equal(await tryGetTaskStatus({ telegramId: 100 }, 'status of my business loan research', rd(review)), null, 'a 3-day-old failed run is not matched')
  assert.equal(await tryGetTaskStatus({ telegramId: 100 }, 'any update on my doctor appointment booking', rd(review)), null, 'a 48-day-old completed run is not matched')
  assert.equal(matchRunByTitle(review, 'doctor appointment mom', NOW), null, 'matcher itself drops old finished runs')
  // ...but a recently finished one (within 24h) still is.
  const recent = [run({ id: 'biz-new', title: 'Research business loan options', status: 'failed', updated_at: ago(120) })]
  assert.equal((await tryGetTaskStatus({ telegramId: 100 }, 'status of my business loan research', rd(recent)))!.runId, 'biz-new')
  assert.equal(await tryGetTaskStatus({ telegramId: 100 }, 'how is my business doing', rd(recent)), null, 'still personal even with a fresh business run')
  // One content word and no task word is too weak, even for a live run.
  assert.equal(matchRunByTitle(review, 'toit', NOW), null, 'single-word, non-task phrase needs >= 2 overlaps')
  assert.equal(await tryGetTaskStatus({ telegramId: 100 }, "how's the toit going", rd(review)), null)
  assert.equal((await tryGetTaskStatus({ telegramId: 100 }, 'any update on the toit table', rd(review)))!.runId, 'toit', 'two overlapping words match')
  assert.equal(matchRunByTitle(review, 'toit booking', NOW), null, 'every content word must still be in the title')
  // Live statuses match regardless of age.
  const oldLive = [run({ id: 'watch', title: 'Passport renewal appointment search', status: 'watching', updated_at: ago(60 * 24 * 20) })]
  assert.equal((await tryGetTaskStatus({ telegramId: 100 }, 'where are we on my passport renewal', rd(oldLive)))!.runId, 'watch')
  // DB read errors fall through instead of throwing into routing.
  const boom = { now: () => NOW, listRuns: async () => { throw new Error('task_status_runs_read_failed:connection reset') }, listSteps: async () => [] }
  assert.equal(await tryGetTaskStatus({ telegramId: 100 }, "how's the Goa trip going", boom), null, 'runs read error -> null')
  const boomSteps = { now: () => NOW, listRuns: async (tg: string) => store.runs.filter(r => r.telegram_id === tg), listSteps: async () => { throw new Error('task_status_steps_read_failed:timeout') } }
  assert.equal(await tryGetTaskStatus({ telegramId: 100 }, "how's the Goa trip going", boomSteps), null, 'steps read error -> null')
}
console.log('PASS precision: personal asks, old runs, weak overlap, DB errors')

// 6. Wiring: real bridge dispatch + route order before the general planner on both surfaces.
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const noop = new Proxy({}, { get: () => async () => null })
const taskStatusFixture = { parseTaskStatusQuery, tryGetTaskStatus: (o: any, t: string) => tryGetTaskStatus(o, t, deps()) }
const autonomyCalls: string[] = []
const autonomyFixture = { tryGetConnectionStatus: async () => null, tryGetAutonomyStatus: async ({ text }: any) => { autonomyCalls.push(text); return isAutonomyStatus(text) ? { runId: 'autonomy-status', status: 'completed', text: 'What Gogo is working on', handledBy: 'autonomy-status' } : null } }
function load(file: string, deps: Record<string, any>) {
  const exports: any = {}
  runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, module: { exports }, require: (name: string) => deps[name] || noop, Date, Intl, console, URL, Buffer, process })
  return exports
}
const bridge = load('lib/agent/whatsapp-bridge.ts', { './task-status': taskStatusFixture, './autonomy-status': autonomyFixture })
const waUser = { id: 'u100', telegramId: 100, whatsappId: 'whatsapp:+100', name: 'Fixture' }
assert.equal((await bridge.tryRunWhatsAppTaskStatus({ user: waUser, text: "how's the Goa trip going" })).handledBy, 'task-status')
assert.equal((await bridge.tryRunWhatsAppTaskStatus({ user: waUser, text: 'any update?' })).handledBy, 'autonomy-status')
assert.equal(await bridge.tryRunWhatsAppTaskStatus({ user: waUser, text: "how's the Kerala trip going" }), null, 'unmatched named ask continues routing')
const before = autonomyCalls.length
assert.equal(await bridge.tryRunWhatsAppTaskStatus({ user: waUser, text: 'flight status AI 505' }), null)
assert.equal(autonomyCalls.length, before, 'negatives never reach the status readers')

const bridgeSrc = read('lib/agent/whatsapp-bridge.ts')
const agentBody = bridgeSrc.slice(bridgeSrc.indexOf('export async function tryRunWhatsAppAgent('))
assert.ok(agentBody.indexOf('tryGetTaskStatus(') > 0 && agentBody.indexOf('tryGetTaskStatus(') < agentBody.indexOf('tryGetAutonomyStatus('), 'bridge: task status before the general digest')
assert.ok(agentBody.indexOf('tryGetAutonomyStatus(') < agentBody.indexOf('tryRunGeneralPlan'), 'bridge: status before the general planner')
const wa = read('app/api/webhooks/whatsapp/route.ts')
const waGate = wa.indexOf('if (parseTaskStatusQuery(text))')
assert.ok(waGate > 0, 'webhook gates on the pure parser')
assert.ok(wa.indexOf('tryRunWhatsAppTaskStatus({ user: resolvedUser, text })') > waGate)
for (const later of ['const unsupported=unsupportedCapability(text)', 'isSportsVenueRequest(text)', 'routeFeatureIntent('])
  assert.ok(waGate < wa.indexOf(later, wa.indexOf('isOpenLoopQuery(text) ||')), `webhook: task status before ${later}`)
assert.ok(wa.indexOf('isOpenLoopQuery(text) ||') < waGate, 'open-loop attention keeps first refusal')
const dash = read('app/api/dashboard/chat/route.ts')
const dashGate = dash.indexOf('if (parseTaskStatusQuery(text))')
assert.ok(dashGate > 0 && dash.indexOf('tryGetTaskStatus({ telegramId: actor.legacyTelegramId }, text) || await tryGetAutonomyStatus({ actor, text })') > dashGate)
assert.ok(dashGate < dash.indexOf('const mission = await tryRunGeneralPlan('), 'dashboard: status before the general planner')
assert.ok(dash.indexOf('const accountGate = await tryAccountSiteAnswer(actor, text)') > dashGate, 'shop orders are excluded by the parser, not by order')
console.log('PASS wiring: WhatsApp webhook + bridge + dashboard chat, before the general planner')
console.log('verify-task-status-query: ok')
