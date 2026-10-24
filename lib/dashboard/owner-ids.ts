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
    // The rows store the number in different shapes ("+91…", "91…", "whatsapp:+91…"): match on the last 10 digits.
    const digits = wa.replace(/\D/g, '').slice(-10)
    if (digits.length < 10) return [own]
    const { data: rows } = await supabaseAdmin.from('users').select('telegram_id,whatsapp_id').ilike('whatsapp_id', `%${digits}`).limit(5)
    const ids = new Set([own, ...((rows || []) as any[]).filter(r => String(r.whatsapp_id || '').replace(/\D/g, '').endsWith(digits)).map(r => String(r.telegram_id)).filter(v => /^-?\d+$/.test(v))])
    // WhatsApp-first rows and chat ids are derived from the same number: the full digits (e.g. 91XXXXXXXXXX).
    // Unique to this number, so they belong to this person by construction.
    const full = wa.replace(/\D/g, '')
    for (const derived of [full, `91${digits}`]) if (/^-?\d{9,15}$/.test(derived)) ids.add(derived)
    console.log('LINKED_IDS:', JSON.stringify({ own: own.slice(-4), rows: ((rows || []) as any[]).map(r => String(r.telegram_id).slice(-4)), ids: ids.size }))
    return [...ids]
  } catch { return [own] }
}
