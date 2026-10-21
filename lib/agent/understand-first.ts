/**
 * Understand-first choke point: read the whole message with its context ONCE, record the reading in
 * shadow, and dispatch live only for a small safe set. Everything else falls through to the existing
 * routing unchanged.
 *
 * Live dispatch requires ALL of:
 *  - UNDERSTAND_FIRST_LIVE is not "off" (default on),
 *  - the reading arrived inside the hard budget (UNDERSTAND_FIRST_BUDGET_MS, <= 2.5 s),
 *  - the action is in SAFE_LIVE_ACTIONS (read-only answers or one question; nothing is executed),
 *  - confidence >= UNDERSTANDING_LIVE_MIN_CONFIDENCE (0.82, the guarded-live threshold),
 *  - a required referent resolved to a record in the owner-bound context pack,
 *  - for a pending answer: the question is Gogo's latest message and unexpired,
 *  - the message does not lead with an explicit mutation verb ("cancel…", "book…", "send…"): those always
 *    stay with their own handlers and approvals,
 *  - the handler actually returned a reply (a null reply falls through).
 *
 * Bookings, sends, payments, calendar writes, reminder/watch creation and cancellations are NEVER
 * dispatched here; they are recorded in shadow only.
 */
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isSecretShapedMemory, redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { isExactCommand } from './semantic-gate'
import {
  SAFE_LIVE_ACTIONS, UNDERSTANDING_LIVE_MIN_CONFIDENCE, actionSpec, isUnderstandFirstClarifier, understandMessage,
  type PendingQuestion, type Referent, type UnderstandingContext, type UnderstandingModelCall, type UnderstandingResult,
} from './understanding'
import { buildUnderstandingContext, type ContextActor, type SourceLoaders } from './understanding-context'

export const UNDERSTAND_FIRST_BUDGET_MS = 2500
export const UNDERSTAND_FIRST_MODEL_MAX_MS = 1500

export type UnderstandFirstReply = {
  text: string
  handledBy: string
  status?: string | null
  runId?: string | null
  /** True when the handler already saved the conversation turn itself (processIncomingMessage does). */
  persisted?: boolean
  mediaUrl?: string
  mediaType?: string
  [key: string]: unknown
}
export type PendingAnswerer = (p: { text: string; pendingQuestion: PendingQuestion }) => Promise<UnderstandFirstReply | null>
export type UnderstandFirstHandlers = {
  /**
   * Owners of pending questions, tried in order. The pending-question registry (PR #668,
   * lib/bot/pending-question-resolver.ts) is the single deterministic owner: the WhatsApp webhook and the
   * dashboard run it BEFORE understand-first and pass registryChecked, so this list is empty there and understand-first only
   * answers its own clarifying questions. A caller that did not run the registry gets it here instead,
   * so it still runs exactly once per turn.
   */
  pendingAnswerers: PendingAnswerer[]
  retrieveDocument: (p: { text: string; referent: Referent }) => Promise<UnderstandFirstReply | null>
  taskStatus: (p: { text: string; referent: Referent | null }) => Promise<UnderstandFirstReply | null>
  assistant: (p: { text: string; intent: 'general_chat' | 'web_search' }) => Promise<UnderstandFirstReply | null>
}

export function understandFirstLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.UNDERSTAND_FIRST_LIVE ?? 'on').trim().toLowerCase() !== 'off'
}

/** An explicit mutation verb at the start keeps the turn with its own handler and approvals. */
export const MUTATION_LEAD = /^\s*(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:cancel|stop|abort|kill|delete|remove|book|reserve|pay|send|forward|email|mail|reply|approve|reject|confirm|buy|order|purchase|checkout|add|create|set|remind|schedule|move|reschedule|snooze|postpone|alert|notify|watch|track|monitor|save|remember|log|split|transfer)\b/i

/** Cheap pre-check so a route can skip its actor lookup when no understanding provider is configured. */
export function isUnderstandFirstReady(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(String(env.TYPESAFE_API_KEY || '').trim())
}

export type LiveDecision = { dispatch: boolean; reason: string }

