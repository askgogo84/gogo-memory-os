// Cheapest reliable model first for public, non-personal work (owner decision 24 Oct: "always the cheaper or free
// solution, reliable and fast"). Official API keys only, one per provider, no gateways, no key rotation.
// The policy router (./adapter) refuses anything personal; callers fall back to Claude when this returns null.
import {
  type AllowedTaskClass, type ProviderAdapter, type CompletionRequest, ProviderRateLimitedError,
  routeTask, completeWithFallback,
} from './adapter'

const cooling = new Map<string, number>()
const COOL_MS = 60_000

async function postJson(url: string, headers: Record<string, string>, body: unknown, adapterId: string, timeoutMs: number) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  if (res.status === 429) { cooling.set(adapterId, Date.now() + COOL_MS); throw new ProviderRateLimitedError(adapterId) }
  if (!res.ok) {
    // Status and the provider's short error message only (never the prompt or key).
    const detail = await res.text().then(t => { try { return String(JSON.parse(t)?.error?.message || '').slice(0, 160) } catch { return t.slice(0, 120) } }).catch(() => '')
    throw new Error(`${adapterId}_${res.status}:${detail}`)
  }
  return res.json() as Promise<any>
}

function groq(key: string): ProviderAdapter {
  const id = 'groq:gpt-oss-20b'
  return {
    id, provider: 'groq', tier: 'free_tier', access: 'official_api_key',
    // Groq does not train on API inputs; logs are kept up to 30 days (0 with zero data retention on paid plans).
    dataPolicy: { trainsOnInputs: false, humanReview: false, retentionDays: 30 },
    async complete(req: CompletionRequest) {
      const data = await postJson('https://api.groq.com/openai/v1/chat/completions', { authorization: `Bearer ${key}` }, {
        // gpt-oss is a reasoning model: low effort and room for reasoning, or the answer comes back empty.
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b', temperature: 0.2, max_tokens: Math.max(1500, (req.maxOutputTokens || 900) * 2),
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: req.prompt }],
      }, id, 20_000)
      const text = String(data?.choices?.[0]?.message?.content || '').trim()
      if (!text) throw new Error('groq_empty')
      return { text, inputTokens: Number(data?.usage?.prompt_tokens || 0), outputTokens: Number(data?.usage?.completion_tokens || 0) }
    },
  }
}

function gemini(key: string): ProviderAdapter {
  const id = 'gemini:flash-lite'
  return {
    id, provider: 'google', tier: 'free_tier', access: 'official_api_key',
    // The free tier may use inputs to improve Google products: the router keeps it to public-only classes.
    dataPolicy: { trainsOnInputs: true, humanReview: true, retentionDays: 55 },
    async complete(req: CompletionRequest) {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
      const data = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: Math.max(1024, req.maxOutputTokens || 900) },
      }, id, 20_000)
      const text = String((data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('')).trim()
      if (!text) throw new Error('gemini_empty')
      return { text, inputTokens: Number(data?.usageMetadata?.promptTokenCount || 0), outputTokens: Number(data?.usageMetadata?.candidatesTokenCount || 0) }
    },
  }
}

/** Providers in the owner-approved order, from whatever keys are configured. */
export function cheapProviders(env: Record<string, string | undefined> = process.env): ProviderAdapter[] {
  const list: ProviderAdapter[] = []
  if (env.GROQ_API_KEY) list.push(groq(env.GROQ_API_KEY))
  if (env.GEMINI_API_KEY) list.push(gemini(env.GEMINI_API_KEY))
  return list
}

/**
 * Runs a public task on the cheapest available provider. `scanText` is what the router checks for personal data
 * (the person's own words); public page text passed only in `prompt` is public by definition.
 * Returns null when no provider is configured, the task is refused, or every provider failed.
 */
export async function cheapComplete(p: { taskClass: AllowedTaskClass; prompt: string; scanText: string; maxTokens?: number; providers?: ProviderAdapter[] }) {
  const providers = p.providers || cheapProviders()
  if (!providers.length) return null
  const now = Date.now()
  const coolingDown = new Set([...cooling].filter(([, until]) => until > now).map(([id]) => id))
  const decision = routeTask({ taskClass: p.taskClass, containsPersonalData: false, text: p.scanText, providers, coolingDown })
  if (decision.allowed !== true) { console.log('CHEAP_INFERENCE_REFUSED:', JSON.stringify({ taskClass: p.taskClass, reason: (decision as any).reason })); return null }
  const started = Date.now()
  try {
    const out = await completeWithFallback({ ...decision, chain: decision.chain.map(a => ({ ...a, complete: (req: CompletionRequest) => a.complete({ ...req, maxOutputTokens: p.maxTokens }) })) }, p.prompt)
    console.log('CHEAP_INFERENCE:', JSON.stringify({ taskClass: p.taskClass, adapter: out.adapterId, ms: Date.now() - started, in: out.result.inputTokens, out: out.result.outputTokens }))
    return out.result.text
  } catch (err: any) {
    console.error('CHEAP_INFERENCE_FAILED:', JSON.stringify({ taskClass: p.taskClass, attempted: err?.attempted || [], errors: err?.errors || [] }))
    return null
  }
}
