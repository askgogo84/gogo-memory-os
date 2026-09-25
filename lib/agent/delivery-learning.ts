import { supabaseAdmin } from '@/lib/supabase-admin'

export type DeliveryLearningRef = { kind: 'reminder' | 'notification'; id: string }
export async function hasDeliveryLearningEvidence(owner: string, handler: string, objectKind?: string | null, ref?: DeliveryLearningRef): Promise<boolean | null> {
  // null means a non-delivery operation, e.g. verified reminder CRUD/read-back.
  const delivery = !!ref || /briefing|follow.?up|delivery|dispatch|cron.reminder|reminder.send|send.reminder/i.test(handler + ' ' + (objectKind || ''))
  if (!delivery) return null
  if (!ref || !owner || !ref.id) return false
  try {
    const reminder = ref.kind === 'reminder'
    const { data, error } = await supabaseAdmin.from(reminder ? 'reminders' : 'notification_deliveries')
      .select(reminder ? 'delivery_state' : 'state')
      .eq(reminder ? 'id' : 'delivery_key', ref.id)
      .eq(reminder ? 'telegram_id' : 'owner_id', owner).maybeSingle()
    const row = data as { delivery_state?: unknown; state?: unknown } | null
    const state = reminder ? row?.delivery_state : row?.state
    return !error && (state === 'delivered' || state === 'read')
  } catch { return false }
}
