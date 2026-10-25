/**
 * Understand-first (step 2 + safe live set): ONE structured reading of the whole message with its
 * context, before any keyword matcher decides.
 *
 * Founder direction (19 Oct): "it should understand the whole sentence and then decide what to do… we
 * should always look for the context instead of just few words". Benchmarked on Instinct and Wajo.
 *
 * Contract:
 *  - One model call (TypeSafe / Jev, the same provider and boundary rules as lib/typesafe/jev-shadow.ts),
 *    closed-choice questions only, so every answer is a calibrated choice with a confidence.
 *  - The action is a closed enum mapped to EXISTING handler names. Unknown actions are rejected.
 *  - A referent is only ever an id taken from the owner-bound context pack. The model cannot invent one.
 *  - Slots are normalised deterministically from the user's own words (never model free text), so a slot
 *    can never contain something the user did not say.
 *  - Never throws. A timeout, missing key, malformed answer or sensitive turn returns ok:false.
 *  - Secret-shaped text never crosses the model boundary ("typesafe_sensitive_state_withheld").
 *
 * This module decides nothing on its own. lib/agent/understand-first.ts applies the live policy.
 */
import { isSecretShapedMemory, redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { JEV_SHADOW_MODEL } from '@/lib/typesafe/questions'
import { postSystemOne } from '@/lib/typesafe/systemone'
import { MIN_CALIBRATION_SAMPLES } from './decision-evidence'

export const UNDERSTANDING_VERSION = 'understanding-v1'
/** Below this the reading is recorded but carries no action at all. */
export const UNDERSTANDING_MIN_CONFIDENCE = 0.6
/** Same threshold as guarded live learning (decision-learning.ts calibrateGuardedRouting). Do not lower. */
export const UNDERSTANDING_LIVE_MIN_CONFIDENCE = 0.82
/** A pending question older than this is not "the question Gogo just asked". */
export const PENDING_QUESTION_TTL_MS = 30 * 60_000

type ActionSpec = {
  description: string
  /** Existing handledBy / actualHandler names that legitimately serve this action. */
  handlers: readonly string[]
  /** May understand-first dispatch it live (read-only or question-only)? */
  safeLive: boolean
  referent: 'required' | 'optional' | 'none'
  referentKinds?: readonly ReferentKind[]
}

export const UNDERSTANDING_ACTIONS = {
  answer_pending_question: { description: "The message answers the question Gogo asked in its latest message (a name, a choice such as 22K or 24K, a time, yes/no to that question). Short replies right after a question are usually answers.", handlers: ['restaurant-reservation', 'price-watch-clarification', 'gold-rate-watch', 'understand-first-clarify-answer'], safeLive: true, referent: 'required', referentKinds: ['pending_question'] },
  retrieve_saved_document: { description: 'Show or send back something the user already saved: a document, file, ticket, QR code, boarding pass, ID, receipt or card. Not booking anything new.', handlers: ['understand-first-retrieve', 'link-vault', 'travel-details', 'same-brain'], safeLive: true, referent: 'required', referentKinds: ['document', 'ticket'] },
  task_status: { description: "Ask what Gogo is working on, or for progress/update on one of Gogo's own tasks, runs or approvals. Not the status of an external order, a person, or a flight.", handlers: ['task-status', 'autonomy-status', 'open-loops'], safeLive: true, referent: 'optional', referentKinds: ['task', 'approval'] },
  task_cancel: { description: "Cancel, stop or abort one of Gogo's own running tasks.", handlers: ['run-cancel', 'open-loops'], safeLive: false, referent: 'optional', referentKinds: ['task', 'approval'] },
  set_reminder: { description: 'Create a new reminder for the user.', handlers: ['legacy-feature-intent', 'process-message', 'whatsapp-agent-reminder', 'feature-intent'], safeLive: false, referent: 'none' },
  reminder_read: { description: 'List or ask about existing reminders without changing them.', handlers: ['reminder-query', 'legacy-feature-intent', 'whatsapp-agent-reminder', 'process-message'], safeLive: false, referent: 'optional', referentKinds: ['reminder'] },
  modify_reminder: { description: 'Move, snooze, reschedule, edit or delete an existing reminder (including reminder button replies such as "Move to 8pm").', handlers: ['reminder-update', 'legacy-feature-intent', 'whatsapp-agent-reminder', 'process-message'], safeLive: false, referent: 'optional', referentKinds: ['reminder'] },
  create_watch: { description: 'Create an ongoing alert, monitor or watch on a condition (price drops, stock, gold rate, flight, web page).', handlers: ['gold-rate-watch', 'web-page-watch', 'product-stock-watch', 'flight-watch', 'background-web-watch', 'price-watch-clarification', 'watcher', 'inbox-triage-watch'], safeLive: false, referent: 'none' },
  watch_status: { description: 'List, inspect, change or stop existing watches/monitors/alerts.', handlers: ['watcher-status', 'watcher-stop', 'watcher-update', 'product-stock-watch-status'], safeLive: false, referent: 'optional', referentKinds: ['watch'] },
  web_answer: { description: 'A factual question about the current world that needs a live lookup: prices, rates, news, weather, scores, opening hours.', handlers: ['process-message', 'legacy-feature-intent', 'feature-intent', 'reference-fx', 'understand-first-web'], safeLive: true, referent: 'none' },
  restaurant_booking: { description: 'Book or reserve a table at a restaurant, bar or cafe.', handlers: ['restaurant-reservation', 'restaurant-reservation-background'], safeLive: false, referent: 'none' },
  event_or_travel_booking: { description: 'Book new tickets, flights, trains, hotels or events, or research travel options to book.', handlers: ['flight-booking', 'travel-research', 'travel-research-queued', 'train-research', 'secure-browser', 'browser-flight-task', 'creditiq-travel', 'creditiq-hotels'], safeLive: false, referent: 'none' },
  calendar_read: { description: "Read the user's calendar or schedule without changing it.", handlers: ['read-only-schedule', 'calendar-named-read', 'dashboard-day', 'workspace-meeting-prep'], safeLive: false, referent: 'none' },
  calendar_event: { description: 'Add, move or cancel a calendar event or meeting.', handlers: ['calendar-update', 'booking-event-calendar', 'typed-object-routing', 'whatsapp-agent'], safeLive: false, referent: 'optional', referentKinds: ['calendar_event'] },
  price_compare: { description: 'Compare prices or availability of a product or groceries across shops/apps.', handlers: ['price-comparison', 'food-comparison', 'grocery-comparison', 'compound-shopping-friend'], safeLive: false, referent: 'none' },
  order_status: { description: 'Status of an external order or delivery (Amazon, Flipkart, Swiggy, a courier).', handlers: ['account-site-order-email', 'account-site-background-read', 'whatsapp-agent', 'external-account-objective'], safeLive: false, referent: 'none' },
  send_message: { description: 'Draft, reply to, forward or send an email or message to someone.', handlers: ['gmail-send', 'gmail-context'], safeLive: false, referent: 'none' },
  browser_task: { description: 'Act on an external website or account (sign in, fill a form, checkout).', handlers: ['secure-browser', 'whatsapp-agent', 'external-account-objective', 'account-site-sign-in'], safeLive: false, referent: 'none' },
  money_or_list: { description: 'Log or review expenses, split bills, read or change lists and notes, log or review food eaten, credit-card points.', handlers: ['legacy-feature-intent', 'feature-intent', 'process-message'], safeLive: false, referent: 'none' },
  account_settings: { description: 'Plans, pricing, the dashboard link, briefing settings, connecting or disconnecting Gmail/Calendar or other accounts.', handlers: ['connection-status', 'connection-capabilities', 'process-message', 'legacy-feature-intent'], safeLive: false, referent: 'none' },
  memory_save: { description: 'Ask Gogo to remember or save a fact or link.', handlers: ['process-message', 'link-vault', 'feature-intent', 'legacy-feature-intent'], safeLive: false, referent: 'none' },
  memory_recall: { description: 'Ask what the user told Gogo before, or recall a saved personal fact (where they parked, a name, a preference).', handlers: ['same-brain', 'process-message', 'link-vault', 'understand-first-recall'], safeLive: true, referent: 'optional', referentKinds: ['memory'] },
  plan_with_clarification: { description: 'An open request to plan or organise something (a weekend, a trip day, a party) that needs one preference before planning.', handlers: ['general-plan', 'persistent-general-plan', 'understand-first-clarify'], safeLive: true, referent: 'none' },
  general_chat: { description: 'Conversation, advice, opinions, or questions about life that need no tool and no saved object.', handlers: ['process-message', 'same-brain', 'understand-first-chat'], safeLive: true, referent: 'none' },
} as const satisfies Record<string, ActionSpec>

export type UnderstandingAction = keyof typeof UNDERSTANDING_ACTIONS
export const UNDERSTANDING_ACTION_NAMES = Object.keys(UNDERSTANDING_ACTIONS) as UnderstandingAction[]
export const SAFE_LIVE_ACTIONS: ReadonlySet<UnderstandingAction> = new Set(UNDERSTANDING_ACTION_NAMES.filter(a => (UNDERSTANDING_ACTIONS[a] as ActionSpec).safeLive))

export function isUnderstandingAction(value: unknown): value is UnderstandingAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UNDERSTANDING_ACTIONS, value)
}
export function actionSpec(action: UnderstandingAction): ActionSpec { return UNDERSTANDING_ACTIONS[action] as ActionSpec }
/** The existing handler names an action maps onto (first one is the primary). */
export function handlersForAction(action: UnderstandingAction): readonly string[] { return actionSpec(action).handlers }

