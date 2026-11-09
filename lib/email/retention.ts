/**
 * Retention for forwarded-email bodies (private content, not live Gmail).
 *
 * The inbound webhook's opportunistic per-owner prune cannot expire mail when
 * forwarding has stopped. A bounded existing-cron sweep closes that gap.
 * No email content is read: discover expired IDs, then atomically recheck age
 * on deletion. Do not expand into a full-table read or an unbounded delete.
 */

export const FORWARDED_EMAIL_RETENTION_DAYS = 30
export const FORWARDED_EMAIL_PRUNE_BATCH = 100
const DAY_MS = 86_400_000

export type ExpiredEmailRef = { id: string }
export type ForwardedEmailRetentionStore = {
  findExpired(cutoffIso: string, limit: number): Promise<ExpiredEmailRef[]>
  deleteExpired(ids: string[], cutoffIso: string): Promise<number>
}

export function forwardedEmailCutoff(nowMs: number = Date.now()): string {
  if (!Number.isFinite(nowMs) || nowMs < FORWARDED_EMAIL_RETENTION_DAYS * DAY_MS) {
    throw new Error('forwarded_retention_invalid_clock')
  }
  return new Date(nowMs - FORWARDED_EMAIL_RETENTION_DAYS * DAY_MS).toISOString()
}

/** A single idempotent sweep; subsequent cron passes drain old backlog. */
export async function pruneForwardedEmailBatch(
  store: ForwardedEmailRetentionStore,
  nowMs: number = Date.now(),
  requestedLimit: number = FORWARDED_EMAIL_PRUNE_BATCH,
): Promise<{ examined: number; deleted: number; cutoffIso: string }> {
  const cutoffIso = forwardedEmailCutoff(nowMs)
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(FORWARDED_EMAIL_PRUNE_BATCH, Math.max(1, Math.floor(requestedLimit)))
    : FORWARDED_EMAIL_PRUNE_BATCH
  const rows = await store.findExpired(cutoffIso, limit)
  if (!Array.isArray(rows) || rows.length > limit) throw new Error('forwarded_retention_invalid_candidate_set')
  const ids = rows.map(row => String(row?.id || ''))
  if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('forwarded_retention_invalid_candidate_id')
  }
  if (!ids.length) return { examined: 0, deleted: 0, cutoffIso }
  const deleted = await store.deleteExpired(ids, cutoffIso)
  if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > ids.length) {
    throw new Error('forwarded_retention_invalid_delete_receipt')
  }
  return { examined: ids.length, deleted, cutoffIso }
}

/**
 * Run with the service-role client, only from an existing authenticated cron.
 * Both queries are capped, and a row moved to a newer received_at after
 * selection is protected by the second cutoff predicate.
 */
export async function pruneForwardedEmailInDb(nowMs: number = Date.now()) {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  return pruneForwardedEmailBatch({
    async findExpired(cutoffIso, limit) {
      const { data, error } = await supabaseAdmin.from('inbound_emails')
        .select('id')
        .lt('received_at', cutoffIso)
        .order('received_at', { ascending: true })
        .limit(limit)
      if (error) throw new Error('forwarded_retention_lookup_failed')
      if (!Array.isArray(data)) throw new Error('forwarded_retention_lookup_invalid')
      return data
    },
    async deleteExpired(ids, cutoffIso) {
      const { data, error } = await supabaseAdmin.from('inbound_emails')
        .delete()
        .in('id', ids)
        .lt('received_at', cutoffIso)
        .select('id')
      if (error) throw new Error('forwarded_retention_delete_failed')
      if (!Array.isArray(data)) throw new Error('forwarded_retention_delete_invalid')
      return data.length
    },
  }, nowMs)
}
