/**
 * Semantic gate: a keyword rule may not claim a message whose meaning, as read by the semantic
 * classifier (Jev) from the whole sentence and recent conversation, belongs to a different
 * capability.
 *
 * Why this exists: every routing bug found in testing had the same shape. A rule matched a word
 * ("track", "rain", "tomorrow", "balance") or the first word of a sentence and claimed a message that
 * meant something else. A claim cannot be undone downstream, so the message died in the wrong
 * handler.
 *
 * Contract:
 *  - Rules stay as the fast path. They are only stopped when the classifier is confident that the
 *    sentence is about a different capability than the rule's.
 *  - Failing open: no classifier result, a timeout, low confidence, or an unspecific answer
 *    ("general_reasoning" / "other") never blocks a rule, so behaviour without the classifier is unchanged.
 *  - Exact commands ("my reminders", "1", "yes") and messages shorter than three words are never
 *    blocked: there is too little sentence to understand and they are unambiguous by construction.
 *  - A blocked message is not dropped. It continues to the contextual assistant, which reads the
 *    sentence with the conversation and the user's data.
 *  - This module only blocks. It never grants execution authority to the classifier.
 */
import type { JevShadowResult } from '@/lib/typesafe/jev-shadow'

export type RuleCapability =
  | 'reminder_create' | 'reminder_edit' | 'calendar' | 'email' | 'list' | 'memory' | 'nutrition'
  | 'live_info' | 'money' | 'account' | 'contacts' | 'search' | 'search_hint' | 'media' | 'other'

/** What a detectIntent() type or a feature matcher is, in capability terms. */
export const RULE_CAPABILITY: Record<string, RuleCapability> = {
  set_reminder: 'reminder_create',
  edit_reminder: 'reminder_edit',
  connect_calendar: 'calendar',
  read_gmail: 'email', email_action: 'email', connect_gmail: 'email',
  list_show: 'list', list_show_all: 'list', list_add: 'list', list_check: 'list', list_uncheck: 'list', list_clear: 'list',
  save_memory: 'memory',
  nutrition_log: 'nutrition', nutrition_query: 'nutrition',
  weather_live: 'live_info', gold_live: 'live_info', sports_standings: 'live_info', sports_schedule: 'live_info',
  creditiq_cards: 'money', creditiq_link: 'money',
  upgrade_plan: 'account', notify_me: 'account', referral_flow: 'account', set_briefing_time: 'account', dashboard: 'account',
  media_memory: 'media',
  web_search: 'search',
}

/** Classifier intents that count as "meaningfully about" each capability. */
const COMPATIBLE: Record<RuleCapability, ReadonlySet<string>> = {
  reminder_create: new Set(['reminder_mutation', 'watcher', 'memory_context', 'list_task']),
  reminder_edit: new Set(['reminder_read', 'reminder_mutation']),
  calendar: new Set(['calendar_read', 'calendar_mutation', 'account_settings']),
  email: new Set(['email_read', 'email_mutation', 'account_settings']),
  list: new Set(['list_task', 'memory_context']),
  memory: new Set(['memory_context', 'list_task']),
  nutrition: new Set(['nutrition_log']),
  live_info: new Set(['live_info']),
  money: new Set(['money_tracking']),
  account: new Set(['account_settings']),
  contacts: new Set(['memory_context', 'email_mutation', 'reminder_mutation', 'watcher']),
  media: new Set(['memory_context', 'list_task']),
  search: new Set(), // the generic fallback: never blocked
  // A search triggered only by a word like "today" or "price" (medium confidence, no concrete query shape)
  search_hint: new Set(['live_info', 'travel_research', 'browser_action']),
  other: new Set(),
}

/** An intent that says nothing about which capability owns the sentence. */
const UNSPECIFIC = new Set(['general_reasoning', 'other'])

export const GATE_MIN_CONFIDENCE = 0.8
export const GATE_MIN_WORDS = 3

const EXACT_COMMANDS = new Set([
  'hi', 'hello', 'hey', 'start', 'help', 'menu', 'dashboard', 'my dashboard', 'pricing', 'plans', 'upgrade',
  'my reminders', 'show my reminders', 'show reminders', 'pending reminders', 'active reminders', 'list reminders',
  'my cards', 'show my cards', 'my points', 'my expenses', 'expenses today', 'nutrition', 'nutrition today',
  'my tasks', 'tasks', 'show my lists', 'show all lists', 'my notes', 'my day', 'today', 'brief me', 'morning briefing',
])