// ---------------------------------------------------------------- context types

export type ReferentKind = 'pending_question' | 'document' | 'ticket' | 'task' | 'approval' | 'reminder' | 'watch' | 'calendar_event' | 'memory'
export type Turn = { role: 'user' | 'assistant'; content: string; createdAt?: string | null }
export type PendingQuestion = { id: 'q:latest'; text: string; askedAt: string | null }
export type ContextItem = { id: string; title: string; detail?: string | null; at?: string | null }

export type UnderstandingContext = {
  recentTurns: Turn[]
  pendingQuestion: PendingQuestion | null
  openTasks: ContextItem[]
  pendingApprovals: ContextItem[]
  savedAssetsIndex: Array<ContextItem & { kind: 'document' | 'ticket'; type?: string | null }>
  watches: ContextItem[]
  upcomingReminders: ContextItem[]
  travelLegs: ContextItem[]
  calendarEvents: ContextItem[]
  preferences: string[]
  memoryFacts: ContextItem[]
  profile: { name?: string | null; city?: string | null; timezone?: string | null; pincode?: string | null }
  sourceStatus: Record<string, 'included' | 'empty' | 'timeout' | 'error' | 'skipped'>
}

export function emptyUnderstandingContext(): UnderstandingContext {
  return { recentTurns: [], pendingQuestion: null, openTasks: [], pendingApprovals: [], savedAssetsIndex: [], watches: [], upcomingReminders: [], travelLegs: [], calendarEvents: [], preferences: [], memoryFacts: [], profile: {}, sourceStatus: {} }
}

