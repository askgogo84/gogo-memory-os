// Deliberately NOT registered in cheapProviders() or called from live routes.
// This is a bounded, synthetic/public-only provider evaluation adapter.
import type { ProviderAdapter, ProviderDataPolicy, CompletionRequest } from './adapter'

export const MINIMAX_EVAL_MODEL = 'MiniMax-M3.1-Flash'
export const MINIMAX_EVAL_ENDPOINT = 'https://api.minimax.io/v1/chat/completions'

export type MiniMaxEvaluationOptions = {
  apiKey?: string
  /** Explicit opt-in; never derived from an environment variable. */
  enabled?: boolean
  /** Must be confirmed from current MiniMax terms before real calls. */
  approvedPolicy?: ProviderDataPolicy
  fetchImpl?: typeof fetch
}

// Non-personal public research only. Sensitive memory, Make documents, tools,
// approvals, Gmail, Calendar, Vault and SecondBrain stay on the trusted route.
export function makeMiniMaxEvaluationAdapter(options: MiniMaxEvaluationOptions): ProviderAdapter | null {
  if (!options.enabled || process.env.NODE_ENV === 'production' || !options.apiKey ||
      !options.approvedPolicy || options.approvedPolicy.retentionDays === null) return null
  const fetchImpl = options.fetchImpl || fetch
  const key = options.apiKey
  return {
    id: 'minimax:m3.1-flash-eval', provider: 'minimax', tier: 'cheap_paid',
    access: 'official_api_key', dataPolicy: options.approvedPolicy,
    async complete(req: CompletionRequest) {
      if (process.env.NODE_ENV === 'production') throw new Error('minimax_eval_production_denied')
      if (req.taskClass !== 'public_web_research' && req.taskClass !== 'morning_intel_public_summary')
        throw new Error('minimax_eval_class_denied')
      // Caller must ALSO verify that all context is public; this adapter accepts no private contexts.
      if (!req.prompt.trim()) throw new Error('minimax_eval_empty_prompt')
      const { detectPersonalData, containsProtectedRecord } = await import('./adapter')
      if (detectPersonalData(req.prompt).length || containsProtectedRecord(req.prompt))
        throw new Error('minimax_eval_sensitive_payload')
      const res = await fetchImpl(MINIMAX_EVAL_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MINIMAX_EVAL_MODEL,
          messages: [{ role: 'user', content: req.prompt }],
          reasoning_effort: 'low',
          max_tokens: Math.min(Math.max(req.maxOutputTokens || 1200, 256), 4096),
          stream: false }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`minimax_eval_http_${res.status}`)
      const payload: any = await res.json()
      const content = payload?.choices?.[0]?.message?.content
      const output = typeof content === 'string' ? content.trim() : ''
      if (!output) throw new Error('minimax_eval_empty_output')
      return { text: output,
        inputTokens: Number(payload?.usage?.prompt_tokens || 0),
        outputTokens: Number(payload?.usage?.completion_tokens || 0) }
    },
  }
}
