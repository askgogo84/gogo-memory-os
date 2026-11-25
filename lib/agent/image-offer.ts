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


// Accept an explicit standalone clock, not a bare number, a date change, or a compound instruction.
// In particular, 4.15pm is a clock override; 4:15 without AM/PM is ambiguous.
function explicitOfferClock(text: string): { hour: number; minute: number } | null {
  const m = String(text || '').trim().match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?$/i)
  if (!m) return null
  let hour = Number(m[1])
  const minute = Number(m[2] || '0'), meridiem = m[3]?.toLowerCase()
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12 + (meridiem === 'pm' ? 12 : 0)
  } else if (!m[2] || hour > 23 || (hour >= 1 && hour <= 12)) {
    return null
  }
  return { hour, minute }
}

export function isImageOfferReply(text: string): boolean {
  return isPlainYes(text) || explicitOfferClock(text) !== null
}

// The stored generated reminder instruction supplies the date and subject, not the new reply.
// Change only the clock token, validate both parses, and refuse a past or shifted date.
// Calendar offers (which have no validated reminder timestamp) cannot be rewritten.
async function reminderClockOverride(instruction: string, at: unknown, clock: { hour: number; minute: number }): Promise<string | null> {
  if (typeof at !== 'string') return null
  const originalMs = Date.parse(at)
  if (!Number.isFinite(originalMs) || originalMs <= Date.now()) return null
  const parts = instruction.match(/^(remind me (?:today|on \d{1,2} [a-z]+ \d{4}) at )(\d{1,2}(?::\d{2})?(?:am|pm))( to .+)$/i)
  if (!parts) return null
  const day = new Date(originalMs + 330 * 60_000).toISOString().slice(0, 10)
  const hh = String(clock.hour).padStart(2, '0'), mm = String(clock.minute).padStart(2, '0')
  const targetMs = Date.parse(day + 'T' + hh + ':' + mm + ':00+05:30')
  if (!Number.isFinite(targetMs) || targetMs <= Date.now()) return null
  const replacement = String(clock.hour % 12 || 12) + (clock.minute ? ':' + mm : '') + (clock.hour >= 12 ? 'pm' : 'am')
  const rewritten = parts[1] + replacement + parts[3]
  const { parseReminderIntent } = await import('@/lib/bot/handlers/reminders')
  const before = parseReminderIntent(instruction)
  const after = parseReminderIntent(rewritten)
  if (before?.kind !== 'one_time' || before.remindAtIso !== new Date(originalMs).toISOString()
    || after?.kind !== 'one_time' || after.remindAtIso !== new Date(targetMs).toISOString()
    || !before.message || after.message !== before.message) return null
  return rewritten
}

export async function saveImageOffer(telegramId: string | number, offer: ImageOffer | null) {
  const owner = exactOwnerId(telegramId)
  if (!owner || !offer) return
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: owner,
    event_type: OFFER_EVENT,
    message: offer.question.slice(0, 200),
    metadata_json: { instruction: offer.instruction, question: offer.question, ...(offer.at ? { at: offer.at } : {}) },
  })
  if (error) console.error('IMAGE_OFFER_SAVE_FAILED:', error.message)
}

/** A yes or explicit replacement clock dispatches only after an atomic owner-scoped claim. */
export async function takeImageOffer(telegramId: string | number, text: string): Promise<string | null> {
  const yes = isPlainYes(text)
  const clock = yes ? null : explicitOfferClock(text)
  if (!yes && !clock) return null
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

    const resolvedInstruction = clock ? await reminderClockOverride(instruction, row.metadata_json?.at, clock) : instruction
    if (!resolvedInstruction) return null

    // PostgreSQL performs this guarded update atomically on the existing UUID row.
    // A racing webhook, different owner or previously-used offer matches zero rows.
    // A failed/unknown DB result returns null and is NEVER blindly retried.
    const { data: claimed, error: claimError } = await supabaseAdmin.from('agent_activity')
      .update({ event_type: `${OFFER_EVENT}_used` })
      .eq('id', row.id).eq('telegram_id', owner).eq('event_type', OFFER_EVENT)
      .select('id').maybeSingle()
    if (claimError || !claimed || String(claimed.id) !== row.id) return null
    return resolvedInstruction
  } catch {
    return null
  }
}