export type UnderstandingInput = {
  actor: { legacyTelegramId: number; name?: string | null; timezone?: string | null }
  text: string
  now?: Date
  timezone?: string | null
} & Partial<UnderstandingContext>

export type Referent = { id: string; kind: ReferentKind; title: string }

export type UnderstandingResult = {
  ok: boolean
  version: string
  action: UnderstandingAction | null
  /** What the model chose before validation (kept for the shadow comparison). */
  proposedAction: string | null
  handler: string | null
  referent: Referent | null
  slots: Record<string, string | number>
  clarifyingQuestion: string | null
  confidence: number
  reasons: string[]
  latencyMs: number
  candidateCount: number
  usage?: { inputTokens: number | null; outputTokens: number | null }
  error?: string
}

// ---------------------------------------------------------------- helpers

function clean(value: unknown, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}
/** Model-boundary scrub: secret-shaped -> dropped, long digit runs and emails masked. */
export function scrubForModel(value: unknown, max = 200): string | null {
  const raw = clean(value, max * 2)
  if (!raw) return null
  if (isSecretShapedMemory(raw)) return null
  return redactSecretShapedText(raw).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').replace(/\d{7,}/g, '[number]').slice(0, max)
}

/** The latest assistant turn, when it is a question and is still fresh. Pure. */
export function detectPendingQuestion(turns: Turn[], now: Date = new Date()): PendingQuestion | null {
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'assistant') return null
  const text = String(last.content || '').trim()
  if (!/\?/.test(text)) return null
  const at = last.createdAt ? Date.parse(last.createdAt) : NaN
  if (Number.isFinite(at) && now.getTime() - at > PENDING_QUESTION_TTL_MS) return null
  // The question sentence itself (the last sentence that ends with "?").
  const sentences = text.split(/(?<=[?.!])\s+/).filter(s => s.includes('?'))
  const question = clean(sentences[sentences.length - 1] || text, 240)
  return { id: 'q:latest', text: question, askedAt: last.createdAt || null }
}

