// Inception Labs Mercury (diffusion LLM): OpenAI-compatible chat completions, very low latency.
// Used only for read-only text synthesis (web answers). Off unless INCEPTION_API_KEY is set and
// MERCURY_WEB_ANSWERS is not "0". Any error, timeout or empty reply returns null so the caller
// falls back to Claude; it never throws.

const BASE_URL = 'https://api.inceptionlabs.ai/v1/chat/completions'
export const MERCURY_TIMEOUT_MS = 8000

export function mercuryModel(): string {
  return String(process.env.MERCURY_MODEL || 'mercury-3').trim()
}

export function mercuryWebAnswersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(String(env.INCEPTION_API_KEY || '').trim()) && String(env.MERCURY_WEB_ANSWERS ?? '1').trim() !== '0'
}

export type MercuryResult = { text: string; ms: number; model: string } | null

export async function askMercury(
  prompt: string,
  opts: { maxTokens?: number; fetchImpl?: typeof fetch; timeoutMs?: number; label?: string } = {},
): Promise<MercuryResult> {
  const key = String(process.env.INCEPTION_API_KEY || '').trim()
  if (!key) return null
  const model = mercuryModel()
  const started = Date.now()
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? MERCURY_TIMEOUT_MS) : null
  try {
    const res = await (opts.fetchImpl || fetch)(BASE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: opts.maxTokens ?? 1200,
        temperature: 0.3,
      }),
      signal: controller?.signal,
    } as any)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('MERCURY_FAILED:', JSON.stringify({ label: opts.label || 'chat', status: res.status, model, body: body.slice(0, 200) }))
      return null
    }
    const data: any = await res.json()
    const text = String(data?.choices?.[0]?.message?.content || '').trim()
    const ms = Date.now() - started
    console.log('MERCURY:', JSON.stringify({ label: opts.label || 'chat', model, ms, chars: text.length, usage: data?.usage || null }))
    return text ? { text, ms, model } : null
  } catch (error: any) {
    console.error('MERCURY_FAILED:', JSON.stringify({ label: opts.label || 'chat', model, error: String(error?.name === 'AbortError' ? 'timeout' : error?.message || error).slice(0, 160) }))
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
