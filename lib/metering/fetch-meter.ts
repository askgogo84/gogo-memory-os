// Wraps the global fetch once so every paid API call (models, search, calls, browser, email) is metered
// without touching the many places that make those calls. It only observes: the request and the response
// the caller gets are unchanged, and any metering failure is swallowed.
import { classifyRequest, rawUsageFromBody, type MeterEvent } from './core'
import { keepAlive, recordMeterEvent } from './record'

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
    const started = Date.now()
    let response: Response
    try { response = await original(input, init) }
    catch (error) {
      if (kind) void recordMeterEvent({ ...kind, model: modelFromInit(init), ok: false, metadata: { latency_ms: Date.now() - started, outcome: 'transport_unknown' } })
      throw error
    }
    if (!kind) return response
    try {
      const event: MeterEvent = { vendor: kind.vendor, category: kind.category, ok: response.ok, units: 1, metadata: { latency_ms: Date.now() - started } }
      if (kind.category === 'llm') {
        event.model = modelFromInit(init)
        const type = response.headers.get('content-type') || ''
        if (response.ok && type.includes('application/json')) {
          // Read usage from a clone after the caller has its response; does not delay the caller.
          void keepAlive(response.clone().json().then((body: any) => {
            const t = rawUsageFromBody(body)
            return recordMeterEvent({ ...event, model: t.model || event.model, inputTokens: t.input, outputTokens: t.output, cachedReadTokens: t.cachedReadTokens, cachedWriteTokens: t.cachedWriteTokens, inputIncludesCached: t.inputIncludesCached })
          }).catch(() => recordMeterEvent(event)))
          return response
        }
        event.metadata = { ...event.metadata, streamed: type.includes('event-stream') }
      }
      void recordMeterEvent(event)
    } catch { /* metering never breaks a request */ }
    return response
  }
}