/** Pure live policy. */
export function decideLiveDispatch(u: UnderstandingResult | null, ctx: UnderstandingContext | null, opts: { enabled: boolean; text: string }): LiveDecision {
  if (!opts.enabled) return { dispatch: false, reason: 'live_disabled' }
  if (!u || !ctx) return { dispatch: false, reason: 'no_reading' }
  if (!u.ok) return { dispatch: false, reason: u.error || 'reading_failed' }
  if (!u.action) return { dispatch: false, reason: u.reasons[0] || 'no_action' }
  if (!SAFE_LIVE_ACTIONS.has(u.action)) return { dispatch: false, reason: 'not_in_safe_live_set' }
  if (u.confidence < UNDERSTANDING_LIVE_MIN_CONFIDENCE) return { dispatch: false, reason: 'below_live_confidence' }
  if (MUTATION_LEAD.test(opts.text)) return { dispatch: false, reason: 'explicit_mutation_verb' }
  const spec = actionSpec(u.action)
  if (spec.referent === 'required' && !u.referent) return { dispatch: false, reason: 'referent_unresolved' }
  if (u.referent) {
    // The referent must be an owner-owned record that is in this turn's context pack.
    const owned = u.referent.kind === 'pending_question' ? ctx.pendingQuestion?.id === u.referent.id
      : u.referent.kind === 'document' || u.referent.kind === 'ticket' ? ctx.savedAssetsIndex.some(a => a.id === u.referent!.id)
        : u.referent.kind === 'task' ? ctx.openTasks.some(t => t.id === u.referent!.id)
          : u.referent.kind === 'approval' ? ctx.pendingApprovals.some(t => t.id === u.referent!.id)
            : u.referent.kind === 'memory' ? ctx.memoryFacts.some(m => m.id === u.referent!.id)
              : false
    if (!owned) return { dispatch: false, reason: 'referent_not_owned' }
  }
  if (u.action === 'answer_pending_question') {
    const last = ctx.recentTurns[ctx.recentTurns.length - 1]
    if (!ctx.pendingQuestion || !last || last.role !== 'assistant') return { dispatch: false, reason: 'pending_question_not_latest' }
  }
  if (u.action === 'plan_with_clarification' && !u.clarifyingQuestion) return { dispatch: false, reason: 'no_clarifying_question' }
  return { dispatch: true, reason: 'safe_live' }
}

/** Runs the safe handler for an approved decision. Returns null to fall through. */
export async function dispatchUnderstanding(u: UnderstandingResult, ctx: UnderstandingContext, text: string, handlers: UnderstandFirstHandlers): Promise<UnderstandFirstReply | null> {
  switch (u.action) {
    case 'answer_pending_question': {
      const pending = ctx.pendingQuestion
      if (!pending) return null
      // The answer to a question understand-first itself asked continues as conversation with that question in view.
      if (isUnderstandFirstClarifier(pending.text)) {
        const reply = await handlers.assistant({ text, intent: 'general_chat' })
        return reply ? { ...reply, handledBy: 'understand-first-clarify-answer' } : null
      }
      for (const answer of handlers.pendingAnswerers) {
        const reply = await answer({ text, pendingQuestion: pending })
        if (reply) return reply
      }
      return null
    }
    case 'retrieve_saved_document':
      return u.referent ? handlers.retrieveDocument({ text, referent: u.referent }) : null
    case 'task_status':
      return handlers.taskStatus({ text, referent: u.referent })
    case 'memory_recall': {
      const reply = await handlers.assistant({ text, intent: 'general_chat' })
      return reply ? { ...reply, handledBy: reply.handledBy || 'understand-first-recall' } : null
    }
    case 'general_chat': {
      const reply = await handlers.assistant({ text, intent: 'general_chat' })
      return reply ? { ...reply, handledBy: reply.handledBy || 'understand-first-chat' } : null
    }
    case 'web_answer': {
      const reply = await handlers.assistant({ text, intent: 'web_search' })
      return reply ? { ...reply, handledBy: reply.handledBy || 'understand-first-web' } : null
    }
    case 'plan_with_clarification':
      // One question, nothing executed.
      return u.clarifyingQuestion ? { text: u.clarifyingQuestion, handledBy: 'understand-first-clarify', status: 'paused', persisted: false } : null
    default:
      return null
  }
}

/** Schedules work after the response is sent; outside a request scope (tests, scripts) it runs detached. */
export function runAfterResponse(task: () => Promise<unknown>) {
  const run = () => task().catch((err: any) => console.error('UNDERSTAND_FIRST_BACKGROUND_FAILED:', String(err?.message || err).slice(0, 160)))
  try { after(run) } catch { void run() }
}

