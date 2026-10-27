// Direct OpenAI Responses API adapter for the gpt-6.1 family (Terra evaluation, issue #274, 27 Oct 2026).
// EVALUATION ONLY. Status: NOT IMPORTED by any route, worker or library module; only the offline/live benchmark
// (scripts/eval/terra-benchmark.mts) and its verifier use it.
//
// Enabled only when ALL of these hold; anything missing fails closed (the caller keeps its existing route):
//   - GOGO_TERRA_DIRECT === 'approved' (the literal string),
//   - TERRA_OPENAI_API_KEY is set (a dedicated key, so evaluation spend is separable from production),
//   - TERRA_MODEL is pinned to one of PINNED_TERRA_FAMILY.
//
// Hard limits regardless of configuration:
//   - text in, text out. No tools are offered; a response that contains a tool/function/computer call is refused;
//   - store:false (the evaluation does not ask OpenAI to keep the response for later retrieval);
//   - exactly one HTTP call per invocation. No retry on any path, so an uncertain outcome is never repeated;
//   - the model id is read from the response and must match the pinned model; usage tokens and latency are recorded;
//   - the output is advisory text. It never carries approval, owner/account or Sentinel authority
//     (see lib/inference/model-authority.ts for the enforcement contract the benchmark applies).

/** Owner-supplied API ids. 'gpt-6.1-terra' is from the vendor summary; luna/sol are ASSUMED by analogy. */
export const PINNED_TERRA_FAMILY = ['gpt-6.1-terra', 'gpt-6.1-luna', 'gpt-6.1-sol'] as const
export type TerraFamilyModel = typeof PINNED_TERRA_FAMILY[number]

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export interface TerraConfig {
  enabled: boolean
  apiKey: string
  model: TerraFamilyModel | ''
  timeoutMs: number
  maxOutputTokens: number
}

export function isPinnedTerraModel(model: string): model is TerraFamilyModel {
  return (PINNED_TERRA_FAMILY as readonly string[]).includes(model)
}

/** Reads configuration; any missing or unapproved value disables the adapter. */
export function terraConfigFromEnv(env: Record<string, string | undefined> = process.env): TerraConfig {
  const apiKey = String(env.TERRA_OPENAI_API_KEY || '').trim()
  const rawModel = String(env.TERRA_MODEL || '').trim()
  const model = isPinnedTerraModel(rawModel) ? rawModel : ''
  return {
    enabled: env.GOGO_TERRA_DIRECT === 'approved' && Boolean(apiKey) && Boolean(model),
    apiKey,
    model,
    timeoutMs: Math.min(Math.max(Number(env.TERRA_TIMEOUT_MS) || 30_000, 1_000), 120_000),
    maxOutputTokens: Math.min(Math.max(Number(env.TERRA_MAX_OUTPUT_TOKENS) || 1_200, 64), 8_000),
  }
}

export interface TerraResult {
  text: string
  /** Model id exactly as the response reported it (not the requested id). */
  model: string
  responseId: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
}

export type TerraErrorCode =
  | 'terra_disabled' | 'terra_unavailable' | 'terra_timeout' | 'terra_rate_limited' | 'terra_http_error'
  | 'terra_invalid_response' | 'terra_tool_call_refused' | 'terra_incomplete' | 'terra_model_mismatch'

export class TerraError extends Error {
  constructor(readonly code: TerraErrorCode, readonly latencyMs: number, readonly detail?: string) { super(code) }
}

/** The exact request body (exported for review and tests). No tools, no storage. */
export function terraRequestBody(model: string, input: { instructions?: string; prompt: string }, maxOutputTokens: number) {
  return {
    model,
    ...(input.instructions ? { instructions: input.instructions } : {}),
    input: [{ role: 'user', content: input.prompt }],
    max_output_tokens: maxOutputTokens,
    store: false,
  }
}

const ACTION_ITEM = /(?:^|_)(?:function_call|tool_call|computer_call|custom_tool_call|mcp_call|local_shell_call|web_search_call|file_search_call|code_interpreter_call|image_generation_call)$/

function outputText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text
  const parts: string[] = []
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'message') continue
    for (const c of Array.isArray(item.content) ? item.content : []) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text)
  }
  return parts.join('')
}

/** True when `reported` is exactly `pinned` or `pinned` plus a dated snapshot suffix (-YYYY-MM-DD). */
export function reportedModelMatches(pinned: string, reported: string): boolean {
  if (!pinned || !reported) return false
  if (reported === pinned) return true
  return reported.startsWith(pinned) && /^-\d{4}-\d{2}-\d{2}$/.test(reported.slice(pinned.length))
}

const measured = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/**
 * One Responses API call, no retry. `model` may override config.model only with another pinned family id
 * (the benchmark compares Terra, Luna and Sol through the same adapter). Throws TerraError; never fabricates text.
 */
export async function terraComplete(
  config: TerraConfig,
  input: { instructions?: string; prompt: string; model?: string },
  opts: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<TerraResult> {
  const now = opts.now || Date.now
  const started = now()
  const elapsed = () => Math.max(0, now() - started)
  const model = input.model || config.model
  if (!config.enabled || !model || !isPinnedTerraModel(model)) throw new TerraError('terra_disabled', 0)
  const fetchImpl = opts.fetchImpl || fetch
  let res: Response
  try {
    res = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(terraRequestBody(model, input, config.maxOutputTokens)),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (err: any) {
    const name = String(err?.name || '')
    throw new TerraError(name === 'TimeoutError' || name === 'AbortError' ? 'terra_timeout' : 'terra_unavailable', elapsed())
  }
  if (res.status === 429) throw new TerraError('terra_rate_limited', elapsed(), 'rate_limited:openai-terra')
  if (!res.ok) throw new TerraError('terra_http_error', elapsed(), `http_${res.status}`)
  let data: any
  try { data = await res.json() } catch { throw new TerraError('terra_invalid_response', elapsed()) }
  const latencyMs = elapsed()
  const items: any[] = Array.isArray(data?.output) ? data.output : []
  // A tool/function/computer call is an attempted action, not an answer. The evaluation never lets it through.
  if (items.some(i => ACTION_ITEM.test(String(i?.type || '')))) throw new TerraError('terra_tool_call_refused', latencyMs)
  if (data?.status && data.status !== 'completed') throw new TerraError('terra_incomplete', latencyMs, String(data?.incomplete_details?.reason || data.status).slice(0, 60))
  const reported = String(data?.model || '')
  // Providers report dated snapshots (e.g. gpt-6.1-terra-2026-10-01); anything else is refused, including a sibling
  // such as gpt-6.1-terra-mini that merely shares the prefix.
  if (!reportedModelMatches(model, reported)) throw new TerraError('terra_model_mismatch', latencyMs, reported.slice(0, 80))
  const text = outputText(data).trim()
  if (!text) throw new TerraError('terra_invalid_response', latencyMs)
  return {
    text,
    model: reported,
    responseId: typeof data?.id === 'string' ? data.id : null,
    inputTokens: measured(data?.usage?.input_tokens),
    outputTokens: measured(data?.usage?.output_tokens),
    latencyMs,
  }
}