export function buildReferentCandidates(ctx: Partial<UnderstandingContext>): Referent[] {
  const out: Referent[] = []
  const push = (id: string, kind: ReferentKind, title: string | null | undefined) => {
    const t = clean(title, 120)
    if (!id || !t || out.some(r => r.id === id)) return
    out.push({ id, kind, title: t })
  }
  if (ctx.pendingQuestion) push(ctx.pendingQuestion.id, 'pending_question', ctx.pendingQuestion.text)
  for (const a of ctx.savedAssetsIndex || []) push(a.id, a.kind, [a.title, a.type, a.at ? String(a.at).slice(0, 10) : ''].filter(Boolean).join(' · '))
  for (const t of ctx.openTasks || []) push(t.id, 'task', [t.title, t.detail].filter(Boolean).join(' · '))
  for (const t of ctx.pendingApprovals || []) push(t.id, 'approval', [t.title, t.detail].filter(Boolean).join(' · '))
  for (const r of ctx.upcomingReminders || []) push(r.id, 'reminder', [r.title, r.at].filter(Boolean).join(' · '))
  for (const w of ctx.watches || []) push(w.id, 'watch', w.title)
  for (const e of ctx.calendarEvents || []) push(e.id, 'calendar_event', [e.title, e.at].filter(Boolean).join(' · '))
  for (const m of ctx.memoryFacts || []) push(m.id, 'memory', m.title)
  return out.slice(0, 40)
}

const MISSING_INFO = {
  none: 'Nothing required is missing, or sensible defaults exist.',
  date_or_time: 'The day or time is required and was not given.',
  party_size: 'How many people is required and was not given.',
  place: 'Which place, city, venue or restaurant is required and was not given.',
  which_item: 'It is unclear which saved item, task or reminder is meant.',
  preferences: 'An open request needs one preference (what kind, what to include) before acting.',
} as const
type MissingInfo = keyof typeof MISSING_INFO

// ---------------------------------------------------------------- request

const SECTION_LIMITS: Array<[keyof UnderstandingContext, number]> = [
  ['recentTurns', 8], ['openTasks', 6], ['pendingApprovals', 5], ['savedAssetsIndex', 12], ['watches', 8], ['upcomingReminders', 10],
  ['travelLegs', 6], ['calendarEvents', 10], ['preferences', 8], ['memoryFacts', 6],
]
/** ~6k tokens. Lowest-priority sections are trimmed first when over. */
export const UNDERSTANDING_STATE_MAX_CHARS = 22_000

function itemLine(i: ContextItem & { type?: string | null }) {
  return [i.id, scrubForModel(i.title, 120), i.type ? scrubForModel(i.type, 30) : null, i.detail ? scrubForModel(i.detail, 120) : null, i.at ? clean(i.at, 40) : null].filter(Boolean).join(' | ')
}

export function buildUnderstandingRequest(input: UnderstandingInput) {
  const now = input.now || new Date()
  const tz = clean(input.timezone || input.profile?.timezone || input.actor.timezone || 'Asia/Kolkata', 60)
  const userText = String(input.text || '').slice(0, 1200)
  const sensitive = isSecretShapedMemory(userText)
  const candidates = buildReferentCandidates(input)
  const turns = (input.recentTurns || []).slice(-8).map(t => {
    const c = scrubForModel(t.content, 280)
    return c ? `${t.role}: ${c}` : `${t.role}: [withheld]`
  })
  const context: Record<string, unknown> = {
    recent_conversation: turns,
    pending_question: input.pendingQuestion ? scrubForModel(input.pendingQuestion.text, 240) : null,
    open_tasks: (input.openTasks || []).slice(0, 6).map(itemLine),
    pending_approvals: (input.pendingApprovals || []).slice(0, 5).map(itemLine),
    saved_documents_and_tickets: (input.savedAssetsIndex || []).slice(0, 12).map(itemLine),
    active_watches: (input.watches || []).slice(0, 8).map(itemLine),
    upcoming_reminders: (input.upcomingReminders || []).slice(0, 10).map(itemLine),
    travel_legs: (input.travelLegs || []).slice(0, 6).map(itemLine),
    calendar_today_tomorrow: (input.calendarEvents || []).slice(0, 10).map(itemLine),
    standing_preferences: (input.preferences || []).slice(0, 8).map(p => scrubForModel(p, 160)).filter(Boolean),
    relevant_memories: (input.memoryFacts || []).slice(0, 6).map(itemLine),
    profile: { name: scrubForModel(input.profile?.name || input.actor.name, 60), city: scrubForModel(input.profile?.city, 60), timezone: tz },
  }
  // Trim lowest-priority sections until the state fits the bound.
  const order = ['relevant_memories', 'standing_preferences', 'calendar_today_tomorrow', 'travel_legs', 'active_watches', 'upcoming_reminders', 'saved_documents_and_tickets', 'pending_approvals', 'open_tasks', 'recent_conversation']
  let size = JSON.stringify(context).length
  for (const key of order) {
    if (size <= UNDERSTANDING_STATE_MAX_CHARS) break
    const arr = context[key]
    if (Array.isArray(arr)) while (arr.length && size > UNDERSTANDING_STATE_MAX_CHARS) { arr.pop(); size = JSON.stringify(context).length }
  }
  const questions: Record<string, unknown> = {
    action: {
      type: 'choice',
      instructions: 'Read the WHOLE message together with the recent conversation and the user context, then choose what the user wants Gogo to do. Do not choose by single keywords: "book tickets" is a new booking, not retrieving a saved ticket; "how is my mom doing" is conversation, not a task status; the status of an Amazon order is an order status. A short reply right after Gogo asked a question answers that question.',
      criteria: Object.fromEntries(UNDERSTANDING_ACTION_NAMES.map(a => [a, UNDERSTANDING_ACTIONS[a].description])),
    },
    missing_info: {
      type: 'choice',
      instructions: 'Is required information missing that cannot be defaulted from the context?',
      criteria: MISSING_INFO,
    },
  }
  if (candidates.length) {
    questions.referent = {
      type: 'choice',
      instructions: 'Which listed object, if any, does the message refer to? Choose none unless one clearly matches.',
      criteria: { none: 'The message does not refer to any listed object.', ...Object.fromEntries(candidates.map(c => [c.id, `${c.kind}: ${scrubForModel(c.title, 120) || '[withheld]'}`])) },
    }
  }
  return {
    sensitive,
    candidates,
    body: {
      model: JEV_SHADOW_MODEL,
      state: {
        user_message: sensitive ? '[sensitive turn withheld from TypeSafe]' : redactSecretShapedText(userText),
        now: now.toISOString(),
        timezone: tz,
        context,
      },
      questions,
    },
  }
}