function clean(v: unknown, max = 200) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }

export async function recordUnderstandingShadow(p: {
  telegramId: number | string
  surface: string
  eventId: string | null
  text: string
  understanding: UnderstandingResult | null
  context: UnderstandingContext | null
  decision: LiveDecision
  liveEnabled: boolean
  dispatchedHandler: string | null
  totalMs: number
  skipped?: string | null
}) {
  const u = p.understanding
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(p.telegramId),
    event_type: 'understanding_shadow',
    message: p.dispatchedHandler ? 'Understand-first answered the turn (safe live set).' : 'Understand-first read the turn in shadow; existing routing handled it.',
    metadata_json: {
      surface: p.surface,
      event_id: p.eventId,
      user_text: isSecretShapedMemory(p.text) ? '[sensitive turn withheld]' : redactSecretShapedText(clean(p.text, 800)),
      understanding_version: u?.version || null,
      ok: Boolean(u?.ok),
      action: u?.action || null,
      proposed_action: u?.proposedAction || null,
      handler: u?.handler || null,
      referent: u?.referent ? { id: u.referent.id, kind: u.referent.kind } : null,
      slots: u?.slots || {},
      clarifying_question: u?.clarifyingQuestion || null,
      confidence: u?.confidence ?? null,
      reasons: (u?.reasons || []).slice(0, 8),
      error: u?.error || null,
      model_latency_ms: u?.latencyMs ?? null,
      total_ms: p.totalMs,
      candidate_count: u?.candidateCount ?? 0,
      usage: u?.usage || null,
      context_sources: p.context?.sourceStatus || {},
      pending_question: Boolean(p.context?.pendingQuestion),
      skipped: p.skipped || null,
      live: { enabled: p.liveEnabled, dispatched: Boolean(p.dispatchedHandler), reason: p.decision.reason, handled_by: p.dispatchedHandler },
    },
  })
  if (error) console.error('UNDERSTANDING_SHADOW_ACTIVITY_FAILED:', error.message)
}

export type UnderstandFirstOutcome = {
  reply: UnderstandFirstReply | null
  understanding: UnderstandingResult | null
  decision: LiveDecision
  totalMs: number
  modelCalls: number
}

/**
 * The single choke point. Awaited only while live is on (bounded by the hard budget); with live off the
 * reading runs after the response for shadow only. Never throws.
 */
