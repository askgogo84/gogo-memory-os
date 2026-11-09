import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { buildJevShadowQuestions, JEV_SHADOW_MODEL, JEV_SHADOW_VERSION } from './questions'
import type { GuardedRoutingDecision } from '@/lib/agent/decision-learning'

const KEYWORD_SECRET = /\b(?:pass(?:word|wd|code)|pin|otp|one[\s-]?time[\s-]?password|cvv|cvc|card\s*number|account\s*number|api[\s_-]?key|secret\s*key|security\s*code)\b/i

/** A turn that is itself a secret: an OTP, password, PIN, card or account number. Pure. */
export function keywordSecretTurn(text: string): boolean {
  const t = String(text || '')
  return KEYWORD_SECRET.test(t) || /\b(?:\d[ -]?){12,19}\b/.test(t) || /^\s*\d{4,8}\s*$/.test(t)
}

/** Labelled secrets redacted, then every long digit run and email masked, so the rest of the sentence still goes. Pure. */
export function scrubForTypeSafe(text: string): string {
  return redactSecretShapedText(String(text || ''))
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
}

export type JevShadowChoice = {
  choice: string | null
  confidence: number | null
  probabilities: Record<string, number>
}

export type JevShadowResult = {
  ok: boolean
  attempted?: boolean
  version: string
  model: string
  latencyMs: number
  intent: JevShadowChoice
  actionMode: JevShadowChoice
  referentKind: JevShadowChoice
  attentionState: JevShadowChoice
  decisionReadiness: JevShadowChoice
  contextual: boolean
  usage?: { inputTokens: number | null; outputTokens: number | null }
  error?: string
}

function emptyChoice(): JevShadowChoice {
  return { choice: null, confidence: null, probabilities: {} }
}

function parseChoice(value: any): JevShadowChoice {
  if (!value || value.type !== 'choice') return emptyChoice()
  const probs = value.probabilities && typeof value.probabilities === 'object' ? value.probabilities : {}
  return {
    choice: typeof value.choice === 'string' ? value.choice : null,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null,
    probabilities: Object.fromEntries(Object.entries(probs).filter(([,v]) => Number.isFinite(Number(v))).map(([k,v]) => [k, Number(v)])),
  }
}

export function buildJevShadowRequest(params: {
  text: string
  currentCapability: string
  currentActionFamily: string
  needsContext: boolean
  focusKind: string
  focusSummary?: string | null
  recentContext?: string | null
  learnedRouting?: GuardedRoutingDecision | null
}) {
  const rawText = String(params.text || '').slice(0, 1200)
  const rawSummary = String(params.focusSummary || '').slice(0, 320)
  // The recent conversation always goes with the sentence: whether a message needs context is not a
  // judgement a keyword list can make ("track divya flight" has no pronoun and still depends on who Divya is).
  const rawRecent = String(params.recentContext || '').slice(0, 700)
  const safeText = scrubForTypeSafe(rawText)
  const safeSummary = scrubForTypeSafe(rawSummary)
  const safeRecent = scrubForTypeSafe(rawRecent)
  // Only approved evidence crosses the model boundary. A rejected preference
  // must never be included, even with a label asking the model to ignore it.
  const learned = params.learnedRouting
  const safeLearned = learned?.useLearned && learned.handler &&
    /^[a-z][a-z0-9_-]{0,99}$/.test(learned.handler) &&
    Number.isFinite(learned.confidence) && learned.confidence >= 0.82 && learned.confidence <= 1
    ? { preferred_handler: learned.handler, confidence: learned.confidence, authority: 'first_refusal_only' }
    : null
  return {
    model: JEV_SHADOW_MODEL,
    state: {
      user_message: safeText,
      ...(safeLearned ? { learned_routing: safeLearned } : {}),
      current_router: {
        capability: String(params.currentCapability || 'unknown').slice(0, 80),
        action_family: String(params.currentActionFamily || 'unknown').slice(0, 80),
      },
      context: {
        message_looks_contextual: Boolean(params.needsContext),
        current_focus_kind: String(params.focusKind || 'none').slice(0, 80),
        current_focus_summary: safeSummary || null,
        recent_conversation: safeRecent || null,
      },
    },
    questions: buildJevShadowQuestions({needsContext:params.needsContext}),
  }
}

function validChoiceAnswer(value: any) {
  return Boolean(value && value.type === 'choice' && typeof value.choice === 'string' && value.choice.trim() && Number.isFinite(Number(value.confidence)) && value.probabilities && typeof value.probabilities === 'object')
}

