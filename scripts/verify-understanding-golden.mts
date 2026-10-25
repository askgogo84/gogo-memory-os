// Understand-first golden replay (founder, 19 Oct: "understand the whole sentence and then decide").
// Replays the 19 Oct live cases and misleading-keyword negatives against RECORDED model outputs (no live
// calls) and checks: (a) context assembly, including graceful degradation per source; (b) validation and
// normalisation; (c) action -> existing handler mapping; (d) the shadow-vs-actual comparison report;
// (e) the safe live dispatcher: safe cases dispatch to the right handler, low confidence / unknown referent /
// timeout fall through, consequential actions never dispatch.
// Run: npx tsx scripts/verify-understanding-golden.mts            (offline, deterministic)
//      TYPESAFE_API_KEY=... npx tsx scripts/verify-understanding-golden.mts --record   (captures live outputs)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  UNDERSTANDING_ACTION_NAMES, SAFE_LIVE_ACTIONS, UNDERSTANDING_LIVE_MIN_CONFIDENCE, UNDERSTANDING_STATE_MAX_CHARS,
  buildUnderstandingRequest, callTypeSafe, compareUnderstandingToActual, handlersForAction, actionsForHandler,
  interpretUnderstandingResponse, understandMessage, detectPendingQuestion, type UnderstandingContext,
} from '../lib/agent/understanding'
import { buildUnderstandingContext, type SourceLoaders } from '../lib/agent/understanding-context'
import { decideLiveDispatch, runUnderstandFirst, understandFirstLiveEnabled, MUTATION_LEAD, UNDERSTAND_FIRST_BUDGET_MS, type UnderstandFirstHandlers } from '../lib/agent/understand-first'
import { MIN_CALIBRATION_SAMPLES } from '../lib/agent/decision-evidence'

const FIXTURE = 'scripts/fixtures/understanding-golden.json'
const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const NOW = new Date(golden.now)
const actor = { legacyTelegramId: 4242, name: 'Goverdhan', timezone: 'Asia/Kolkata' }

function loadersFor(override: Record<string, any> = {}): SourceLoaders {
  const data = { ...golden.baseContext, ...override }
  const L: SourceLoaders = {}
  for (const name of ['recent_turns', 'open_tasks', 'pending_approvals', 'saved_documents', 'saved_tickets', 'upcoming_reminders', 'context_pack', 'calendar', 'preferences', 'profile'] as const) {
    L[name] = async () => data[name]
  }
  return L
}
async function contextFor(c: any): Promise<UnderstandingContext> {
  return buildUnderstandingContext({ actor, text: c.text, now: NOW, loaders: loadersFor(c.context) })
}

