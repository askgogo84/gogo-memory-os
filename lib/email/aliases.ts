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
  // Owner selection requires ONE complete mailbox in the configured inbound domain.
  // A substring match could route foreign-domain recipients or embedded addresses
  // into a different user's private inbox. Do not infer a recipient from fragments.
  const domain = INBOUND_DOMAIN.replace(/[.]/g, '\\.')
  const mailbox = `([a-z0-9]{1,16}-[a-z0-9]{6})(?:\\+[a-z0-9._-]{1,64})?@${domain}`
  const candidate = String(address || '').toLowerCase().trim()
  // Signed provider envelope recipients are bare mailboxes. Preserve the
  // legacy single display-name form, but reject lists or malformed wrappers.
  const bare = candidate.match(new RegExp(`^${mailbox}$`))
  if (bare) return bare[1]
  const display = candidate.match(new RegExp(`^[^<>,@\\r\\n]{0,200}<\\s*${mailbox}\\s*>$`))
  return display ? display[1] : null
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

/**
 * Inbound email persists private content under this legacy numeric owner ID.
 * PostgreSQL BIGINT values above JS safe precision can round to ANOTHER tenant;
 * reject them until the whole inbound pipeline can carry exact string owner IDs.
 */
export function safeInboundAliasOwnerId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const exact = value.trim()
  if (!/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(exact)) return null
  const parsed = Number(exact)
  return Number.isSafeInteger(parsed) && BigInt(parsed).toString() === exact ? parsed : null
}

export async function ownerOfAlias(alias: string) {
  const { data, error } = await supabaseAdmin.from('email_aliases')
    .select('telegram_id,forwarding_confirmed_at').eq('alias', alias).maybeSingle()
  // The provider must retry a temporary lookup outage; never interpret it as
  // an unknown address or silently write mail to a guessed numeric owner.
  if (error) throw new Error('email_alias_owner_lookup_failed')
  if (!data) return null
  const telegramId = safeInboundAliasOwnerId(data.telegram_id)
  // An existing invalid row is a processing failure, not an unknown address.
  // Let inbound handlers return 500 so the sender can retry after repair.
  if (telegramId === null) throw new Error('email_alias_owner_invalid')
  return { telegramId, confirmedAt: data.forwarding_confirmed_at as string | null }
}