// ---------------------------------------------------------------- slots

const CITY_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:bangalore|bengaluru|blr)\b/i, 'Bangalore'], [/\b(?:mumbai|bombay)\b/i, 'Mumbai'], [/\b(?:delhi|new delhi)\b/i, 'Delhi'],
  [/\b(?:chennai|madras)\b/i, 'Chennai'], [/\bhyderabad\b/i, 'Hyderabad'], [/\b(?:kolkata|calcutta)\b/i, 'Kolkata'], [/\bpune\b/i, 'Pune'],
  [/\bgoa\b/i, 'Goa'], [/\b(?:gurgaon|gurugram)\b/i, 'Gurugram'], [/\bnoida\b/i, 'Noida'], [/\bdubai\b/i, 'Dubai'],
]
export function normalizeCity(text: string): string | null {
  for (const [re, name] of CITY_ALIASES) if (re.test(text)) return name
  return null
}
/** "7pm" -> "19:00", "8:30 am" -> "08:30", "at 10" -> null (ambiguous meridiem is not guessed). */
export function normalizeClock(text: string): string | null {
  const m = String(text || '').match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i)
  if (m) {
    let h = Number(m[1]) % 12
    if (/^p/i.test(m[3])) h += 12
    const min = m[2] ? Number(m[2]) : 0
    if (h > 23 || min > 59) return null
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  const h24 = String(text || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  return h24 ? `${h24[1].padStart(2, '0')}:${h24[2]}` : null
}
function localDate(now: Date, tz: string, addDays = 0) {
  const d = new Date(now.getTime() + addDays * 86400_000)
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) }
  catch { return d.toISOString().slice(0, 10) }
}
export function normalizeDay(text: string, now: Date, tz: string): string | null {
  const t = String(text || '').toLowerCase()
  if (/\btoday|tonight\b/.test(t)) return localDate(now, tz, 0)
  if (/\btomorrow|tmrw|tmr\b/.test(t)) return localDate(now, tz, 1)
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const idx = days.findIndex(d => new RegExp(`\\b${d}\\b`).test(t))
  if (idx >= 0) {
    let wd = 0
    try { wd = days.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now).toLowerCase()) } catch { wd = now.getUTCDay() }
    const ahead = (idx - wd + 7) % 7 || 7
    return localDate(now, tz, ahead)
  }
  return null
}