// ------------------------------------------------------------------ (a) context assembly
{
  const ctx = await contextFor({ text: 'Jailer qr code' })
  for (const s of ['recent_turns', 'open_tasks', 'pending_approvals', 'saved_documents', 'saved_tickets', 'upcoming_reminders', 'context_pack', 'calendar', 'preferences', 'profile']) {
    assert.equal(ctx.sourceStatus[s], 'included', `source ${s} included when present`)
  }
  assert.equal(ctx.openTasks.length, 2)
  assert.equal(ctx.savedAssetsIndex.length, 3, 'documents and tickets are both indexed')
  assert.ok(ctx.savedAssetsIndex.some(a => a.title === 'masked passport'), 'a sensitive document is only "masked <type>"')
  assert.equal(ctx.watches.length, 1); assert.equal(ctx.travelLegs.length, 1); assert.equal(ctx.memoryFacts.length, 1)
  assert.equal(ctx.profile.city, 'Bangalore')
  const req = buildUnderstandingRequest({ actor, text: 'Jailer qr code', now: NOW, ...ctx })
  const state = JSON.stringify(req.body.state)
  for (const needle of ['PVR ticket - Jailer 2', 'Add Jailer 2 to calendar', 'Block calendar for this booking', 'Sony WH-1000XM5', 'Investor call', 'Keep replies short', 'B2, pillar 14', 'Jailer 2 at PVR Orion Mall']) assert.ok(state.includes(needle), `request carries ${needle}`)
  assert.ok((req.body.questions as any).referent.criteria['doc:pvr-jailer'], 'saved assets are referent choices')
  assert.ok((req.body.questions as any).referent.criteria['run:r-jailer2'], 'open tasks are referent choices')
  assert.equal((req.body.questions as any).action.type, 'choice')
  assert.deepEqual(Object.keys((req.body.questions as any).action.criteria).sort(), [...UNDERSTANDING_ACTION_NAMES].sort())

  // Pending question: the latest assistant turn, unexpired.
  const pctx = await contextFor({ text: 'Goverdhan', context: golden.cases.find((c: any) => c.id === 'oct19-name-answer').context })
  assert.equal(pctx.pendingQuestion?.id, 'q:latest')
  assert.match(String(pctx.pendingQuestion?.text), /What name should I book under\?/)
  assert.ok(JSON.stringify(buildUnderstandingRequest({ actor, text: 'Goverdhan', now: NOW, ...pctx }).body.state).includes('What name should I book under?'))
  assert.equal(detectPendingQuestion([{ role: 'assistant', content: 'Which one: 22K or 24K?', createdAt: new Date(NOW.getTime() - 31 * 60_000).toISOString() }], NOW), null, 'expired question is not pending')
  assert.equal(detectPendingQuestion([{ role: 'assistant', content: 'Which one?' }, { role: 'user', content: 'x' }], NOW), null, 'only the latest turn counts')

  // Degrades: one source throws, one hangs, the rest still arrive.
  const t0 = Date.now()
  const degraded = await buildUnderstandingContext({
    actor, text: 'x', now: NOW,
    loaders: { ...loadersFor(), calendar: async () => { throw new Error('calendar down') }, context_pack: () => new Promise(() => {}) },
    timeouts: { context_pack: 120 },
  })
  assert.ok(Date.now() - t0 < 1000, 'a hanging source is cut by its own timeout')
  assert.equal(degraded.sourceStatus.calendar, 'error')
  assert.equal(degraded.sourceStatus.context_pack, 'timeout')
  assert.equal(degraded.sourceStatus.recent_turns, 'included')
  assert.equal(degraded.openTasks.length, 2)
  assert.deepEqual(degraded.memoryFacts, [])

  // Bounded: an oversized context is trimmed to the cap.
  const big = Array.from({ length: 400 }, (_, i) => ({ id: `memory:m${i}`, title: 'x'.repeat(150) }))
  const bigReq = buildUnderstandingRequest({ actor, text: 'hi there friend', now: NOW, ...ctx, memoryFacts: big, recentTurns: Array.from({ length: 8 }, () => ({ role: 'user' as const, content: 'y'.repeat(600) })) })
  assert.ok(JSON.stringify(bigReq.body.state.context).length <= UNDERSTANDING_STATE_MAX_CHARS)

  // Secrets never cross the boundary.
  let called = false
  const secret = await understandMessage({ actor, text: 'my password is Hunter2!secret and otp 445566', now: NOW }, { callModel: async () => { called = true; return { raw: {}, latencyMs: 0 } } })
  assert.equal(called, false); assert.equal(secret.ok, false); assert.equal(secret.error, 'typesafe_sensitive_state_withheld')
  const scrubbed = JSON.stringify(buildUnderstandingRequest({ actor, text: 'hello', now: NOW, recentTurns: [{ role: 'user', content: 'call me on 9876543210 or mail me@example.com' }] }).body)
  assert.doesNotMatch(scrubbed, /9876543210|me@example\.com/)
  console.log('PASS (a) context assembly, degradation, bounds, secrets')
}

