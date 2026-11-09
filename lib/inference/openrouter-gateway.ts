// OpenRouter gateway adapter: Phase OR-1 of the Perisclaw/OpenRouter handoff (26 Oct 2026). SYNTHETIC ONLY.
//
// Status: NOT REGISTERED anywhere and NOT ACTIVE. lib/inference/cheap.ts still says "no gateways" and keeps
// its direct Groq/Gemini adapters; nothing in the app imports this module. It exists so the routing policy,
// privacy checks and failure behaviour can be reviewed and tested with mocked HTTP before the owner decides.
//
// Activation needs ALL of: an owner-approved provider-policy change (OR-2), GOGO_OPENROUTER_GATEWAY='approved',
// an OPENROUTER_API_KEY, pinned model + provider allowlist, and wiring by a separate reviewed PR. Missing any of
// these fails closed: the caller's existing primary route runs unchanged (acceptance case OR-K).
//
// Hard limits regardless of configuration:
//   - only public text: 'public_web_research' and 'safe_classification' (no drafts, no owner context);
//   - the whole assembled prompt is scanned (personal data, owner-context tags, approval/execution records);
//   - zdr:true, data_collection:'deny', allow_fallbacks:false, require_parameters:true, provider.only pinned;
//   - no tools, no execution authority: output is text for the caller to verify, never an action or evidence;
//   - opaque random session id (no PII); spend cap; circuit breaker; at most one call per request (no retries).
import { randomUUID } from 'node:crypto'
import { containsProtectedRecord, detectPersonalData, isAllowedTaskClass, ProviderRateLimitedError, type CompletionResult } from './adapter'

export const GATEWAY_TASK_CLASSES = ['public_web_research', 'safe_classification'] as const
export type GatewayTaskClass = typeof GATEWAY_TASK_CLASSES[number]

export const OPENROUTER_ATTRIBUTION = {
  'HTTP-Referer': 'https://askgogo.in',
  'X-OpenRouter-Title': 'AskGogo',
  'X-OpenRouter-Categories': 'personal-agent,general-chat',
} as const

export interface GatewayConfig {
  enabled: boolean
  apiKey: string
  /** Pinned, owner-approved model id. */
  model: string
  /** Pinned, owner-approved provider slugs (provider.only). */
  providers: string[]
  /** Max estimated tokens (input + output) per call; larger requests are refused before any call. */
  maxTokensPerCall: number
  timeoutMs: number
}

/** Reads configuration; any missing or unapproved value disables the gateway. */
export function gatewayConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const providers = String(env.OPENROUTER_PROVIDER_ONLY || '').split(',').map(s => s.trim()).filter(Boolean)
  const model = String(env.OPENROUTER_MODEL || '').trim()
  const apiKey = String(env.OPENROUTER_API_KEY || '').trim()
  return {
    enabled: env.GOGO_OPENROUTER_GATEWAY === 'approved' && Boolean(apiKey) && Boolean(model) && providers.length > 0,
    apiKey, model, providers,
    maxTokensPerCall: Math.min(Math.max(Number(env.OPENROUTER_MAX_TOKENS_PER_CALL) || 4000, 256), 16000),
    timeoutMs: 15_000,
  }
}

export type GatewayRefusal =
  | 'gateway_disabled' | 'class_not_permitted' | 'declared_personal_data' | 'detected_personal_data'
  | 'contains_approval_or_execution_record' | 'owner_context' | 'budget_exceeded' | 'circuit_open'

export type GatewayDecision = { allowed: true; taskClass: GatewayTaskClass } | { allowed: false; reason: GatewayRefusal; detail?: string[] }

const OWNER_CONTEXT = /\b(?:my|our)\s+(?:inbox|emails?|calendar|meetings?|documents?|vault|contacts?|account|orders?|bookings?|tickets?|cards?|bank)\b/i

/** Full-prompt information-flow check. The caller's class and flag are not trusted on their own. */
export function gatewayRoute(input: { taskClass: string; containsPersonalData: boolean; text: string }, config: GatewayConfig, breaker?: CircuitBreaker): GatewayDecision {
  if (!config.enabled) return { allowed: false, reason: 'gateway_disabled' }
  if (!isAllowedTaskClass(input.taskClass) || !(GATEWAY_TASK_CLASSES as readonly string[]).includes(input.taskClass)) return { allowed: false, reason: 'class_not_permitted' }
  if (input.containsPersonalData) return { allowed: false, reason: 'declared_personal_data' }
  if (containsProtectedRecord(input.text)) return { allowed: false, reason: 'contains_approval_or_execution_record' }
  const hits = detectPersonalData(input.text)
  if (hits.length) return { allowed: false, reason: 'detected_personal_data', detail: hits }
  if (OWNER_CONTEXT.test(input.text)) return { allowed: false, reason: 'owner_context' }
  if (estimateTokens(input.text) > config.maxTokensPerCall) return { allowed: false, reason: 'budget_exceeded' }
  if (breaker?.isOpen()) return { allowed: false, reason: 'circuit_open' }
  return { allowed: true, taskClass: input.taskClass as GatewayTaskClass }
}

