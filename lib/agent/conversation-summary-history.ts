// Bounded server-owned scan position. This is coverage of inspected rows, not a claim
// that every message was retained or that a quoted statement is true.
import { compareSummaryTimestamps } from './conversation-summary-evidence'
export type SummaryCursor = { upTo: string; upToId?: string; upToRole?: string }
export type SummaryHistoryRow = { id?: string | number; telegram_id?: number; role: string; content: string; created_at: string }
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function summaryCursorId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  if (typeof value !== 'string') return null
  return UUID.test(value) || /^(0|[1-9]\d{0,18})$/.test(value) ? value : null
}
export function validSummaryTime(value: unknown): value is string {
  return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60_000
}
export function validSummaryRole(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{1,32}$/.test(value)
}
function compareIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
  if (!UUID.test(a) || !UUID.test(b)) throw Error('chat_summary_identity_type_mismatch')
  return a < b ? -1 : a > b ? 1 : 0
}
export function compareSummaryCursors(a: SummaryCursor, b: SummaryCursor): number {
  const time = compareSummaryTimestamps(a.upTo, b.upTo)
  if (time) return time
  // A legacy timestamp has no knowledge of coverage within its tied group.
  if (!a.upToId || !b.upToId) return Number(Boolean(a.upToId)) - Number(Boolean(b.upToId))
  const ar = a.upToRole || '', br = b.upToRole || ''
  const role = ar < br ? 1 : ar > br ? -1 : 0
  if (role) return role
  return compareIds(a.upToId, b.upToId)
}
function cursor(row: SummaryHistoryRow): Required<SummaryCursor> {
  const id = summaryCursorId(row.id)
  if (!id || !validSummaryTime(row.created_at) || !validSummaryRole(row.role)) throw Error('chat_summary_history_identity_invalid')
  return { upTo: row.created_at, upToId: id, upToRole: row.role }
}
function validateRows(data: unknown, owner: number, max: number, ascending: boolean): SummaryHistoryRow[] {
  if (!Array.isArray(data) || data.length > max) throw Error('chat_summary_history_unavailable')
  let last: SummaryCursor | undefined
  for (const r of data) {
    if (!r || r.telegram_id !== owner || typeof r.role !== 'string' || typeof r.content !== 'string') throw Error('chat_summary_history_owner_or_shape')
    const next = cursor(r)
    if (last && compareSummaryCursors(next, last) * (ascending ? 1 : -1) <= 0) throw Error('chat_summary_history_order_invalid')
    last = next
  }
  return data
}
function after(c: Required<SummaryCursor>): string {
  return `created_at.gt.${c.upTo},and(created_at.eq.${c.upTo},role.lt.${c.upToRole}),and(created_at.eq.${c.upTo},role.eq.${c.upToRole},id.gt.${c.upToId})`
}
function before(c: Required<SummaryCursor>): string {
  return `created_at.lt.${c.upTo},and(created_at.eq.${c.upTo},role.gt.${c.upToRole}),and(created_at.eq.${c.upTo},role.eq.${c.upToRole},id.lt.${c.upToId})`
}
/** Freeze the verbatim boundary, then scan the oldest unprocessed bounded batch.
 * No offsets, raw message text, unvalidated IDs or unvalidated times enter filters.
 * An old timestamp-only cursor replays that timestamp once; older historic gaps
 * cannot be inferred or repaired from the old summary alone.
 */
export async function readSummaryHistory(owner: number, db: any, existing: SummaryCursor | null, options: { legacyRebuild?: boolean } = {}): Promise<SummaryHistoryRow[]> {
  if (!Number.isSafeInteger(owner)) throw Error('chat_summary_history_bounds_invalid')
  const window = 20, batch = 40, recentLimit = options.legacyRebuild ? window + batch : window
  const select = 'id, telegram_id, role, content, created_at'
  const recent = await db.from('conversations').select(select).eq('telegram_id', owner)
    .order('created_at', { ascending: false }).order('role', { ascending: true }).order('id', { ascending: false }).limit(recentLimit)
  if (recent.error) throw Error('chat_summary_history_unavailable')
  const newest = validateRows(recent.data, owner, recentLimit, false)
  if (newest.length < window) return []
  // Legacy prose has no recoverable provenance. Preserve the previous bounded
  // recent-window rebuild on its first upgrade; starting below its high cursor
  // would otherwise be rejected forever by the out-of-order-worker fence.
  // This does not repair older gaps already lost by legacy compaction.
  if (options.legacyRebuild) return newest.slice(window).reverse()
  const boundary = cursor(newest[window - 1])
  if (existing && (!validSummaryTime(existing.upTo) || existing.upToId !== undefined && (!summaryCursorId(existing.upToId) || !validSummaryRole(existing.upToRole)))) throw Error('chat_summary_cursor_invalid')
  if (existing?.upToId && compareSummaryCursors(existing, boundary) >= 0) return []
  const upper = before(boundary)
  // A single nested OR expression preserves both bounds. Calling .or twice
  // would overwrite the first URL parameter in the Supabase query builder.
  const filter = existing ? `and(${existing.upToId ? `or(${after(existing as Required<SummaryCursor>)})` : `created_at.gte.${existing.upTo}`},or(${upper}))` : upper
  const result = await db.from('conversations').select(select).eq('telegram_id', owner).or(filter)
    .order('created_at', { ascending: true }).order('role', { ascending: false }).order('id', { ascending: true }).limit(batch)
  if (result.error) throw Error('chat_summary_history_unavailable')
  const rows = validateRows(result.data, owner, batch, true)
  for (const r of rows) {
    const c = cursor(r)
    if (compareSummaryCursors(c, boundary) >= 0 || existing && (existing.upToId ? compareSummaryCursors(c, existing) <= 0 : compareSummaryTimestamps(c.upTo, existing.upTo) < 0)) throw Error('chat_summary_history_range_invalid')
  }
  return rows
}