const wordCount = (text: string) => String(text || '').trim().split(/\s+/).filter(Boolean).length

/**
 * A reply to a question the assistant just asked, or a fixed command: never reinterpreted.
 */
export function isExactCommand(text: string): boolean {
  const lower = String(text || '').trim().toLowerCase().replace(/[.!?]+$/g, '')
  if (!lower) return true
  if (EXACT_COMMANDS.has(lower)) return true
  if (/^(?:[1-9]\d?|y|yes|yep|yeah|no|nope|ok|okay|sure|cancel|stop|done|skip|confirm|approve|never mind|nevermind)$/.test(lower)) return true
  if (/^(?:done|cancel|snooze|skip|complete)\s+\d+\b/.test(lower) || /^mark\s+\d+\s+(?:as\s+)?done$/.test(lower)) return true
  if (/^link\s+creditiq\s+\d{6}$/.test(lower)) return true
  return false
}

export type SemanticSignal = { ok: boolean; intent: string | null; confidence: number; clarify: boolean }

export function semanticSignal(jev: JevShadowResult | null | undefined): SemanticSignal {
  if (!jev?.ok) return { ok: false, intent: null, confidence: 0, clarify: false }
  return {
    ok: true,
    intent: jev.intent?.choice ? String(jev.intent.choice) : null,
    confidence: Number(jev.intent?.confidence || 0),
    clarify: String(jev.decisionReadiness?.choice || '') === 'clarify' && Number(jev.decisionReadiness?.confidence || 0) >= 0.7,
  }
}

export type GateDecision = { allow: boolean; reason: string; jevIntent?: string | null; confidence?: number }

export function ruleMayClaim(params: { text: string; capability: RuleCapability; jev?: JevShadowResult | null }): GateDecision {
  const { text, capability } = params
  if (capability === 'search' || capability === 'other') return { allow: true, reason: 'generic_fallback' }
  if (isExactCommand(text)) return { allow: true, reason: 'exact_command' }
  if (wordCount(text) < GATE_MIN_WORDS) return { allow: true, reason: 'too_short_to_judge' }
  const signal = semanticSignal(params.jev)
  if (!signal.ok || !signal.intent) return { allow: true, reason: 'no_semantic_signal' }
  if (signal.confidence < GATE_MIN_CONFIDENCE) return { allow: true, reason: 'low_confidence', jevIntent: signal.intent, confidence: signal.confidence }
  if (UNSPECIFIC.has(signal.intent)) return { allow: true, reason: 'unspecific', jevIntent: signal.intent, confidence: signal.confidence }
  if (COMPATIBLE[capability].has(signal.intent)) return { allow: true, reason: 'agrees', jevIntent: signal.intent, confidence: signal.confidence }
  return { allow: false, reason: 'sentence_means_something_else', jevIntent: signal.intent, confidence: signal.confidence }
}

/** Convenience for matcher call sites: true when the rule may go ahead. Logs a veto once. */
export function mayClaim(capability: RuleCapability, text: string, jev: JevShadowResult | null | undefined, rule: string = capability): boolean {
  const decision = ruleMayClaim({ text, capability, jev })
  if (!decision.allow) console.info('SEMANTIC_GATE_VETO:', { rule, capability, jevIntent: decision.jevIntent, confidence: decision.confidence })
  return decision.allow
}

export type GatedIntent = { type: string; confidence: 'high' | 'medium' | 'low'; meta?: Record<string, any> }

/**
 * Applies the gate to a detectIntent() result. A blocked rule becomes general_chat so the contextual
 * assistant reads the sentence instead.
 */
export function gateDetectedIntent<T extends GatedIntent>(intent: T, text: string, jev: JevShadowResult | null | undefined): T | (T & { type: 'general_chat' }) {
  // A bare hint word ("today", "price") is a weak claim; a concrete lookup (flight status) is not.
  const capability = intent.type === 'web_search' && intent.confidence === 'medium' && !intent.meta?.flightStatus ? 'search_hint' : RULE_CAPABILITY[intent.type]
  if (!capability) return intent
  if (!mayClaim(capability, text, jev, intent.type)) {
    return { ...intent, type: 'general_chat', confidence: 'low', meta: { ...(intent.meta || {}), semanticVeto: intent.type } } as T & { type: 'general_chat' }
  }
  return intent
}