// ------------------------------------------------------------------ (c) mapping
{
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) && !/understand/.test(e.name) ? [fs.readFileSync(`${dir}/${e.name}`, 'utf8')] : [])
  const source = [...walk('lib'), ...walk('app')].join('\n')
  for (const action of UNDERSTANDING_ACTION_NAMES) {
    const handlers = handlersForAction(action)
    assert.ok(handlers.length > 0, `${action} maps to a handler`)
    for (const h of handlers) if (!h.startsWith('understand-first')) assert.ok(source.includes(`'${h}'`), `${action} -> ${h} is an existing handler name`)
  }
  assert.deepEqual([...SAFE_LIVE_ACTIONS].sort(), ['answer_pending_question', 'general_chat', 'memory_recall', 'plan_with_clarification', 'retrieve_saved_document', 'task_status', 'web_answer'])
  for (const consequential of ['restaurant_booking', 'event_or_travel_booking', 'send_message', 'calendar_event', 'set_reminder', 'modify_reminder', 'create_watch', 'task_cancel', 'browser_task', 'order_status', 'price_compare'] as const) assert.ok(!SAFE_LIVE_ACTIONS.has(consequential), `${consequential} is never live`)
  assert.equal(UNDERSTANDING_LIVE_MIN_CONFIDENCE, 0.82, 'live threshold equals the guarded-live threshold')
  assert.equal(MIN_CALIBRATION_SAMPLES, 20, 'promotion gate minimum calibration unchanged')
  assert.ok(UNDERSTAND_FIRST_BUDGET_MS <= 2500)
  assert.ok(actionsForHandler('task-status').includes('task_status'))
  assert.ok(actionsForHandler('restaurant-reservation').includes('restaurant_booking'))
  console.log('PASS (c) action -> existing handler mapping')
}

