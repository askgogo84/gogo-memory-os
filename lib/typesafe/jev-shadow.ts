import { isSecretShapedMemory, redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { buildJevShadowQuestions, JEV_SHADOW_MODEL, JEV_SHADOW_VERSION } from './questions'

export type JevShadowChoice = {
  choice: string | null
  confidence: number | null
  probabilities: Record<string, number>
}

export type JevShadowResult = {
  ok: boolean
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
}) {
  const rawText = String(params.text || '').slice(0, 1200)
  const rawSummary = String(params.focusSummary || '').slice(0, 320)
  const rawRecent = params.needsContext ? String(params.recentContext || '').slice(0, 700) : ''
  const safeText = isSecretShapedMemory(rawText) ? '[sensitive turn withheld from TypeSafe]' : redactSecretShapedText(rawText)
  const safeSummary = isSecretShapedMemory(rawSummary) ? '[sensitive context withheld from TypeSafe]' : redactSecretShapedText(rawSummary)
  const safeRecent = isSecretShapedMemory(rawRecent) ? '[sensitive recent context withheld from TypeSafe]' : redactSecretShapedText(rawRecent)
  return {
    model: JEV_SHADOW_MODEL,
    state: {
      user_message: safeText,
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
  const coreValid = validChoiceAnswer(answers.intent) && validChoiceAnswer(answers.action_mode) && validChoiceAnswer(answers.attention_state)
  const contextualValid = !contextual || (validChoiceAnswer(answers.referent_kind) && validChoiceAnswer(answers.decision_readiness))
  const valid = coreValid && contextualValid
  const usage = {
    inputTokens: Number.isFinite(Number(raw?.usage?.input_tokens)) ? Number(raw.usage.input_tokens) : null,
    outputTokens: Number.isFinite(Number(raw?.usage?.output_tokens)) ? Number(raw.usage.output_tokens) : null,
  }
  if (!valid) {
    return {
      ok: false,
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
    version: JEV_SHADOW_VERSION,
    model: String(raw?.model || JEV_SHADOW_MODEL),
    latencyMs,
    intent: parseChoice(answers.intent),
    actionMode: parseChoice(answers.action_mode),
    referentKind: contextual ? parseChoice(answers.referent_kind) : {choice:'none',confidence:1,probabilities:{none:1}},
    attentionState: parseChoice(answers.attention_state),
    decisionReadiness: contextual ? parseChoice(answers.decision_readiness) : {choice:'ready',confidence:1,probabilities:{ready:1}},
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
  timeoutMs?: number
}): Promise<JevShadowResult | null> {
  const apiKey = String(process.env.TYPESAFE_API_KEY || '').trim()
  if (!apiKey) return null

  if (isSecretShapedMemory(String(params.text || '')) || isSecretShapedMemory(String(params.focusSummary || '')) || (params.needsContext && isSecretShapedMemory(String(params.recentContext || '')))) {
    return {
      ok: false,
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
        version: JEV_SHADOW_VERSION,
        model: JEV_SHADOW_MODEL,
        latencyMs: Date.now() - started,
        intent: emptyChoice(),
        actionMode: emptyChoice(),
        referentKind: emptyChoice(),
        attentionState: emptyChoice(),
        decisionReadiness: emptyChoice(),
        usage: { inputTokens: null, outputTokens: null },
        error: `typesafe_http_${response.status}`,
      }
    }
    return parseJevShadowResponse(body, Date.now() - started, Boolean(params.needsContext))
  } catch (err: any) {
    return {
      ok: false,
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
