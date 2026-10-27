import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizePhoneNumber } from './friend-reminders'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'

// Consent / opt-out for friend-to-friend reminders (Phase 1C follow-on).
// A recipient who replies STOP suppresses reminders per SENDER (owner_telegram_id),
// never globally — blocking one owner leaves every other owner untouched.
//
// NORMALISATION INVARIANT — READ THIS BEFORE TOUCHING EITHER QUERY:
// friend_contacts.whatsapp_id and reminders.whatsapp_to are stored in the BARE
// "+<digits>" form produced by normalizePhoneNumber. The inbound STOP arrives as
// "whatsapp:+91…". Every write to AND read from reminder_optout MUST pass the number
// through normalizePhoneNumber so the recipient key is byte-identical on both sides.
// If the write form and the read form ever diverge, the opt-out silently does nothing.

const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE'])

/** Exact-match opt-out trigger. Trimmed + uppercased equality only — no substring,
 *  no lazy-prefix regex, so "stop nagging" or "please unsubscribe me" do NOT match. */
export function isStopMessage(body: string): boolean {
  return STOP_WORDS.has((body || '').trim().toUpperCase())
}

/** STOP handler: suppress this recipient for EVERY owner who holds them in
 *  friend_contacts, one reminder_optout row per (owner, recipient) pair.
 *  Returns the number of pairs written. */
export async function suppressAllForRecipient(recipientWhatsappId: string): Promise<number> {
  const recipient = normalizePhoneNumber(recipientWhatsappId) // <-- NORMALISE (write side)
  if (!recipient) return 0

  const { data: owners, error } = await supabaseAdmin
    .from('friend_contacts')
    .select('owner_telegram_id')
    .eq('whatsapp_id', recipient)
  if (error) throw error

  // Persisted BIGINT owner IDs may arrive as exact decimal strings. Converting to
  // Number() rounds adjacent 64-bit owners together and silently drops one STOP.
  // When a value has ALREADY arrived as an unsafe JS number, do not guess its owner.
  const uniqueOwnerIds = new Set<string>()
  for (const row of owners || []) {
    const id = exactSessionOwnerId((row as any).owner_telegram_id)
    if (!id) throw new Error('ambiguous_reminder_optout_owner')
    uniqueOwnerIds.add(id)
  }
  const uniqueOwners = [...uniqueOwnerIds]
  if (!uniqueOwners.length) return 0

  const rows = uniqueOwners.map((owner) => ({
    owner_telegram_id: owner,
    recipient_whatsapp_id: recipient,
  }))
  const { error: upErr } = await supabaseAdmin
    .from('reminder_optout')
    .upsert(rows, { onConflict: 'owner_telegram_id,recipient_whatsapp_id' })
  if (upErr) throw upErr

  return rows.length
}

/** Send-path gate: is this (owner, recipient) pair suppressed? The two-column lookup.
 *  THROWS on any DB error — the cron caller fails CLOSED (does not send) on throw. */
export async function isSuppressed(ownerTelegramId: number | string, recipientWhatsappId: string): Promise<boolean> {
  // An ambiguous owner must never authorize a notification send. Callers treat
  // thrown gate errors as send denial; a false/empty opt-out is not proof of consent.
  const owner = exactSessionOwnerId(ownerTelegramId)
  if (!owner) throw new Error('ambiguous_reminder_optout_owner')
  const recipient = normalizePhoneNumber(recipientWhatsappId) // <-- NORMALISE (read side)
  if (!recipient) throw new Error('invalid_reminder_optout_recipient')

  const { data, error } = await supabaseAdmin
    .from('reminder_optout')
    .select('owner_telegram_id')
    .eq('owner_telegram_id', owner)
    .eq('recipient_whatsapp_id', recipient)
    .maybeSingle()
  if (error) throw error
  return !!data
}