export function parseJevShadowResponse(raw: any, latencyMs = 0, contextual = false): JevShadowResult {
  const answers = raw?.answers || {}
  const coreValid = validChoiceAnswer(answers.intent) && validChoiceAnswer(answers.action_mode) && validChoiceAnswer(answers.attention_state) && validChoiceAnswer(answers.decision_readiness)
  const contextualValid = !contextual || validChoiceAnswer(answers.referent_kind)
  const valid = coreValid && contextualValid
  const usage = {
    inputTokens: typeof raw?.usage?.input_tokens==='number' && Number.isFinite(raw.usage.input_tokens) && raw.usage.input_tokens>=0 ? raw.usage.input_tokens : null,
    outputTokens: typeof raw?.usage?.output_tokens==='number' && Number.isFinite(raw.usage.output_tokens) && raw.usage.output_tokens>=0 ? raw.usage.output_tokens : null,
  }
  if (!valid) {
    return {
      ok: false,
      attempted: true,
      version: JEV_SHADOW_VERSION,
      model: String(raw?.model || JEV_SHADOW_MODEL),
      latencyMs,
      intent: emptyChoice(),
      actionMode: emptyChoice(),
      referentKind: emptyChoice(),
      attentionState: emptyChoice(),
      decisionReadiness: emptyChoice(),
      contextual,
      usage,
      error: 'typesafe_malformed_response',
    }
  }
  return {
    ok: true,
    attempted: true,
    version: JEV_SHADOW_VERSION,
    model: String(raw?.model || JEV_SHADOW_MODEL),
    latencyMs,
    intent: parseChoice(answers.intent),
    actionMode: parseChoice(answers.action_mode),
    referentKind: contextual ? parseChoice(answers.referent_kind) : {choice:'none',confidence:1,probabilities:{none:1}},
    attentionState: parseChoice(answers.attention_state),
    decisionReadiness: parseChoice(answers.decision_readiness),
    contextual,
    usage,
  }
}

export async function runJevShadow(params: {
  text: string
  currentCapability: string
  currentActionFamily: string
  needsContext: boolean
  focusKind: string
  focusSummary?: string | null
  recentContext?: string | null
  learnedRouting?: GuardedRoutingDecision | null
  timeoutMs?: number
}): Promise<JevShadowResult | null> {
  const apiKey = String(process.env.TYPESAFE_API_KEY || '').trim()
  if (!apiKey) return null

  // 29 Oct live: 9 of 15 turns skipped JEV because the recent chat held a phone number or the word "passport".
  // Only a message that is itself a secret (OTP, password, card or account number) is withheld; anything else
  // goes with its numbers and emails masked.
  if (keywordSecretTurn(String(params.text || ''))) {
    return {
      ok: false,
      attempted: false,
      version: JEV_SHADOW_VERSION,
      model: JEV_SHADOW_MODEL,
      latencyMs: 0,
      intent: emptyChoice(),
      actionMode: emptyChoice(),
      referentKind: emptyChoice(),
      attentionState: emptyChoice(),
      decisionReadiness: emptyChoice(),
      contextual: Boolean(params.needsContext),
      usage: { inputTokens: null, outputTokens: null },
      error: 'typesafe_sensitive_state_withheld',
    }
  }

  const timeoutMs = Math.max(50, Math.min(Number(params.timeoutMs || 350), 1500))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildJevShadowRequest(params)),
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        ok: false,
      attempted: true,
        version: JEV_SHADOW_VERSION,
        model: JEV_SHADOW_MODEL,
        latencyMs: Date.now() - started,
        intent: emptyChoice(),
        actionMode: emptyChoice(),
        referentKind: emptyChoice(),
        attentionState: emptyChoice(),
        decisionReadiness: emptyChoice(),
        contextual: Boolean(params.needsContext),
        usage: { inputTokens: null, outputTokens: null },
        error: `typesafe_http_${response.status}`,
      }
    }
    return parseJevShadowResponse(body, Date.now() - started, Boolean(params.needsContext))
  } catch (err: any) {
    return {
      ok: false,
      attempted: true,
      version: JEV_SHADOW_VERSION,
      model: JEV_SHADOW_MODEL,
      latencyMs: Date.now() - started,
      intent: emptyChoice(),
      actionMode: emptyChoice(),
      referentKind: emptyChoice(),
      attentionState: emptyChoice(),
      decisionReadiness: emptyChoice(),
      contextual: Boolean(params.needsContext),
      usage: { inputTokens: null, outputTokens: null },
      error: err?.name === 'AbortError' ? 'typesafe_timeout' : String(err?.message || 'typesafe_error').slice(0, 120),
    }
  } finally {
    clearTimeout(timer)
  }
}
