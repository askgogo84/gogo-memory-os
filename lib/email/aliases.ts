// Per-person forwarding addresses: divya-k7q2mx@in.askgogo.in. The random part makes addresses unguessable.
import { randomInt } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const INBOUND_DOMAIN = (process.env.EMAIL_INBOUND_DOMAIN || 'in.askgogo.in').toLowerCase()
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function makeAlias(name: string | null | undefined) {
  const base = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 12) || 'gogo'
  let tail = ''
  for (let i = 0; i < 6; i++) tail += ALPHABET[randomInt(ALPHABET.length)]
  return `${base}-${tail}`
}

export function aliasAddress(alias: string) {
  return `${alias}@${INBOUND_DOMAIN}`
}

/** "Divya <divya-k7q2mx@in.askgogo.in>" or the envelope address → "divya-k7q2mx", only for our domain. */
export function aliasFromAddress(address: string) {
  const domain = INBOUND_DOMAIN.replace(/[.]/g, '\\.')
  const m = String(address || '').toLowerCase().match(new RegExp(`([a-z0-9]{1,16}-[a-z0-9]{6})(?:\\+[^@]*)?@${domain}`))
  return m ? m[1] : null
}

export async function getOrCreateAlias(telegramId: number, name?: string | null) {
  const { data: existing, error } = await supabaseAdmin.from('email_aliases').select('alias,forwarding_confirmed_at,last_received_at').eq('telegram_id', telegramId).maybeSingle()
  if (error) throw new Error(`alias_read_failed:${error.message}`)
  if (existing) return existing as { alias: string; forwarding_confirmed_at: string | null; last_received_at: string | null }
  for (let attempt = 0; attempt < 4; attempt++) {
    const alias = makeAlias(name)
    const { data, error: insertError } = await supabaseAdmin.from('email_aliases').insert({ alias, telegram_id: telegramId }).select('alias,forwarding_confirmed_at,last_received_at').maybeSingle()
    if (!insertError && data) return data as { alias: string; forwarding_confirmed_at: string | null; last_received_at: string | null }
    // A concurrent request created this person's row: read it back.
    if (insertError && /telegram_id/.test(insertError.message)) {
      const { data: again } = await supabaseAdmin.from('email_aliases').select('alias,forwarding_confirmed_at,last_received_at').eq('telegram_id', telegramId).maybeSingle()
      if (again) return again as any
    }
  }
  throw new Error('alias_create_failed')
}

export async function ownerOfAlias(alias: string) {
  const { data } = await supabaseAdmin.from('email_aliases').select('telegram_id,forwarding_confirmed_at').eq('alias', alias).maybeSingle()
  return data ? { telegramId: Number(data.telegram_id), confirmedAt: data.forwarding_confirmed_at as string | null } : null
}
