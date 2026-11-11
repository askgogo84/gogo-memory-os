// The person's chosen companion character, read for the dashboard shell. A missing column (migration not run) or
// any read error means "no choice yet": the shell then shows Gogo, never an error.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exactDashboardOwnerId } from '@/lib/dashboard/exact-owner-id'
import { isCrewId, type CrewId } from '@/lib/gogo/crew'

export function companionOwnerId(raw: unknown): number | string | null {
  const owner = exactDashboardOwnerId(raw)
  if (!owner) return null
  const n = Number(owner)
  return Number.isSafeInteger(n) && String(n) === owner ? n : owner
}

export async function loadCompanionChoice(rawOwner: unknown): Promise<CrewId | null> {
  const tg = companionOwnerId(rawOwner)
  if (tg === null) return null
  const { data, error } = await supabaseAdmin.from('user_experience_preferences').select('companion').eq('telegram_id', tg).maybeSingle()
  if (error) return null
  const v = (data as any)?.companion
  return isCrewId(v) ? v : null
}

export async function saveCompanionChoice(rawOwner: unknown, companion: CrewId): Promise<boolean> {
  const tg = companionOwnerId(rawOwner)
  if (tg === null || !isCrewId(companion)) return false
  // Only these columns are written: personality and comfort_drink have database defaults
  // (sql/dashboard-experience-personalization.sql), so a new row gets them and an existing row keeps its own.
  const { error } = await supabaseAdmin.from('user_experience_preferences')
    .upsert({ telegram_id: tg, companion, updated_at: new Date().toISOString() }, { onConflict: 'telegram_id' })
  if (error) console.warn('COMPANION_SAVE_FAILED:', JSON.stringify({ code: (error as any).code || null }))
  return !error
}
