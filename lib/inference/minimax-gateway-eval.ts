// Isolated Vercel AI Gateway MiniMax evaluation. NOT registered in cheapProviders()
// or any production route. No model can be switched on by setting environment variables alone.
import type { CompletionRequest, ProviderAdapter, ProviderDataPolicy } from './adapter'
import { containsProtectedRecord, detectPersonalData } from './adapter'

export const MINIMAX_GATEWAY_EVAL_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/chat/completions'
export const MINIMAX_GATEWAY_EVAL_MODEL = 'minimax/minimax-m3.1-flash'
export const MINIMAX_GATEWAY_PINNED_PROVIDER = 'minimax'

export type MiniMaxGatewayEvaluationOptions = {
  apiKey?: string
  /** Explicit synthetic/public-only test opt-in; never read an env flag here. */
  enabled?: boolean
  /** Current gateway + serving-provider policy must be reviewed before evaluation. */
  approvedPolicy?: ProviderDataPolicy
  fetchImpl?: typeof fetch
}

/** Strict single-provider route: gateway 'order' alone permits unwanted fallback. */
export function makeMiniMaxGatewayEvaluationAdapter(
  options: MiniMaxGatewayEvaluationOptions,
): ProviderAdapter | null {
  if (!options.enabled || process.env.NODE_ENV === 'production' || !options.apiKey ||
      !options.approvedPolicy || options.approvedPolicy.retentionDays === null) return null
  const fetchImpl = options.fetchImpl || fetch
  const key = options.apiKey
  return {
    id: 'vercel:minimax-m3.1-flash-eval', provider: 'vercel-minimax', tier: 'cheap_paid',
    access: 'official_api_key', dataPolicy: options.approvedPolicy,
    async complete(req: CompletionRequest) {
      if (process.env.NODE_ENV === 'production') throw new Error('gateway_eval_production_denied')
      if (req.taskClass !== 'public_web_research' && req.taskClass !== 'morning_intel_public_summary')
        throw new Error('gateway_eval_class_denied')
      if (!req.prompt.trim() || containsProtectedRecord(req.prompt) || detectPersonalData(req.prompt).length)
        throw new Error('gateway_eval_sensitive_or_empty_payload')
      const response = await fetchImpl(MINIMAX_GATEWAY_EVAL_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MINIMAX_GATEWAY_EVAL_MODEL,
          messages: [{ role: 'user', content: req.prompt }],
          stream: false,
          reasoning: { effort: 'low' },
          max_tokens: Math.min(Math.max(req.maxOutputTokens || 1200, 256), 4096),
          providerOptions: { gateway: { only: [MINIMAX_GATEWAY_PINNED_PROVIDER] } },
        }),
        signal: AbortSignal.timeout(30_000),
      })
      // Do not include provider errors/responses in log text: may contain private fragments.
      if (!response.ok) throw new Error(`gateway_eval_http_${response.status}`)
      const data: any = await response.json()
      const content = data?.choices?.[0]?.message?.content
      const answer = typeof content === 'string' ? content.trim() : ''
      if (!answer) throw new Error('gateway_eval_empty_output')
      return {
        text: answer,
        inputTokens: Number(data?.usage?.prompt_tokens || 0),
        outputTokens: Number(data?.usage?.completion_tokens || 0),
      }
    },
  }
}

/** Estimates only uncached text tokens; not a promise about pricing or successful tasks. */
export function estimateMiniMaxUsd(inputTokens: number, outputTokens: number, inputPerMillionUsd: number, outputPerMillionUsd: number): number {
  if (![inputTokens, outputTokens, inputPerMillionUsd, outputPerMillionUsd].every(v => Number.isFinite(v) && v >= 0))
    throw new Error('cost_inputs_invalid')
  return (inputTokens * inputPerMillionUsd + outputTokens * outputPerMillionUsd) / 1_000_000
}