export async function runUnderstandFirst(p: {
  actor: ContextActor
  surface: 'whatsapp' | 'web'
  text: string
  eventId: string | null
  handlers: UnderstandFirstHandlers
  skip?: string | null
  deps?: { callModel?: UnderstandingModelCall; loaders?: SourceLoaders; budgetMs?: number; now?: Date; env?: Record<string, string | undefined>; record?: typeof recordUnderstandingShadow; recordOutcome?: (o: { telegramId: number; surface: 'whatsapp' | 'web'; eventId: string; actualHandler: string; status?: string | null; runId?: string | null }) => Promise<unknown>; background?: (task: () => Promise<unknown>) => void }
}): Promise<UnderstandFirstOutcome> {
  const started = Date.now()
  const enabled = understandFirstLiveEnabled(p.deps?.env)
  const record = p.deps?.record || recordUnderstandingShadow
  const background = p.deps?.background || runAfterResponse
  const text = String(p.text || '').trim()
  const none = (reason: string): UnderstandFirstOutcome => ({ reply: null, understanding: null, decision: { dispatch: false, reason }, totalMs: Date.now() - started, modelCalls: 0 })
  try {
    if (!text) return none('empty')
    if (p.skip) return none(p.skip)
    // Fixed commands and bare menu numbers are unambiguous by construction; no reading is spent on them.
    if (isExactCommand(text)) return none('exact_command')
    // 20 Oct live: "Train from Bangalore to Mysore tomorrow morning" was read as chat/web and answered by the
    // chat model with invented train times. A rail route belongs to the train specialist, which reads the
    // provider or says it could not verify. Loaded only when a rail word is present.
    if (/\b(?:trains?|railways?|irctc)\b/i.test(text)) {
      const rail: any = await import('./train-research').catch(() => null)
      if (rail?.isTrainResearchRequest?.(text)) return none('train_specialist')
    }
    // Round 6 (#23): "What do you remember about my Jailer booking?" belongs to the saved-ticket lookup, not chat.
    if (/\b(?:remember|know)\b/i.test(text)) {
      const assets: any = await import('../services/asset-memory').catch(() => null)
      if (assets?.isBookingRecallAsk?.(text)) return none('ticket_recall_specialist')
    }
    if (!p.deps?.callModel && !String(process.env.TYPESAFE_API_KEY || '').trim()) return none('not_configured')
    const budget = Math.max(200, Math.min(p.deps?.budgetMs ?? UNDERSTAND_FIRST_BUDGET_MS, UNDERSTAND_FIRST_BUDGET_MS))
    const now = p.deps?.now || new Date()

    const read = async () => {
      const context = await buildUnderstandingContext({ actor: p.actor, text, now, timezone: p.actor.timezone, loaders: p.deps?.loaders })
      const left = budget - (Date.now() - started) - 50
      if (left < 100) return { context, understanding: null as UnderstandingResult | null }
      const understanding = await understandMessage({ actor: p.actor, text, now, timezone: p.actor.timezone, ...context }, { callModel: p.deps?.callModel, timeoutMs: Math.min(UNDERSTAND_FIRST_MODEL_MAX_MS, left) })
      return { context, understanding }
    }

    if (!enabled) {
      // Shadow only: zero latency on the reply path.
      background(async () => {
        const r = await read()
        await record({ telegramId: p.actor.legacyTelegramId, surface: p.surface, eventId: p.eventId, text, understanding: r.understanding, context: r.context, decision: { dispatch: false, reason: 'live_disabled' }, liveEnabled: false, dispatchedHandler: null, totalMs: Date.now() - started })
      })
      return { ...none('live_disabled'), modelCalls: 1 }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const r = await Promise.race([
      read(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), budget) }),
    ]).finally(() => timer && clearTimeout(timer))
    const understanding = r?.understanding || null
    const context = r?.context || null
    const decision = r ? decideLiveDispatch(understanding, context, { enabled, text }) : { dispatch: false, reason: 'budget_timeout' }
    let reply: UnderstandFirstReply | null = null
    if (decision.dispatch && understanding && context) {
      reply = await dispatchUnderstanding(understanding, context, text, p.handlers).catch((err: any) => {
        console.error('UNDERSTAND_FIRST_DISPATCH_FAILED:', clean(err?.message || err, 160))
        return null
      })
    }
    const finalDecision = decision.dispatch && !reply ? { dispatch: false, reason: 'handler_declined' } : decision
    const totalMs = Date.now() - started
    console.info('UNDERSTAND_FIRST:', JSON.stringify({ surface: p.surface, action: understanding?.action ?? null, confidence: understanding?.confidence ?? null, referent: understanding?.referent?.kind ?? null, live: finalDecision.reason, handledBy: reply?.handledBy ?? null, ms: totalMs, modelMs: understanding?.latencyMs ?? null, error: understanding?.error ?? null }))
    background(async () => {
      await record({ telegramId: p.actor.legacyTelegramId, surface: p.surface, eventId: p.eventId, text, understanding, context, decision: finalDecision, liveEnabled: enabled, dispatchedHandler: reply?.handledBy || null, totalMs })
      if (reply && p.eventId) {
        const recordOutcome = p.deps?.recordOutcome || (async (o: any) => (await import('./shadow-router-outcome')).recordShadowRouterOutcome(o))
        await recordOutcome({ telegramId: p.actor.legacyTelegramId, surface: p.surface, eventId: p.eventId, actualHandler: reply.handledBy, status: reply.status ?? null, runId: reply.runId ?? null })
      }
    })
    return { reply, understanding, decision: finalDecision, totalMs, modelCalls: 1 }
  } catch (err: any) {
    console.error('UNDERSTAND_FIRST_FAILED:', clean(err?.message || err, 160))
    return none('error')
  }
}

/**
 * Default handlers, built on the existing read-only paths. Heavy modules load lazily so a route that
 * never dispatches pays nothing for them.
 */