// ------------------------------------------------------------------ (b) + (e) golden replay
const record = process.argv.includes('--record')
let recorded = 0
for (const c of golden.cases) {
  const ctx = await contextFor(c)
  const input = { actor, text: c.text, now: NOW, ...ctx }
  if (record && String(process.env.TYPESAFE_API_KEY || '').trim() && !c.modelError) {
    const live = await callTypeSafe(buildUnderstandingRequest(input).body, 2500)
    c.recordedLive = 'raw' in live ? live.raw : { error: live.error }
    const reading = 'raw' in live ? interpretUnderstandingResponse(live.raw, input) : null
    console.log(`RECORD ${c.id}: live=${reading?.action ?? 'error'} expected=${c.expect.action}`)
    recorded++
  }

  // (b) validation / normalisation from the recorded output.
  if (!c.modelError) {
    const r = interpretUnderstandingResponse(c.model, input, 5)
    if (c.expect.ok === false) assert.equal(r.ok, false, c.id)
    assert.equal(r.action, c.expect.action ?? null, `${c.id}: action`)
    if (c.expect.notAction) assert.notEqual(r.action, c.expect.notAction, `${c.id}: misleading keyword`)
    if ('referent' in c.expect) assert.equal(r.referent?.id ?? null, c.expect.referent, `${c.id}: referent`)
    for (const [k, v] of Object.entries(c.expect.slots || {})) assert.equal(r.slots[k], v, `${c.id}: slot ${k}`)
    if (c.expect.clarifyingQuestion) assert.equal(r.clarifyingQuestion, c.expect.clarifyingQuestion, `${c.id}: one clarifying question`)
    for (const reason of c.expect.reasons || []) assert.ok(r.reasons.includes(reason), `${c.id}: reason ${reason} in ${r.reasons}`)
    if (r.action) assert.equal(r.handler, handlersForAction(r.action)[0], `${c.id}: handler mapping`)
  }

  // (e) live dispatcher end to end with stub handlers.
  const calls: string[] = []
  const handlers: UnderstandFirstHandlers = {
    pendingAnswerers: [async ({ pendingQuestion }) => { calls.push('pending'); return /name should I book/i.test(pendingQuestion.text) ? { text: 'Booked under Goverdhan, awaiting your approval.', handledBy: 'restaurant-reservation' } : null }],
    retrieveDocument: async ({ referent }) => { calls.push(`retrieve:${referent.id}`); return { text: 'Here is your PVR ticket.', handledBy: 'understand-first-retrieve' } },
    taskStatus: async ({ referent }) => { calls.push(`status:${referent?.id ?? 'all'}`); return { text: 'status', handledBy: referent ? 'task-status' : 'autonomy-status' } },
    assistant: async ({ intent }) => { calls.push(`assistant:${intent}`); return { text: 'ok', handledBy: '' } },
  }
  const bg: Promise<unknown>[] = []
  const shadowRows: any[] = []
  const outcomes: any[] = []
  const out = await runUnderstandFirst({
    actor, surface: 'whatsapp', text: c.text, eventId: `evt-${c.id}`, handlers,
    deps: {
      now: NOW, loaders: loadersFor(c.context), budgetMs: c.modelError ? 300 : undefined, env: {},
      callModel: c.modelError ? () => new Promise(() => {}) : async () => ({ raw: c.model, latencyMs: 7 }),
      record: async (row: any) => { shadowRows.push(row) },
      recordOutcome: async (o: any) => { outcomes.push(o) },
      background: task => { bg.push(task()) },
    },
  })
  await Promise.all(bg)
  assert.equal(out.modelCalls, 1, `${c.id}: exactly one understanding call`)
  assert.equal(shadowRows.length, 1, `${c.id}: one shadow record`)
  if (c.expect.live === 'dispatch') {
    assert.ok(out.reply, `${c.id}: dispatched live (${out.decision.reason})`)
    assert.equal(out.reply!.handledBy, c.expect.handledBy, `${c.id}: live handler`)
    assert.equal(shadowRows[0].dispatchedHandler, c.expect.handledBy)
    assert.equal(outcomes.length, 1, `${c.id}: live turn records its router outcome for pairing`)
    assert.equal(outcomes[0].eventId, `evt-${c.id}`)
  } else {
    assert.equal(out.reply, null, `${c.id}: falls through`)
    if (c.expect.reason) assert.equal(out.decision.reason, c.expect.reason, `${c.id}: fall-through reason`)
    if (c.expect.reasonOneOf) assert.ok(c.expect.reasonOneOf.includes(out.decision.reason), `${c.id}: ${out.decision.reason}`)
    assert.equal(outcomes.length, 0)
    // Nothing consequential was touched on a fall-through.
    assert.ok(calls.every(x => x === 'pending'), `${c.id}: no handler ran except a declining pending owner (${calls})`)
  }
  if (c.modelError) assert.ok(out.totalMs < 1500, `${c.id}: timeout is bounded (${out.totalMs}ms)`)
}
if (record && recorded) fs.writeFileSync(FIXTURE, JSON.stringify(golden, null, 1) + '\n')
console.log(`PASS (b)+(e) golden replay: ${golden.cases.length} cases`)