/** Deterministic slot extraction from the user's words only. */
export function extractSlots(action: UnderstandingAction, text: string, now: Date, tz: string): Record<string, string | number> {
  const t = String(text || '')
  const slots: Record<string, string | number> = {}
  const set = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== '') slots[k] = v }
  if (action === 'create_watch' || action === 'web_answer' || action === 'price_compare') {
    const asset = t.match(/\b(gold|silver|petrol|diesel|bitcoin|platinum)\b/i)?.[1]
    set('asset', asset ? asset.toLowerCase() : null)
    const karat = t.match(/\b(18|22|24)\s*(?:k|kt|karat|carat)\b/i)?.[1]
    set('karat', karat ? `${karat}K` : null)
    set('city', normalizeCity(t))
    const pct = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i)
    if (pct) {
      const n = Number(pct[1])
      const down = /\b(drop|drops|fall|falls|dip|dips|down|below|decrease|cheaper)\b/i.test(t)
      const up = /\b(rise|rises|up|above|increase|jump|jumps)\b/i.test(t)
      set('changePct', down ? -n : up ? n : n)
    }
    if (action === 'web_answer') {
      set('query', clean(t, 200))
      if (/\btoday\b/i.test(t)) set('date', localDate(now, tz, 0))
    }
  }
  if (action === 'restaurant_booking') {
    const party = t.match(/\b(?:for|table for|party of)\s+(\d{1,2})\b/i)?.[1] || t.match(/\b(\d{1,2})\s+(?:people|persons|pax|guests)\b/i)?.[1]
    set('partySize', party ? Number(party) : null)
    const venue = t.match(/\bat\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*)*)/)?.[1]
    if (venue) {
      const words = venue.split(/\s+/)
      const AREAS = /^(Indiranagar|Koramangala|Whitefield|HSR|Jayanagar|JP|Malleshwaram|Rajajinagar|MG|Church|Hebbal|Bandra|Andheri|Powai|Juhu)$/i
      const areaIdx = words.findIndex(w => AREAS.test(w))
      if (areaIdx > 0) { set('venue', words.slice(0, areaIdx).join(' ')); set('area', words.slice(areaIdx).join(' ')) }
      else set('venue', venue)
    }
    set('date', normalizeDay(t, now, tz))
    set('time', normalizeClock(t))
  }
  if (action === 'set_reminder' || action === 'modify_reminder' || action === 'calendar_event') {
    const task = t.match(/\bremind me\s+(?:to\s+)?(.+?)(?:\s+(?:today|tonight|tomorrow|on\s+\w+|at\s+\d|in\s+\d|every)\b|$)/i)?.[1]
    if (action === 'set_reminder') set('task', task ? clean(task, 120) : null)
    set('date', normalizeDay(t, now, tz))
    set('time', normalizeClock(t))
  }
  if (action === 'answer_pending_question') {
    const raw = clean(t, 120).replace(/[.!]+$/, '')
    const karat = raw.match(/^(18|22|24)\s*k(?:t|arat)?$/i)
    set('answer', karat ? `${karat[1]}K` : raw)
    set('time', normalizeClock(raw))
  }
  if (action === 'plan_with_clarification') {
    const scope = t.match(/\b(weekend|evening|tonight|tomorrow|saturday|sunday|day|trip|party|birthday|anniversary)\b/i)?.[1]
    set('scope', scope ? scope.toLowerCase() : null)
  }
  return slots
}

/** Required slots per action; the first missing one becomes the ONE clarifying question. */
const REQUIRED_SLOTS: Partial<Record<UnderstandingAction, Array<[string, string]>>> = {
  restaurant_booking: [['venue', 'Which restaurant should I book?'], ['date', 'Which day should I book for?'], ['time', 'What time should I book for?'], ['partySize', 'How many people should I book for?']],
  set_reminder: [['task', 'What should I remind you about?'], ['time', 'What time should I remind you?']],
}
export const PLAN_CLARIFIERS: Record<string, string> = {
  preferences: 'Happy to plan it. What should it include: going out, food, rest, errands, or time with someone?',
  date_or_time: 'Happy to plan it. Which day and roughly what time works for you?',
  place: 'Happy to plan it. Where should it be: around home, somewhere in the city, or a short trip out?',
  party_size: 'Happy to plan it. Who is it for: just you, a couple, family, or friends?',
}
const MISSING_TO_QUESTION: Record<MissingInfo, string | null> = {
  none: null,
  date_or_time: 'Which day and time do you mean?',
  party_size: 'How many people is this for?',
  place: 'Which place do you mean?',
  which_item: 'Which one do you mean?',
  preferences: PLAN_CLARIFIERS.preferences,
}
export function isUnderstandFirstClarifier(text: string | null | undefined): boolean {
  const t = clean(text, 400)
  return Object.values(PLAN_CLARIFIERS).some(q => t.endsWith(q))
}

// ---------------------------------------------------------------- parsing / validation

type Choice = { choice: string | null; confidence: number }
function parseChoice(v: any): Choice | null {
  if (!v || v.type !== 'choice' || typeof v.choice !== 'string' || !v.choice.trim()) return null
  const c = Number(v.confidence)
  if (!Number.isFinite(c) || c < 0 || c > 1) return null
  return { choice: v.choice.trim(), confidence: c }
}

