// Addendum 3 (10 Nov): Meta Muse Ember as an OPTIONAL low-cost candidate. Deliberately NOT registered in
// cheapProviders() and not called from any live route. Verified 10 Nov from dev.meta.ai/docs: base
// https://api.meta.ai/v1, Bearer auth, model id muse-ember-1.0, chat completions + responses endpoints, tool calling
// and structured output listed as supported, reasoning effort minimal…max (default max). NOT verified: data
// retention / training terms (not stated in the docs), rate limits, the exact reasoning parameter name on chat
// completions, usage field names. Until the data terms are confirmed in writing this adapter takes only committed
// synthetic fixtures or public text, never an owner's data.
import type { ProviderAdapter, ProviderDataPolicy, CompletionRequest } from './adapter'

export const MUSE_EMBER_MODEL = 'muse-ember-1.0'
export const MUSE_EMBER_ENDPOINT = 'https://api.meta.ai/v1/chat/completions'
/** USD per million tokens for prompts up to 200K input tokens (research.meta.ai/blog/muse-ember, 9 Nov 2026). */
export const MUSE_EMBER_PRICE = { input: 0.10, cachedInput: 0.004, output: 0.50, longContextOver: 200_000, longInput: 0.30, longOutput: 1.50 } as const

export function estimateMuseEmberUsd(inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
  const long = inputTokens > MUSE_EMBER_PRICE.longContextOver
  const fresh = Math.max(0, inputTokens - cachedInputTokens)
  const usd = (fresh * (long ? MUSE_EMBER_PRICE.longInput : MUSE_EMBER_PRICE.input)
    + cachedInputTokens * MUSE_EMBER_PRICE.cachedInput * (long ? 3 : 1)
    + outputTokens * (long ? MUSE_EMBER_PRICE.longOutput : MUSE_EMBER_PRICE.output)) / 1_000_000
  return Math.round(usd * 1e8) / 1e8
}

export type MuseEmberEvaluationOptions = {
  apiKey?: string
  /** Explicit opt-in by the caller; never derived from an environment variable. */
  enabled?: boolean
  /** Must be filled from Meta's current written terms before any real call. Unknown retention → no adapter. */
  approvedPolicy?: ProviderDataPolicy
  fetchImpl?: typeof fetch
  /** 'minimal' | 'low' | … Default 'low': the API default is 'max', which would defeat the cost purpose. */
  reasoningEffort?: string
}

export function museEmberRequestBody(prompt: string, maxOutputTokens: number, reasoningEffort = 'low') {
  return { model: MUSE_EMBER_MODEL, messages: [{ role: 'user', content: prompt }], reasoning_effort: reasoningEffort,
    max_tokens: Math.min(Math.max(maxOutputTokens || 600, 64), 4096), stream: false }
}

export function makeMuseEmberEvaluationAdapter(options: MuseEmberEvaluationOptions): ProviderAdapter | null {
  if (!options.enabled || process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || !options.apiKey
    || !options.approvedPolicy || options.approvedPolicy.retentionDays === null) return null
  const fetchImpl = options.fetchImpl || fetch
  const key = options.apiKey
  return {
    id: 'meta:muse-ember-1.0-eval', provider: 'meta', tier: 'cheap_paid', access: 'official_api_key', dataPolicy: options.approvedPolicy,
    async complete(req: CompletionRequest) {
      if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') throw new Error('muse_ember_eval_production_denied')
      if (req.taskClass !== 'public_web_research' && req.taskClass !== 'safe_classification') throw new Error('muse_ember_eval_class_denied')
      if (!req.prompt.trim()) throw new Error('muse_ember_eval_empty_prompt')
      const { detectPersonalData, containsProtectedRecord } = await import('./adapter')
      if (detectPersonalData(req.prompt).length || containsProtectedRecord(req.prompt)) throw new Error('muse_ember_eval_sensitive_payload')
      return callMuseEmber(fetchImpl, key, req.prompt, req.maxOutputTokens || 600, options.reasoningEffort)
    },
  }
}

export async function callMuseEmber(fetchImpl: typeof fetch, key: string, prompt: string, maxOutputTokens: number, reasoningEffort?: string) {
  const t0 = Date.now()
  const res = await fetchImpl(MUSE_EMBER_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(museEmberRequestBody(prompt, maxOutputTokens, reasoningEffort)), signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`muse_ember_eval_http_${res.status}`)
  const payload: any = await res.json()
  const content = payload?.choices?.[0]?.message?.content
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) throw new Error('muse_ember_eval_empty_output')
  return { text, inputTokens: Number(payload?.usage?.prompt_tokens || 0), outputTokens: Number(payload?.usage?.completion_tokens || 0), ms: Date.now() - t0 }
}
