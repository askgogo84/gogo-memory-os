import { supabaseAdmin } from '@/lib/supabase-admin'

export async function saveFollowupState(
  telegramId: number,
  kind: string,
  payload: Record<string, any>
) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: JSON.stringify({
      type: 'followup_state',
      kind,
      payload,
      created_at: new Date().toISOString(),
    }),
  })
}

export async function getLatestFollowupState(telegramId: number, kind: string) {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('content, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(20)

  const items = (data || [])
    .map((x: any) => {
      try {
        return JSON.parse(x.content)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .filter((x: any) => x.type === 'followup_state' && x.kind === kind)

  return items[0] || null
}

// Consume/clear only one follow-up kind for this user. The memories table stores
// followup_state as JSON text, so resolve matching row ids first, then delete only
// those rows. Best-effort: a failed clear must never crash the message pipeline.
export async function clearFollowupState(telegramId: number, kind: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('memories')
      .select('id, content')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false })
      .limit(50)

    const ids = (data || [])
      .filter((row: any) => {
        try {
          const parsed = JSON.parse(row.content)
          return parsed?.type === 'followup_state' && parsed?.kind === kind
        } catch {
          return false
        }
      })
      .map((row: any) => row.id)
      .filter(Boolean)

    if (ids.length) await supabaseAdmin.from('memories').delete().in('id', ids)
  } catch (err: any) {
    console.error('FOLLOWUP_STATE_CLEAR_FAILED:', err?.message || err)
  }
}

// TTL guard shared by every follow-up consumer: a stored pending record is only honored for
// `maxMinutes` (default 10). Missing/unparseable timestamps are treated as fresh (fail-open)
// so a legacy record without created_at still works. Reads created_at off the row or the
// embedded payload, whichever is present.
export function isFreshFollowupState(state: any, maxMinutes = 10): boolean {
  if (!state?.created_at && !state?.payload?.created_at) return true
  const raw = state.created_at || state.payload.created_at
  const createdAt = new Date(raw).getTime()
  if (!Number.isFinite(createdAt)) return true
  return Date.now() - createdAt <= maxMinutes * 60 * 1000
}

// STRICT variant for asset / media references ("this", field follow-ups): fails CLOSED.
// A record with a missing or unparseable timestamp is treated as STALE, never fresh — so a
// "this"/field follow-up can never silently bind to an old or ambiguous asset from an earlier
// turn (Case 5). Unlike isFreshFollowupState, there is no fail-open path: if we cannot prove
// the state is recent, we expire it. Callers must also verify the record is the CURRENT one
// (getLatestFollowupState returns newest-first), so ordering + this TTL together give an
// explicit freshness rule for referenced media.
export function isStrictlyFreshFollowupState(state: any, maxMinutes = 10): boolean {
  const raw = state?.created_at || state?.payload?.created_at
  if (!raw) return false
  const createdAt = new Date(raw).getTime()
  if (!Number.isFinite(createdAt)) return false
  return Date.now() - createdAt <= maxMinutes * 60 * 1000
}