// ------------------------------------------------------------------ (e) policy invariants
{
  const ctx = await contextFor({ text: 'x' })
  const reading = (action: string, conf = 0.99, referent: any = null) => ({ ok: true, version: 'v', action, proposedAction: action, handler: 'h', referent, slots: {}, clarifyingQuestion: null, confidence: conf, reasons: [], latencyMs: 1, candidateCount: 1 }) as any
  // Consequential actions never dispatch, whatever the confidence or referent.
  for (const action of UNDERSTANDING_ACTION_NAMES.filter(a => !SAFE_LIVE_ACTIONS.has(a))) {
    for (const text of ['Book it now', 'please handle this', 'do it']) {
      const d = decideLiveDispatch(reading(action, 0.999, { id: 'run:r-jailer2', kind: 'task', title: 't' }), ctx, { enabled: true, text })
      assert.equal(d.dispatch, false, `${action} must never dispatch live`)
    }
  }
  assert.equal(decideLiveDispatch(reading('general_chat', 0.81), ctx, { enabled: true, text: 'hello how are you' }).reason, 'below_live_confidence')
  assert.equal(decideLiveDispatch(reading('general_chat', 0.82), ctx, { enabled: true, text: 'hello how are you' }).dispatch, true)
  assert.equal(decideLiveDispatch(reading('general_chat'), ctx, { enabled: false, text: 'hello how are you' }).reason, 'live_disabled')
  assert.equal(decideLiveDispatch(reading('retrieve_saved_document', 0.95, { id: 'doc:not-owned', kind: 'document', title: 'x' }), ctx, { enabled: true, text: 'my ticket please' }).reason, 'referent_not_owned')
  assert.equal(decideLiveDispatch(reading('task_status', 0.95, { id: 'run:not-owned', kind: 'task', title: 'x' }), ctx, { enabled: true, text: 'any update' }).reason, 'referent_not_owned')
  for (const t of ['cancel that task', 'Book tickets for Jailer 2', 'send it to Divya', 'pay the bill', 'remind me at 5', 'please delete it']) assert.ok(MUTATION_LEAD.test(t), t)
  for (const t of ['Jailer qr code', 'how is my mom doing', 'What did I tell you about my parking spot?', 'Goverdhan', 'plan my weekend']) assert.ok(!MUTATION_LEAD.test(t), t)
  assert.equal(understandFirstLiveEnabled({}), true, 'default on')
  assert.equal(understandFirstLiveEnabled({ UNDERSTAND_FIRST_LIVE: 'off' }), false)
  assert.equal(understandFirstLiveEnabled({ UNDERSTAND_FIRST_LIVE: 'OFF ' }), false)

  // Live off: nothing dispatched, the reading still recorded after the response.
  const bg: Promise<unknown>[] = []
  const rows: any[] = []
  const c = golden.cases.find((x: any) => x.id === 'oct19-jailer-qr')
  const off = await runUnderstandFirst({ actor, surface: 'web', text: c.text, eventId: 'e-off', handlers: { pendingAnswerers: [], retrieveDocument: async () => { throw new Error('must not run') }, taskStatus: async () => null, assistant: async () => null },
    deps: { now: NOW, env: { UNDERSTAND_FIRST_LIVE: 'off' }, loaders: loadersFor(), callModel: async () => ({ raw: c.model, latencyMs: 3 }), record: async (r: any) => { rows.push(r) }, background: t => { bg.push(t()) } } })
  await Promise.all(bg)
  assert.equal(off.reply, null); assert.equal(off.decision.reason, 'live_disabled')
  assert.equal(rows.length, 1); assert.equal(rows[0].understanding.action, 'retrieve_saved_document')

  // A handler that throws falls through instead of failing the turn.
  const thrown = await runUnderstandFirst({ actor, surface: 'web', text: c.text, eventId: 'e-throw', handlers: { pendingAnswerers: [], retrieveDocument: async () => { throw new Error('storage down') }, taskStatus: async () => null, assistant: async () => null },
    deps: { now: NOW, env: {}, loaders: loadersFor(), callModel: async () => ({ raw: c.model, latencyMs: 3 }), record: async () => {}, background: () => {} } })
  assert.equal(thrown.reply, null); assert.equal(thrown.decision.reason, 'handler_declined')

  // Exact commands and approvals never spend a reading.
  let modelCalls = 0
  for (const [text, skip] of [['yes', null], ['1', null], ['my reminders', null], ['Approve', 'approval_reply']] as const) {
    const r = await runUnderstandFirst({ actor, surface: 'whatsapp', text, eventId: 'e', skip, handlers: { pendingAnswerers: [], retrieveDocument: async () => null, taskStatus: async () => null, assistant: async () => null },
      deps: { callModel: async () => { modelCalls++; return { raw: {}, latencyMs: 0 } }, loaders: loadersFor(), record: async () => {}, background: () => {} } })
    assert.equal(r.reply, null); assert.equal(r.modelCalls, 0)
  }
  assert.equal(modelCalls, 0)
  console.log('PASS (e) live policy invariants')
}

