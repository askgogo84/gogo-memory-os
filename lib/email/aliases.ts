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

type AliasRow = { alias: string; forwarding_confirmed_at: string | null; last_received_at: string | null }

// red #1119: forwarding_verified_address is recorded only from Gmail's forwarding-confirmation email. Until the
// migration that adds it is applied, PostgREST rejects the column; fall back to the old columns and report
// forwarding as not confirmed rather than failing the lookup.
const ALIAS_COLUMNS = 'alias,forwarding_confirmed_at,last_received_at'
const ALIAS_COLUMNS_VERIFIED = `${ALIAS_COLUMNS},forwarding_verified_address`

export function isMissingVerifiedAddressColumn(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return (error.code === '42703' || error.code === 'PGRST204' || /does not exist|could not find/i.test(String(error.message || '')))
    && /forwarding_verified_address/.test(String(error.message || ''))
}

/** Forwarding counts as confirmed only with both a confirmation time and a Gmail-verified forwarding address. */
function effectiveAliasRow(row: any): AliasRow {
  const verified = typeof row?.forwarding_verified_address === 'string' && row.forwarding_verified_address.trim() ? row.forwarding_verified_address : null
  return { alias: row.alias, forwarding_confirmed_at: verified ? (row.forwarding_confirmed_at ?? null) : null, last_received_at: row.last_received_at ?? null }
}

async function readAliasByOwner(telegramId: number) {
  const first = await supabaseAdmin.from('email_aliases').select(ALIAS_COLUMNS_VERIFIED).eq('telegram_id', telegramId).maybeSingle()
  if (!isMissingVerifiedAddressColumn(first.error)) return first
  return await supabaseAdmin.from('email_aliases').select(ALIAS_COLUMNS).eq('telegram_id', telegramId).maybeSingle()
}

export async function getOrCreateAlias(telegramId: number, name?: string | null): Promise<AliasRow> {
  const { data: existing, error } = await readAliasByOwner(telegramId)
  if (error) throw new Error(`alias_read_failed:${error.message}`)
  if (existing) return effectiveAliasRow(existing)
  for (let attempt = 0; attempt < 4; attempt++) {
    const alias = makeAlias(name)
    const { data, error: insertError } = await supabaseAdmin.from('email_aliases').insert({ alias, telegram_id: telegramId }).select(ALIAS_COLUMNS).maybeSingle()
    if (!insertError && data) return effectiveAliasRow(data)
    // A concurrent request created this person's row: read it back.
    if (insertError && /telegram_id/.test(insertError.message)) {
      const { data: again } = await readAliasByOwner(telegramId)
      if (again) return effectiveAliasRow(again)
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
  let { data, error } = await supabaseAdmin.from('email_aliases')
    .select('telegram_id,forwarding_confirmed_at,forwarding_verified_address').eq('alias', alias).maybeSingle()
  // Before the forwarding_verified_address migration is applied: same lookup without it (forwarding unconfirmed).
  if (isMissingVerifiedAddressColumn(error)) {
    ({ data, error } = await supabaseAdmin.from('email_aliases')
      .select('telegram_id,forwarding_confirmed_at').eq('alias', alias).maybeSingle() as any)
  }
  // The provider must retry a temporary lookup outage; never interpret it as
  // an unknown address or silently write mail to a guessed numeric owner.
  if (error) throw new Error('email_alias_owner_lookup_failed')
  if (!data) return null
  const telegramId = safeInboundAliasOwnerId(data.telegram_id)
  // An existing invalid row is a processing failure, not an unknown address.
  // Let inbound handlers return 500 so the sender can retry after repair.
  if (telegramId === null) throw new Error('email_alias_owner_invalid')
  const raw = (data as any).forwarding_verified_address
  const verifiedForwarder = typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : null
  // red #1119: a confirmation time without a Gmail-verified forwarding address (legacy header-based activation, or
  // the column not yet migrated) is not confirmation.
  return verifiedForwarder
    ? { telegramId, confirmedAt: (data.forwarding_confirmed_at as string | null) ?? null, verifiedForwarder }
    : { telegramId, confirmedAt: null as string | null }
}