export function buildUnderstandFirstHandlers(p: {
  actor: ContextActor & { userId?: string; whatsappId?: string; name?: string | null }
  surface: 'whatsapp' | 'web'
  externalUserId: string
  userName?: string | null
  messageId: string | null
  /** True when the route already ran the pending-question registry for this exact text (single owner). */
  registryChecked?: boolean
}): UnderstandFirstHandlers {
  const telegramId = Number(p.actor.legacyTelegramId)
  const assistant: UnderstandFirstHandlers['assistant'] = async ({ text, intent }) => {
    const { processIncomingMessage } = await import('@/lib/bot/process-message')
    const result = await processIncomingMessage({ channel: 'whatsapp', externalUserId: p.externalUserId, text, userName: p.userName || undefined, messageType: 'text', messageId: p.messageId, understoodIntent: intent, pendingQuestionChecked: true })
    if (!result?.text) return null
    // An empty handledBy lets dispatchUnderstanding name the action (chat / recall / web) for the shadow pairing.
    return { ...result, text: result.text, handledBy: result.handledBy || '', persisted: true }
  }
  return {
    pendingAnswerers: p.registryChecked ? [] : [async ({ text }) => {
      if (!p.actor.userId || !p.actor.whatsappId) return null
      const { tryResolvePendingQuestion } = await import('@/lib/bot/pending-question-resolver')
      const r = await tryResolvePendingQuestion({ user: { telegramId }, text, surface: p.surface, actor: p.actor as any, messageId: p.messageId })
      // A rewrite needs the caller to re-route the completed request; this path cannot, so it falls through.
      return r && !r.rewrite ? { ...r, text: r.text, handledBy: r.handledBy, persisted: false } : null
    }],
    async retrieveDocument({ text, referent }) {
      const assets = await import('@/lib/services/asset-memory')
      // 20 Oct live: a ticket/QR ask ("Jailer qr code") is answered from the saved booking's attached ticket
      // first, with the image, on both surfaces. Only a real match claims it; otherwise the lookup below runs.
      if (assets.isTicketRetrievalAsk(text)) {
        const ticket = await assets.buildTicketRetrievalReply(telegramId, text, p.messageId)
        if (ticket?.found) {
          return { text: ticket.text, handledBy: 'understand-first-retrieve', status: 'completed', persisted: false,
            ...(ticket.mediaUrl ? { mediaUrl: ticket.mediaUrl, mediaType: ticket.mediaType || undefined } : {}) }
        }
      }
      if (referent.kind === 'document') {
        const docId = referent.id.replace(/^doc:/, '')
        const reply = await assets.buildDocumentReplyById(telegramId, docId, text, p.messageId)
        return reply ? { text: reply, handledBy: 'understand-first-retrieve', status: 'completed', persisted: false } : null
      }
      // A ticket row has no file id; the saved ticket file is found by its event/route name.
      const reply = await assets.buildAssetRetrievalReply(telegramId, `${referent.title} ${text}`.slice(0, 300), p.messageId)
      return reply ? { text: reply, handledBy: 'understand-first-retrieve', status: 'completed', persisted: false } : null
    },
    async taskStatus({ text, referent }) {
      const { tryGetTaskStatus } = await import('./task-status')
      const { tryGetAutonomyStatus } = await import('./autonomy-status')
      const actor = p.actor as any
      const named = await tryGetTaskStatus({ telegramId }, text)
        || (referent?.kind === 'task' ? await tryGetTaskStatus({ telegramId }, `status of the ${referent.title.split(' · ')[0]} task`) : null)
      if (named) return { ...named, handledBy: named.handledBy || 'task-status', persisted: false }
      const general = await tryGetAutonomyStatus({ actor, text }) || await tryGetAutonomyStatus({ actor, text: 'what are you working on?' })
      return general ? { ...general, text: String(general.text), handledBy: String(general.handledBy || 'autonomy-status'), persisted: false } : null
    },
    assistant,
  }
}

/**
 * Route entry: builds handlers and runs the choke point. Returns null whenever the turn should continue
 * through the existing routing.
 */
export async function tryUnderstandFirst(p: {
  actor: ContextActor & { userId?: string; whatsappId?: string; name?: string | null }
  surface: 'whatsapp' | 'web'
  text: string
  eventId: string | null
  externalUserId: string
  userName?: string | null
  registryChecked?: boolean
  skip?: string | null
}): Promise<UnderstandFirstReply | null> {
  const handlers = buildUnderstandFirstHandlers({ actor: p.actor, surface: p.surface, externalUserId: p.externalUserId, userName: p.userName, messageId: p.eventId, registryChecked: p.registryChecked })
  const outcome = await runUnderstandFirst({ actor: p.actor, surface: p.surface, text: p.text, eventId: p.eventId, handlers, skip: p.skip })
  return outcome.reply
}

