// Deterministic, read-only presenter for saved SPORTS-VENUE public-web discovery.
// A search-result URL is not venue inventory, a live slot, or a booking receipt.
export type ActivityRunRead = {
  id: string
  type: string
  status: string
  updated_at: string | null
  metadata_json: Record<string, unknown> | null
}
export type ActivityStepRead = {
  run_id: string
  tool_name: string
  status: string
  completed_at: string | null
  output_json: Record<string, unknown> | null
}
export type ActivityVenue = {
  title: string
  provider: string
  sourceUrl: string
  observedAt: string
}
export type ActivityObservation = {
  id: string
  service: string
  location: string | null
  requestedTime: string | null
  status: 'checking' | 'discovered' | 'unverified'
  venues: ActivityVenue[]
  observedAt: string | null
  notice: string
}
const SPORTS = /\b(?:badminton|tennis|squash|pickle[\s-]?ball|table[\s-]?tennis|padel|futsal|foot[\s-]?ball|cricket|turf|swimming|basket[\s-]?ball|volley[\s-]?ball)\b/i
const HOSTS = ['playo.co', 'hudle.in', 'khelomore.com', 'turftown.in', 'bookmyplay.in'] as const
const short = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const validDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null
const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** No unreviewed provider queries: some URLs carry user/session tokens. */
export function safeActivityProviderUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 1500) return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || u.search) return null
    const hostname = u.hostname.toLowerCase()
    if (!HOSTS.some(domain => hostname === domain || hostname.endsWith('.' + domain))) return null
    return u.href
  } catch { return null }
}

/** Require both completed owner-scoped run and its independent stored web-search step. */
export function activityObservationFromRun(run: ActivityRunRead, steps: ActivityStepRead[]): ActivityObservation | null {
  if (!run || run.type !== 'appointment_research' || !isUuid(run.id)) return null
  const m = run.metadata_json
  if (!m || m.plan_type !== 'appointment_research' || m.readOnly !== true || m.mutated !== false) return null
  const service = short(m.service, 90)
  if (!SPORTS.test(service)) return null // No clinic, medical or private appointment data in activity cards.
  if (!['queued', 'running', 'completed', 'failed', 'paused'].includes(run.status)) return null

  const completed = run.status === 'completed'
  const saved = Array.isArray(m.options) ? m.options : []
  const evidence = Array.isArray(steps) ? steps.find(step =>
    step.run_id === run.id && step.tool_name === 'web_search' && step.status === 'completed' &&
    step.output_json?.verifiedStore === 'public-web' &&
    step.output_json?.mutated === false && step.output_json?.locationStrict === true &&
    Boolean(validDate(step.completed_at)) && Array.isArray(step.output_json?.options)) : null
  const observedAt = completed && evidence ? validDate(evidence.completed_at) : null
  const venueSteps = completed && evidence && Array.isArray(evidence.output_json?.options) ? evidence.output_json.options : []
  const venues: ActivityVenue[] = []
  const seen = new Set<string>()

  for (const candidate of venueSteps) {
    if (!candidate || typeof candidate !== 'object' || venues.length >= 8 || !observedAt) continue
    const row = candidate as Record<string, unknown>
    const title = short(row.title, 140)
    const url = safeActivityProviderUrl(row.url)
    if (!title || !url || seen.has(url)) continue
    const provider = new URL(url).hostname
    if (short(row.provider, 160).toLowerCase() !== provider.toLowerCase()) continue
    // The run's result and tool's observed record must agree on exact title + source URL.
    const agrees = saved.some(item => {
      if (!item || typeof item !== 'object') return false
      const x = item as Record<string, unknown>
      return x.url === row.url && x.title === row.title && x.provider === row.provider
    })
    if (!agrees) continue
    seen.add(url)
    venues.push({ title, provider, sourceUrl: url, observedAt })
  }
  const status = venues.length ? 'discovered' : ['queued','running'].includes(run.status) ? 'checking' : 'unverified'
  const notice = status === 'checking'
    ? 'Public-web venue research is still running. No live slot, price or booking is verified.'
    : status === 'discovered'
    ? 'Previously discovered public-web venue pages, not live availability or verified inventory. Open the provider and recheck before any booking.'
    : 'No provider-backed sports venue pages have been established by this saved task. No availability or price is verified.'
  return {
    id: run.id, service, location: short(m.location, 100) || null,
    requestedTime: short(m.timing, 80) || null, status, venues, observedAt, notice,
  }
}