function failed(error: string, latencyMs = 0, candidateCount = 0): UnderstandingResult {
  return { ok: false, version: UNDERSTANDING_VERSION, action: null, proposedAction: null, handler: null, referent: null, slots: {}, clarifyingQuestion: null, confidence: 0, reasons: [error], latencyMs, candidateCount, error }
}

/**
 * Validates and normalises a raw TypeSafe answer against the context it was asked with. Pure.
 * Unknown actions are rejected; low confidence carries no action; referents must come from the context.
 */
export function interpretUnderstandingResponse(raw: any, input: UnderstandingInput, latencyMs = 0): UnderstandingResult {
  const candidates = buildReferentCandidates(input)
  const answers = raw?.answers || {}
  const action = parseChoice(answers.action)
  if (!action) return failed('typesafe_malformed_response', latencyMs, candidates.length)
  const usage = {
    inputTokens: Number.isFinite(raw?.usage?.input_tokens) ? Number(raw.usage.input_tokens) : null,
    outputTokens: Number.isFinite(raw?.usage?.output_tokens) ? Number(raw.usage.output_tokens) : null,
  }
  const reasons: string[] = []
  const base = { ok: true, version: UNDERSTANDING_VERSION, proposedAction: action.choice, latencyMs, candidateCount: candidates.length, usage }
  if (!isUnderstandingAction(action.choice)) {
    return { ...base, action: null, handler: null, referent: null, slots: {}, clarifyingQuestion: null, confidence: action.confidence, reasons: ['unknown_action'] }
  }
  if (action.confidence < UNDERSTANDING_MIN_CONFIDENCE) {
    return { ...base, action: null, handler: null, referent: null, slots: {}, clarifyingQuestion: null, confidence: action.confidence, reasons: ['low_confidence'] }
  }
  const name = action.choice as UnderstandingAction
  const spec = actionSpec(name)
  const now = input.now || new Date()
  const tz = clean(input.timezone || input.profile?.timezone || input.actor.timezone || 'Asia/Kolkata', 60)

  // Referent: only an id that is in the owner-bound candidate list, of a kind this action accepts.
  let referent: Referent | null = null
  let referentConfidence = 1
  const refChoice = parseChoice(answers.referent)
  if (name === 'answer_pending_question') {
    // The referent is structural: the question Gogo just asked, never a model guess.
    referent = candidates.find(c => c.kind === 'pending_question') || null
    if (!referent) reasons.push('no_pending_question')
  } else if (refChoice && refChoice.choice !== 'none') {
    const found = candidates.find(c => c.id === refChoice.choice)
    if (!found) reasons.push('referent_not_in_context')
    else if (spec.referent === 'none' || !(spec.referentKinds || []).includes(found.kind)) reasons.push('referent_kind_mismatch')
    else { referent = found; referentConfidence = refChoice.confidence }
  }
  if (spec.referent === 'required' && !referent) reasons.push('referent_required_missing')

  const slots = extractSlots(name, input.text, now, tz)
  let clarifyingQuestion: string | null = null
  const missing = parseChoice(answers.missing_info)
  if (name === 'plan_with_clarification') {
    const kind = missing && missing.choice in PLAN_CLARIFIERS ? missing.choice : 'preferences'
    clarifyingQuestion = PLAN_CLARIFIERS[kind]
  } else {
    const firstMissing = (REQUIRED_SLOTS[name] || []).find(([slot]) => slots[slot] === undefined)
    if (firstMissing) clarifyingQuestion = firstMissing[1]
    else if (missing && missing.choice !== 'none' && missing.confidence >= UNDERSTANDING_LIVE_MIN_CONFIDENCE && missing.choice in MISSING_TO_QUESTION && spec.referent !== 'none' && !referent) {
      clarifyingQuestion = MISSING_TO_QUESTION[missing.choice as MissingInfo]
    }
  }
  const confidence = referent && spec.referent !== 'none' && name !== 'answer_pending_question' ? Math.min(action.confidence, referentConfidence) : action.confidence
  reasons.unshift(`action:${name}@${action.confidence.toFixed(2)}`)
  return { ...base, action: name, handler: spec.handlers[0], referent, slots, clarifyingQuestion, confidence, reasons }
}

// ---------------------------------------------------------------- model call

export type UnderstandingModelCall = (body: unknown, timeoutMs: number) => Promise<{ raw: any; latencyMs: number } | { error: string; latencyMs: number }>

/** The TypeSafe call (lib/typesafe/systemone.ts: same endpoint, key and abort behaviour as runJevShadow). */
export const callTypeSafe: UnderstandingModelCall = (body, timeoutMs) => postSystemOne(body, timeoutMs)