export function estimateTokens(text: string) { return Math.ceil(String(text || '').length / 4) }

/** Opens after `threshold` consecutive failures and stays open for `coolMs`. */
export class CircuitBreaker {
  private failures = 0
  private openedAt = 0
  constructor(private threshold = 3, private coolMs = 5 * 60_000, private now: () => number = Date.now) {}
  isOpen() {
    if (!this.openedAt) return false
    if (this.now() - this.openedAt >= this.coolMs) { this.openedAt = 0; this.failures = 0; return false }
    return true
  }
  success() { this.failures = 0; this.openedAt = 0 }
  failure() { this.failures++; if (this.failures >= this.threshold) this.openedAt = this.now() }
}

/** The request body sent to OpenRouter (exported for review and tests). */
export function gatewayRequestBody(config: GatewayConfig, prompt: string, sessionId: string, maxOutputTokens: number) {
  return {
    model: config.model,
    session_id: sessionId,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxOutputTokens,
    provider: { only: config.providers, allow_fallbacks: false, zdr: true, data_collection: 'deny', require_parameters: true },
  }
}

/** One call, no retry. Throws typed errors; never returns a fabricated answer. */
export async function gatewayComplete(config: GatewayConfig, prompt: string, opts: { fetchImpl?: typeof fetch; maxOutputTokens?: number; breaker?: CircuitBreaker } = {}): Promise<CompletionResult & { sessionId: string }> {
  const fetchImpl = opts.fetchImpl || fetch
  const maxOutputTokens = Math.min(opts.maxOutputTokens || 800, Math.max(64, config.maxTokensPerCall - estimateTokens(prompt)))
  // Opaque, random per call: nothing derived from the person, chat or prompt (OR-H).
  const sessionId = 'ag-' + randomUUID()
  let res: Response
  try {
    res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...OPENROUTER_ATTRIBUTION },
      body: JSON.stringify(gatewayRequestBody(config, prompt, sessionId, maxOutputTokens)),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch {
    opts.breaker?.failure()
    throw new Error('gateway_unavailable')
  }
  if (res.status === 429) { opts.breaker?.failure(); throw new ProviderRateLimitedError('openrouter') }
  if (!res.ok) { opts.breaker?.failure(); throw new Error(`gateway_http_${res.status}`) }
  let data: any
  try { data = await res.json() } catch { opts.breaker?.failure(); throw new Error('gateway_invalid_response') }
  const text = data?.choices?.[0]?.message?.content
  // A tool call or empty content is not an answer; the gateway is never allowed to act (OR-D, OR-I).
  if (typeof text !== 'string' || !text.trim() || data?.choices?.[0]?.message?.tool_calls?.length) { opts.breaker?.failure(); throw new Error('gateway_invalid_response') }
  opts.breaker?.success()
  return { text: text.trim(), inputTokens: Number(data?.usage?.prompt_tokens) || estimateTokens(prompt), outputTokens: Number(data?.usage?.completion_tokens) || estimateTokens(text), sessionId }
}

/**
 * The only intended entry point once a reviewed PR wires it: try the gateway when policy allows, otherwise
 * (or on any gateway failure) run the caller's existing primary route exactly as before.
 */
export async function completeViaGatewayOrPrimary<T>(
  input: { taskClass: string; containsPersonalData: boolean; text: string },
  primary: () => Promise<T>,
  wrap: (gateway: CompletionResult) => T,
  deps: { config?: GatewayConfig; fetchImpl?: typeof fetch; breaker?: CircuitBreaker } = {},
): Promise<{ value: T; route: 'gateway' | 'primary'; reason?: string }> {
  const config = deps.config || gatewayConfigFromEnv()
  const decision = gatewayRoute(input, config, deps.breaker)
  if (decision.allowed === false) return { value: await primary(), route: 'primary', reason: decision.reason }
  try {
    const result = await gatewayComplete(config, input.text, { fetchImpl: deps.fetchImpl, breaker: deps.breaker })
    return { value: wrap(result), route: 'gateway' }
  } catch (err: any) {
    // Text-only calls have no external effect, so falling back to the primary text route duplicates nothing (OR-F).
    return { value: await primary(), route: 'primary', reason: String(err?.message || 'gateway_failed').slice(0, 60) }
  }
}
