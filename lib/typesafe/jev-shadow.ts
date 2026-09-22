import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
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
}) {
  const safeText = redactSecretShapedText(String(params.text || '').slice(0, 1800))
  const safeSummary = redactSecretShapedText(String(params.focusSummary || '').slice(0, 500))
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
      },
    },
    questions: buildJevShadowQuestions(),
  }
}

export function parseJevShadowResponse(raw: any, latencyMs = 0): JevShadowResult {
  const answers = raw?.answers || {}
  return {
    ok: true,
    version: JEV_SHADOW_VERSION,
    model: String(raw?.model || JEV_SHADOW_MODEL),
    latencyMs,
    intent: parseChoice(answers.intent),
    actionMode: parseChoice(answers.action_mode),
    referentKind: parseChoice(answers.referent_kind),
  }
}

export async function runJevShadow(params: {
  text: string
  currentCapability: string
  currentActionFamily: string
  needsContext: boolean
  focusKind: string
  focusSummary?: string | null
  timeoutMs?: number
}): Promise<JevShadowResult | null> {
  const apiKey = String(process.env.TYPESAFE_API_KEY || '').trim()
  if (!apiKey) return null

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
        error: `typesafe_http_${response.status}`,
      }
    }
    return parseJevShadowResponse(body, Date.now() - started)
  } catch (err: any) {
    return {
      ok: false,
      version: JEV_SHADOW_VERSION,
      model: JEV_SHADOW_MODEL,
      latencyMs: Date.now() - started,
      intent: emptyChoice(),
      actionMode: emptyChoice(),
      referentKind: emptyChoice(),
      error: err?.name === 'AbortError' ? 'typesafe_timeout' : String(err?.message || 'typesafe_error').slice(0, 120),
    }
  } finally {
    clearTimeout(timer)
  }
}
