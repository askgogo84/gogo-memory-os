// The one freshness guard every approval passes through before it can become approved or execute:
// the WhatsApp bridge, the typed calendar/reminder approval turn, and the dashboard approve button.
// It also persists the exact numbered list a person was shown, so "approve 2" means the second item
// of THAT list and never a list recomputed after an item expired or a new one arrived.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { APPROVAL_LIST_LIMIT, approvalRelativeAge, expiredApprovalReply, isApprovalExpired, type ApprovalTtlRow } from './approval-ttl'

export type GuardedApprovalRow = ApprovalTtlRow & { id: string; run_id?: string | null; title?: string | null; action_type?: string | null; risk_level?: string | null }
export type ApprovalSurface = 'whatsapp' | 'dashboard' | 'typed'

/** Lifetime of a shown numbered approval list. After this, "approve N" shows the list again. */
export const APPROVAL_CHOICE_TTL_MS = 30 * 60_000
export const APPROVAL_CHOICE_EVENT = 'approval_choice_list'

/**
 * Closes one pending approval as expired. Owner-bound and guarded on status='pending', so it never
 * touches another person's card or one already decided. Pauses its run so no worker can pick it up.
 * Returns the closed row, or null when the card was no longer pending.
 */
export async function expirePendingApproval(telegramId: number | string, row: GuardedApprovalRow, now: Date, surface: ApprovalSurface) {
  const owner = String(telegramId)
  const nowIso = now.toISOString()
  const { data, error } = await supabaseAdmin.from('agent_approvals')
    .update({ status: 'expired', resolved_at: nowIso, resolution_note: `Expired before a decision (requested ${approvalRelativeAge(row.requested_at, now)}); nothing was executed.` })
    .eq('id', row.id)
    .eq('telegram_id', owner)
    .eq('status', 'pending')
    .select('id,run_id')
    .maybeSingle()
  if (error) throw new Error(`agent_approval_expire_failed:${error.message}`)
  if (!data) return null
  if (data.run_id) {
    await supabaseAdmin.from('agent_runs')
      .update({ status: 'paused', updated_at: nowIso })
      .eq('id', data.run_id)
      .eq('telegram_id', owner)
      .eq('status', 'waiting_approval')
  }
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: owner, run_id: data.run_id,
    event_type: 'approval_expired',
    message: `Approval expired before a decision: ${row.title || 'Pending action'}`.slice(0, 900),
    metadata_json: { approval_id: data.id, action_type: row.action_type ?? null, risk_level: row.risk_level ?? null, surface },
  }).then(({ error }: any) => { if (error) console.error('AGENT_APPROVAL_ACTIVITY_FAILED:', error.message) })
  return data as { id: string; run_id: string | null }
}

/**
 * Call immediately before an approval transitions to approved (or executes). A fresh row passes
 * untouched. An expired row is closed as expired and the caller gets the honest reply to send;
 * the caller must not approve or execute it.
 */
export async function guardApprovalFreshness(p: { telegramId: number | string; row: GuardedApprovalRow; now?: Date; surface: ApprovalSurface }): Promise<{ expired: false } | { expired: true; text: string }> {
  const now = p.now || new Date()
  if (!isApprovalExpired(p.row, now)) return { expired: false }
  await expirePendingApproval(p.telegramId, p.row, now, p.surface)
  return { expired: true, text: expiredApprovalReply(p.row.requested_at, now) }
}

/** Persists the exact ordered approval ids a person was just shown as a numbered list. */
export async function rememberApprovalChoices(telegramId: number | string, approvalIds: string[], now: Date = new Date()) {
  const ids = approvalIds.map(String).filter(Boolean).slice(0, APPROVAL_LIST_LIMIT)
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(telegramId),
    event_type: APPROVAL_CHOICE_EVENT,
    message: `Pending approvals listed (${ids.length}).`,
    metadata_json: { approval_ids: ids, at: now.toISOString(), expires_at: new Date(now.getTime() + APPROVAL_CHOICE_TTL_MS).toISOString() },
  })
  if (error) throw new Error(`agent_approval_choice_write_failed:${error.message}`)
}

/**
 * The ordered approval ids of the latest numbered list shown to this person, or null when there is
 * none, it is older than APPROVAL_CHOICE_TTL_MS, or it is malformed. Never recomputed.
 */
export async function latestApprovalChoices(telegramId: number | string, now: Date = new Date()): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin.from('agent_activity')
    .select('metadata_json,created_at')
    .eq('telegram_id', String(telegramId))
    .eq('event_type', APPROVAL_CHOICE_EVENT)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`agent_approval_choice_read_failed:${error.message}`)
  const m = (data as any)?.metadata_json
  const ids = m?.approval_ids
  const age = now.getTime() - Date.parse(String(m?.at || ''))
  if (!Array.isArray(ids) || !ids.length || ids.length > APPROVAL_LIST_LIMIT) return null
  if (ids.some((id: unknown) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return null
  if (!Number.isFinite(age) || age < 0 || age > APPROVAL_CHOICE_TTL_MS) return null
  return ids as string[]
}
