// Wraps the global fetch once so every paid API call (models, search, calls, browser, email) is metered
// without touching the many places that make those calls. It only observes: the request and the response
// the caller gets are unchanged, and any metering failure is swallowed.
import { classifyRequest, tokensFromBody, type MeterEvent } from './core'
import { recordMeterEvent } from './record'

function requestUrl(input: any): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return String(input?.url || '')
}
function requestMethod(input: any, init?: RequestInit): string {
  return String(init?.method || (typeof input === 'object' && input?.method) || 'GET')
}
function modelFromInit(init?: RequestInit): string | null {
  try { return typeof init?.body === 'string' ? (JSON.parse(init.body)?.model ?? null) : null } catch { return null }
}

export function installFetchMeter() {
  const g = globalThis as any
  if (g.__askgogoFetchMetered || typeof g.fetch !== 'function') return
  const original: typeof fetch = g.fetch.bind(globalThis)
  g.__askgogoFetchMetered = true
  g.fetch = async function meteredFetch(input: any, init?: RequestInit) {
    let kind: ReturnType<typeof classifyRequest> = null
    try { kind = classifyRequest(requestUrl(input), requestMethod(input, init)) } catch { kind = null }
    const response = await original(input, init)
    if (!kind) return response
    try {
      const event: MeterEvent = { vendor: kind.vendor, category: kind.category, ok: response.ok, units: 1 }
      if (kind.category === 'llm') {
        event.model = modelFromInit(init)
        const type = response.headers.get('content-type') || ''
        if (response.ok && type.includes('application/json')) {
          // Read usage from a clone after the caller has its response; does not delay the caller.
          response.clone().json().then((body: any) => {
            const t = tokensFromBody(body)
            void recordMeterEvent({ ...event, model: t.model || event.model, inputTokens: t.input, outputTokens: t.output })
          }).catch(() => { void recordMeterEvent(event) })
          return response
        }
        event.metadata = { streamed: type.includes('event-stream') }
      }
      void recordMeterEvent(event)
    } catch { /* metering never breaks a request */ }
    return response
  }
}
