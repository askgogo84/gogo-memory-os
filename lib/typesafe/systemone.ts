// The TypeSafe /v1/systemone request used by understand-first (lib/agent/understanding.ts). Same endpoint,
// key and abort behaviour as runJevShadow in ./jev-shadow.ts. A classification read: it changes nothing for
// the user anywhere, so it lives beside the Jev client, outside the lib/agent executor set.
export async function postSystemOne(body: unknown, timeoutMs: number): Promise<{ raw: any; latencyMs: number } | { error: string; latencyMs: number }> {
  const apiKey = String(process.env.TYPESAFE_API_KEY || '').trim()
  if (!apiKey) return { error: 'not_configured', latencyMs: 0 }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })
    const raw = await response.json().catch(() => ({}))
    if (!response.ok) return { error: `typesafe_http_${response.status}`, latencyMs: Date.now() - started }
    return { raw, latencyMs: Date.now() - started }
  } catch (err: any) {
    return { error: err?.name === 'AbortError' ? 'typesafe_timeout' : String(err?.message || 'typesafe_error').replace(/\s+/g, ' ').slice(0, 120), latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}
