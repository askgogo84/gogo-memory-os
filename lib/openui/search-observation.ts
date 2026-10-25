// OpenUI-ready, deterministic search-card contract. No model-generated code is executed.
// All monetary quotes come from the existing exact-item provider evidence validator.
import {
  COMPARISON_PROVIDERS, comparisonSource, comparisonQuote, comparisonHandoffPath,
  type ComparisonProvider, type ProviderObservation,
} from '@/lib/commerce/comparison-model'

export type SearchCardState = 'observed' | 'checking' | 'pending' | 'blocked' | 'failed'
export type SearchObservationCard = {
  id: string
  provider: ComparisonProvider
  label: string
  state: SearchCardState
  title: string
  evidence: string | null
  reason: string | null
  /** Source-proven product page, never arbitrary webpage or model-supplied action URL. */
  sourceUrl: string | null
  /** An exact item price validated by comparisonQuote, NOT a checkout total. */
  observedPrice: string | null
  observedAmount: number | null
  fee: string | null
  checkedAt: string | null
  /** Internal browser continuation; this is not a purchase/book/payment. */
  handoffPath: string | null
}
export type SearchObservationModel = {
  subject: string
  request: string
  state: string
  items: SearchObservationCard[]
  observedCount: number
  pricedCount: number
}

export type SavedComparisonRead = {
  id?: string
  subject: string
  request: string
  status: string
  providers: ProviderObservation[]
}

const STATES: readonly SearchCardState[] = ['observed','checking','pending','blocked','failed']
const trim = (v: unknown, n: number) => typeof v === 'string' ? v.trim().slice(0,n) : ''

export function savedComparisonId(text: string): string | null {
  // Only our canonical comparison links get inline cards. This does not authorize a read:
  // /api/comparisons/[id] performs session+owner checks for every request.
  const hit = String(text || '').match(/(?:https:\/\/app\.askgogo\.in)?\/dashboard\/comparisons\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i)
  return hit ? hit[1].toLowerCase() : null
}

export function buildSearchObservationModel(data: SavedComparisonRead): SearchObservationModel {
  const subject = trim(data?.subject, 180)
  const rows = Array.isArray(data?.providers) ? data.providers.slice(0,20) : []
  const items: SearchObservationCard[] = []
  for (const row of rows) {
    if (!row || !Object.prototype.hasOwnProperty.call(COMPARISON_PROVIDERS,row.provider)) continue
    if (!STATES.includes(row.status)) continue
    const provider = row.provider
    const isObserved = row.status === 'observed'
    const sourceUrl = isObserved ? comparisonSource(provider,row.sourceUrl) : null
    const checkedAt = isObserved && row.checkedAt && Number.isFinite(Date.parse(row.checkedAt)) ? new Date(row.checkedAt).toISOString() : null
    const quote = sourceUrl && checkedAt && isObserved ? comparisonQuote(subject,row) : null
    const priceValue = quote ? Number(quote.price.replace(/[^\d.]/g,'')) : NaN
    const safePrice = quote && Number.isFinite(priceValue) && priceValue > 0 ? quote.price : null
    const evidence = sourceUrl && isObserved ? trim(row.evidence,1600) : ''
    const firstLine = evidence.split('\n')[0] || ''
    items.push({
      id: provider, provider, label: COMPARISON_PROVIDERS[provider].label,
      state: row.status,
      title: firstLine ? firstLine.slice(0,120) : subject,
      evidence: evidence || null,
      reason: trim(row.reason,240) || null,
      sourceUrl,
      observedPrice: safePrice,
      observedAmount: safePrice ? priceValue : null,
      fee: safePrice ? quote?.fee || null : null,
      checkedAt,
      handoffPath: comparisonHandoffPath(row),
    })
  }
  return {
    subject,
    request: trim(data?.request,2000),
    state: trim(data?.status,50),
    items,
    observedCount: items.filter(r=>r.sourceUrl && r.checkedAt).length,
    pricedCount: items.filter(r=>r.observedPrice !== null).length,
  }
}

export type SearchSort = 'source'|'price'|'name'|'recent'
export function sortSearchObservations(items: SearchObservationCard[], sort: SearchSort, observedOnly = false): SearchObservationCard[] {
  const rows = observedOnly ? items.filter(r=>r.sourceUrl && r.checkedAt) : [...items]
  if (sort === 'name') return rows.sort((a,b)=>a.label.localeCompare(b.label))
  if (sort === 'recent') return rows.sort((a,b)=>(Date.parse(b.checkedAt||'')||0)-(Date.parse(a.checkedAt||'')||0))
  if (sort === 'price') return rows.sort((a,b)=>(a.observedAmount??Infinity)-(b.observedAmount??Infinity))
  const priority:Record<SearchCardState,number> = {observed:0,checking:1,pending:2,blocked:3,failed:4}
  return rows.sort((a,b)=>priority[a.state]-priority[b.state])
}
