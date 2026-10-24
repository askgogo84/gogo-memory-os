// Dashboard results may belong to a separate WhatsApp users row.
// A service-role artifact read MUST have an explicit, full-phone owner-row match.
// Missing/ambiguous legacy links fail closed until a verified link is established.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authorizedLinkedOwnerIds, canonicalInternationalPhone, phoneRowCandidates } from './owner-link'

export async function linkedTelegramIds(sessionTelegramId: string | number): Promise<string[]> {
  const own = String(sessionTelegramId)
  try {
    const { data: me, error: ownerError } = await supabaseAdmin
      .from('users')
      .select('whatsapp_id')
      .eq('telegram_id', Number(own))
      .maybeSingle()
    if (ownerError || !me) return [own]

    const full = canonicalInternationalPhone(me.whatsapp_id)
    if (!full) return [own]

    // Resolve only explicitly stored owner rows with the same COMPLETE international number.
    // No suffix matching and no guessing a WhatsApp chat ID from its final nine digits.
    const { data: rows, error: linkError } = await supabaseAdmin
      .from('users')
      .select('telegram_id,whatsapp_id')
      .in('whatsapp_id', phoneRowCandidates(full))
      .limit(25)
    if (linkError || !Array.isArray(rows)) return [own]
    return authorizedLinkedOwnerIds(own, me.whatsapp_id, rows)
  } catch {
    return [own]
  }
}