// ------------------------------------------------------------------ (d) comparison report
{
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({ eventId: `t${i}`, action: 'task_status', confidence: 0.9, actualHandler: i < 19 ? 'task-status' : 'process-message' })),
    { eventId: 'r1', action: 'retrieve_saved_document', confidence: 0.95, actualHandler: 'process-message' },
    { eventId: 'b1', action: 'restaurant_booking', confidence: 0.97, actualHandler: 'restaurant-reservation' },
    { eventId: 'l1', action: 'general_chat', confidence: 0.9, liveDispatched: true, actualHandler: 'understand-first-chat' },
    { eventId: 'n1', action: null, confidence: 0.4, actualHandler: 'legacy-feature-intent' },
    { eventId: 'u1', action: 'web_answer', confidence: 0.9, actualHandler: null },
  ]
  const report = compareUnderstandingToActual(rows)
  assert.equal(report.totals.observed, 25)
  assert.equal(report.totals.liveDispatched, 1, 'self-dispatched turns are excluded from agreement')
  assert.equal(report.totals.noAction, 1)
  assert.equal(report.totals.paired, 22)
  const ts = report.actions.find(a => a.action === 'task_status')!
  assert.equal(ts.agree, 19); assert.equal(ts.agreementRate, 0.95); assert.equal(ts.promotable, true)
  const rd = report.actions.find(a => a.action === 'retrieve_saved_document')!
  assert.equal(rd.agree, 0); assert.equal(rd.promotable, false); assert.ok(rd.failures.includes('confident_samples_below_20'))
  const bk = report.actions.find(a => a.action === 'restaurant_booking')!
  assert.equal(bk.agree, 1); assert.ok(bk.failures.includes('not_in_safe_live_set'), 'consequential actions are never promotable here')
  console.log('PASS (d) shadow vs actual comparison')
}

