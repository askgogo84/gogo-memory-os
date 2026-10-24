// One person can have two users rows: the dashboard sign-in row and the WhatsApp row (negative phone-based id),
// linked by the same whatsapp_id. 24 Oct live: decks made on WhatsApp were saved under the WhatsApp row and the
// dashboard (signed in as the other row) showed 404. Saved results are readable from every row of the same person.
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function linkedTelegramIds(sessionTelegramId: string | number): Promise<string[]> {
  const own = String(sessionTelegramId)
  try {
    const { data: me } = await supabaseAdmin.from('users').select('whatsapp_id').eq('telegram_id', Number(own)).maybeSingle()
    const wa = String((me as any)?.whatsapp_id || '').trim()
    if (!wa) return [own]
    const { data: rows } = await supabaseAdmin.from('users').select('telegram_id').eq('whatsapp_id', wa).limit(5)
    const ids = new Set([own, ...((rows || []) as any[]).map(r => String(r.telegram_id)).filter(v => /^-?\d+$/.test(v))])
    return [...ids]
  } catch { return [own] }
}
