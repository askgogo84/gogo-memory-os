// A question offered by an image/PDF reply can be accepted only once by its exact owner.
// The claim must be atomic: two concurrent "yes" deliveries must never both dispatch the
// associated reminder/calendar instruction. The normal typed action still enforces approval
// and provider verification; claiming an offer is NOT proof that the action succeeded.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { OFFER_EVENT, OFFER_MINUTES, isPlainYes, type ImageOffer } from '@/lib/services/image-note-reader'

function exactOwnerId(id: string | number): string | null {
  if (typeof id === 'number' && !Number.isSafeInteger(id)) return null
  const value = String(id ?? '').trim()
  return /^-?[1-9]\d*$/.test(value) ? value : null
}

export async function saveImageOffer(telegramId: string | number, offer: ImageOffer | null) {
  const owner = exactOwnerId(telegramId)
  if (!owner || !offer) return
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: owner,
    event_type: OFFER_EVENT,
    message: offer.question.slice(0, 200),
    metadata_json: { instruction: offer.instruction, question: offer.question },
  })
  if (error) console.error('IMAGE_OFFER_SAVE_FAILED:', error.message)
}

/** A "yes" becomes its offered instruction only after a successful atomic owner-scoped claim. */
export async function takeImageOffer(telegramId: string | number, text: string): Promise<string | null> {
  if (!isPlainYes(text)) return null
  const owner = exactOwnerId(telegramId)
  if (!owner) return null
  const since = new Date(Date.now() - OFFER_MINUTES * 60_000).toISOString()
  try {
    const [{ data: events, error: offerError }, { data: last, error: conversationError }] = await Promise.all([
      supabaseAdmin.from('agent_activity').select('id,event_type,metadata_json,created_at')
        .eq('telegram_id', owner).in('event_type', [OFFER_EVENT, `${OFFER_EVENT}_used`])
        .gte('created_at', since).order('created_at', { ascending: false }).limit(1),
      supabaseAdmin.from('conversations').select('content').eq('telegram_id', owner)
        .eq('role', 'assistant').order('created_at', { ascending: false }).limit(1),
    ])
    // No unchecked or ambiguous DB read may authorize an action.
    if (offerError || conversationError) return null
    const row: any = events?.[0]
    if (!row || row.event_type !== OFFER_EVENT || typeof row.id !== 'string') return null
    const question = String(row.metadata_json?.question || '')
    const instruction = String(row.metadata_json?.instruction || '')
    const latest = String((last as any)?.[0]?.content || '').trim()
    if (!question || !instruction || !latest.endsWith(question)) return null

    // PostgreSQL performs this guarded update atomically on the existing UUID row.
    // A racing webhook, different owner or previously-used offer matches zero rows.
    // A failed/unknown DB result returns null and is NEVER blindly retried.
    const { data: claimed, error: claimError } = await supabaseAdmin.from('agent_activity')
      .update({ event_type: `${OFFER_EVENT}_used` })
      .eq('id', row.id).eq('telegram_id', owner).eq('event_type', OFFER_EVENT)
      .select('id').maybeSingle()
    if (claimError || !claimed || String(claimed.id) !== row.id) return null
    return instruction
  } catch {
    return null
  }
}