/** One structured reading of the whole message with its context. Never throws. */
export async function understandMessage(input: UnderstandingInput, deps: { callModel?: UnderstandingModelCall; timeoutMs?: number } = {}): Promise<UnderstandingResult> {
  try {
    if (!String(input.text || '').trim()) return failed('empty_message')
    const request = buildUnderstandingRequest(input)
    if (request.sensitive) return failed('typesafe_sensitive_state_withheld', 0, request.candidates.length)
    const timeoutMs = Math.max(100, Math.min(Number(deps.timeoutMs || 1500), 2500))
    const call = deps.callModel || callTypeSafe
    // The provider abort is the first line; this race is the hard cap if a fetch ignores the signal.
    const response = await Promise.race([
      call(request.body, timeoutMs),
      new Promise<{ error: string; latencyMs: number }>(resolve => setTimeout(() => resolve({ error: 'typesafe_timeout', latencyMs: timeoutMs }), timeoutMs + 50)),
    ])
    if ('error' in response) return failed(response.error, response.latencyMs, request.candidates.length)
    return interpretUnderstandingResponse(response.raw, input, response.latencyMs)
  } catch (err: any) {
    return failed(clean(err?.message || 'understanding_error', 120))
  }
}

// ---------------------------------------------------------------- shadow comparison

export type UnderstandingComparisonRow = {
  eventId: string
  action: string | null
  confidence: number
  liveDispatched?: boolean
  actualHandler: string | null
}

/** Which actions an actual handler name is evidence for. */
export function actionsForHandler(handler: string | null | undefined): UnderstandingAction[] {
  const h = String(handler || '')
  if (!h) return []
  return UNDERSTANDING_ACTION_NAMES.filter(a => (handlersForAction(a) as readonly string[]).includes(h))
}

/**
 * Agreement between the shadow understanding and what production actually did. Turns understand-first
 * dispatched itself are excluded (they would agree with themselves). Promotion per action reuses the
 * promotion-gate thresholds: >= MIN_CALIBRATION_SAMPLES paired turns and >= 90% agreement.
 */
export function compareUnderstandingToActual(rows: UnderstandingComparisonRow[]) {
  const perAction = new Map<string, { paired: number; agree: number; confident: number; confidentAgree: number; disagreements: Array<{ eventId: string; actualHandler: string }> }>()
  let observed = 0, paired = 0, agree = 0, liveDispatched = 0, noAction = 0
  for (const row of rows) {
    observed++
    if (row.liveDispatched) { liveDispatched++; continue }
    if (!row.action) { noAction++; continue }
    if (!row.actualHandler) continue
    paired++
    const entry = perAction.get(row.action) || { paired: 0, agree: 0, confident: 0, confidentAgree: 0, disagreements: [] }
    entry.paired++
    const ok = actionsForHandler(row.actualHandler).includes(row.action as UnderstandingAction)
    if (ok) { entry.agree++; agree++ } else entry.disagreements.push({ eventId: row.eventId, actualHandler: row.actualHandler })
    if (row.confidence >= UNDERSTANDING_LIVE_MIN_CONFIDENCE) { entry.confident++; if (ok) entry.confidentAgree++ }
    perAction.set(row.action, entry)
  }
  const actions = [...perAction.entries()].map(([action, e]) => {
    const agreementRate = e.paired ? e.agree / e.paired : 0
    const confidentAgreementRate = e.confident ? e.confidentAgree / e.confident : null
    const failures: string[] = []
    if (e.confident < MIN_CALIBRATION_SAMPLES) failures.push(`confident_samples_below_${MIN_CALIBRATION_SAMPLES}`)
    if (confidentAgreementRate === null || confidentAgreementRate < 0.9) failures.push('confident_agreement_below_90_percent')
    if (!isUnderstandingAction(action) || !SAFE_LIVE_ACTIONS.has(action)) failures.push('not_in_safe_live_set')
    return { action, paired: e.paired, agree: e.agree, agreementRate, confident: e.confident, confidentAgreementRate, promotable: failures.length === 0, failures, disagreements: e.disagreements.slice(0, 20) }
  }).sort((a, b) => b.paired - a.paired)
  return {
    totals: { observed, paired, agree, liveDispatched, noAction },
    agreementRate: paired ? agree / paired : null,
    thresholds: { minimumConfidentSamplesPerAction: MIN_CALIBRATION_SAMPLES, minimumAgreement: 0.9, liveConfidence: UNDERSTANDING_LIVE_MIN_CONFIDENCE },
    actions,
  }
}