// ------------------------------------------------------------------ wiring (source checks)
{
  const wa = fs.readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
  const web = fs.readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
  const pm = fs.readFileSync('lib/bot/process-message.ts', 'utf8')
  const at = (s: string, needle: string) => { const i = s.indexOf(needle); assert.ok(i >= 0, needle); return i }
  const waChoke = at(wa, 'tryUnderstandFirst({')
  assert.ok(at(wa, "buttonPayload === 'snooze_10'") < waChoke, 'after explicit button payloads')
  assert.ok(at(wa, 'if (bookingCode)') < waChoke, 'after secondary-auth codes')
  assert.ok(at(wa, 'if (approvalIntent(text)) {') < waChoke, 'after APPROVE/REJECT handling')
  assert.ok(waChoke < at(wa, 'const unsupported=unsupportedCapability(text)'), 'before the capability and reservation matchers')
  assert.ok(waChoke < at(wa, 'jevClarificationReply(brainObservation?.jev)'), 'before the Jev clarification guard')
  assert.ok(waChoke < at(wa, 'routeFeatureIntent(from, text'), 'before feature keyword matchers')
  assert.match(wa, /approvalIntent\(text\) \? 'approval_reply'/, 'APPROVE/REJECT never enter understand-first')
  // Single owner for pending answers (PR #668 registry first, understand-first only when it had nothing).
  assert.equal((wa.match(/await tryResolvePendingQuestion\(/g) || []).length, 1, 'the registry runs once per turn')
  assert.ok(at(wa, 'await tryResolvePendingQuestion(') < waChoke, 'the registry binds before understand-first reads')
  assert.match(wa, /registryChecked: pendingQuestionCheckedFor === text/)
  assert.doesNotMatch(wa, /tryRunWhatsAppReservationGuestReply/, 'the registry owns the Toit name step')
  assert.match(web, /registryChecked:pendingQuestionChecked/)
  const webChoke = at(web, 'tryUnderstandFirst({')
  assert.ok(at(web, 'shouldWithholdAuthenticationCode') < webChoke, 'after the login-code guard')
  assert.ok(at(web, 'handleInboxReplyRead({actor,text})') < webChoke, 'the exact inbox read keeps first refusal')
  assert.ok(at(web, 'tryCancelRunFromChat(') < webChoke, 'run cancel keeps first refusal')
  assert.ok(webChoke < at(web, 'tryCreateGoldRateWatchFromCommand('), 'before watch keyword matchers')
  assert.ok(webChoke < at(web, 'routeFeatureIntent('), 'before feature keyword matchers')
  assert.match(web, /eventId:shadowEventId, externalUserId/)
  assert.ok(at(web, 'tryResolvePendingQuestion({') < webChoke, 'dashboard registry binds before understand-first')
  assert.match(pm, /understoodIntent\?: 'general_chat' \| 'web_search'/)
  assert.match(pm, /LIVE_LOOKUP=new Set\(\['weather_live','gold_live'/, 'live-info specialists keep their provenance')
  console.log('PASS wiring')
}

// ------------------------------------------------------------------ single owner: "Goverdhan" and "24k" handled exactly once
{
  const { buildUnderstandFirstHandlers } = await import('../lib/agent/understand-first')
  assert.equal(buildUnderstandFirstHandlers({ actor: { ...actor, userId: 'u', whatsappId: 'w' }, surface: 'web', externalUserId: 'w', messageId: null, registryChecked: true }).pendingAnswerers.length, 0, 'registry already ran: understand-first binds no pending answer itself')
  assert.equal(buildUnderstandFirstHandlers({ actor: { ...actor, userId: 'u', whatsappId: 'w' }, surface: 'web', externalUserId: 'w', messageId: null }).pendingAnswerers.length, 1, 'a caller without the registry gets it once, inside understand-first')

  // With the registry already checked, an answer_pending_question reading runs no answerer of its own.
  const nameCase = golden.cases.find((x: any) => x.id === 'oct19-name-answer')
  const noOwner = await runUnderstandFirst({ actor, surface: 'whatsapp', text: 'Goverdhan', eventId: 'e-name', handlers: { pendingAnswerers: [], retrieveDocument: async () => { throw new Error('no') }, taskStatus: async () => { throw new Error('no') }, assistant: async () => { throw new Error('no') } },
    deps: { now: NOW, env: {}, loaders: loadersFor(nameCase.context), callModel: async () => ({ raw: nameCase.model, latencyMs: 2 }), record: async () => {}, background: () => {} } })
  assert.equal(noOwner.reply, null); assert.equal(noOwner.decision.reason, 'handler_declined')

  // The real dashboard POST, with the registry and understand-first counted.
  const ts = (await import('typescript')).default
  const vm = await import('node:vm')
  const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const run = async (text: string, registry: (t: string) => any) => {
    const seen = { registry: [] as string[], understand: [] as any[], pim: [] as any[], saved: [] as any[] }
    const db = { from(table: string) {
      const q: any = { select() { return q }, eq() { return q }, maybeSingle() { return q }, insert(rows: any) { seen.saved.push(rows); return q },
        then(resolve: any, reject: any) { return Promise.resolve({ data: table === 'users' ? { telegram_id: 4242, whatsapp_id: 'w', name: 'Goverdhan' } : null, error: null }).then(resolve, reject) } }
      return q
    } }
    const mocks: Record<string, any> = {
      'next/server': { NextResponse: { json: (body: any, o?: any) => ({ body, status: o?.status || 200 }) } },
      crypto: { randomUUID: () => 'evt' },
      '@/lib/supabase-admin': { supabaseAdmin: db },
      '@/lib/dashboard/session': { getSession: async () => ({ telegramId: '4242' }) },
      '@/lib/agent/actor': { resolveAgentActor: async () => ({ ...actor, userId: 'u', whatsappId: 'w' }) },
      '@/lib/bot/pending-question-resolver': { tryResolvePendingQuestion: async (p: any) => { seen.registry.push(p.text); return registry(p.text) } },
      '@/lib/agent/understand-first': { tryUnderstandFirst: async (p: any) => { seen.understand.push({ text: p.text, registryChecked: p.registryChecked }); return null } },
      '@/lib/bot/process-message': { processIncomingMessage: async (p: any) => { seen.pim.push({ text: p.text, pendingQuestionChecked: p.pendingQuestionChecked }); return { text: 'handled', handledBy: 'process-message' } } },
      '@/lib/agent/autonomy-status': { isConnectionCapabilityQuery: () => false, tryGetAutonomyStatus: async () => null },
      '@/lib/agent/task-status': { parseTaskStatusQuery: () => null, tryGetTaskStatus: async () => null },
      '@/lib/agent/recall-query': { isDecisionRecallQuery: () => false },
      '@/lib/services/link-vault': { isLinkVaultSaveRequest: () => false, isLinkVaultQuery: () => false },
      '@/lib/bot/handlers/friend-reminders': { detectFriendReminder: () => null, isFriendReminderFollowupCandidate: () => false, getPendingFriend: async () => null },
      '@/lib/dashboard/day-chat': { detectDashboardDayIntent: () => null },
      '@/lib/agent/read-only-schedule': { detectReadOnlyScheduleRequest: () => null },
      '@/lib/agent/shadow-brain': { observeShadowBrainTurn: async () => ({ jev: null }) },
      '@/lib/agent/jev-router': { jevClarificationReply: () => null, isGroundedReminderCommand: () => false },
      '@/lib/agent/workspace-meeting-plan': { isStandaloneWorkspaceMeetingPrep: () => false, tryPrepareWorkspaceMeetingPlan: async () => null },
      '@/lib/agent/travel-research': { isPublicTravelResearchRequest: () => false, isTravelResearchDetailsReply: () => false, tryRunTravelResearch: async () => null },
      '@/lib/commerce/comparison-model': { namesRetailerPriceRead: () => false },
      '@/lib/dashboard/approx-location': { parseApproxLocation: () => null },
      '@/lib/bot/memory-redaction': { redactSecretShapedText: (x: string) => x },
      '@/lib/agent/provider-booking': { otpReply: () => null },
    }
    const noop = new Proxy({}, { get: () => async () => null })
    const exports: any = {}
    vm.runInNewContext(compile('app/api/dashboard/chat/route.ts'), { exports, module: { exports }, require: (n: string) => mocks[n] || noop, URL, console, process })
    const r = await exports.POST({ headers: { get: () => 'https://app.askgogo.in' }, nextUrl: { host: 'app.askgogo.in' }, json: async () => ({ text }) })
    return { r, seen }
  }
  // "Goverdhan" after "What name should I book under?": the registry answers; understand-first never reads it.
  const g = await run('Goverdhan', t => t === 'Goverdhan' ? { text: 'Booked under Goverdhan, awaiting your approval.', handledBy: 'restaurant-reservation' } : null)
  assert.equal(g.r.body.handledBy, 'restaurant-reservation')
  assert.deepEqual(g.seen.registry, ['Goverdhan'], 'registry ran exactly once')
  assert.equal(g.seen.understand.length, 0, 'understand-first did not also handle it')
  assert.equal(g.seen.pim.length, 0, 'no second handler saw it')
  // "24k" after "22K or 24K gold?": the registry rewrites once; understand-first reads only the completed request;
  // the completed request is handled once downstream and the registry is not consulted again.
  const rewrite = 'Alert me when gold drops 10% — 24K gold'
  const k = await run('24k', t => t === '24k' ? { text: '', handledBy: 'pending-question-offered-choice', rewrite } : null)
  assert.deepEqual(k.seen.registry, ['24k'], 'registry ran exactly once (never on the rewritten text)')
  assert.deepEqual(k.seen.understand, [{ text: rewrite, registryChecked: true }], 'understand-first read the completed request once, registry already checked')
  assert.equal(k.seen.pim.length, 1, 'the completed request was handled exactly once')
  assert.deepEqual(k.seen.pim[0], { text: rewrite, pendingQuestionChecked: true })
  console.log('PASS single owner: "Goverdhan" and "24k" each handled exactly once')
}
console.log('Understand-first golden verification passed')
