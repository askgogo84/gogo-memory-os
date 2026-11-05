// The one question an image/PDF reply ends with ("Want me to remind you on 3 Dec at 10 am to …?") is saved with
// the exact instruction it stands for. A plain "yes" right after it becomes that instruction, so the normal
// reminder/calendar flow creates the real thing (5 Nov live: chat said "I've set a reminder" and made none).
// Owner-scoped; the id stays a string.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { OFFER_EVENT, OFFER_MINUTES, isPlainYes, type ImageOffer } from '@/lib/services/image-note-reader'

export async function saveImageOffer(telegramId: string | number, offer: ImageOffer | null) {
  if (!offer) return
  const { error } = await supabaseAdmin.from('agent_activity').insert({ telegram_id: String(telegramId), event_type: OFFER_EVENT, message: offer.question.slice(0, 200), metadata_json: { instruction: offer.instruction, question: offer.question } })
  if (error) console.error('IMAGE_OFFER_SAVE_FAILED:', error.message)
}

/** The instruction a "yes" stands for, or null. Valid only while the offer is Gogo's latest message (30 min). */
export async function takeImageOffer(telegramId: string | number, text: string): Promise<string | null> {
  if (!isPlainYes(text)) return null
  const tg = String(telegramId)
  const since = new Date(Date.now() - OFFER_MINUTES * 60_000).toISOString()
  const [{ data: events }, { data: last }] = await Promise.all([
    supabaseAdmin.from('agent_activity').select('id,event_type,metadata_json,created_at').eq('telegram_id', tg).in('event_type', [OFFER_EVENT, `${OFFER_EVENT}_used`]).gte('created_at', since).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('conversations').select('content').eq('telegram_id', tg).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1),
  ])
  const row: any = events?.[0]
  if (!row || row.event_type !== OFFER_EVENT) return null
  const question = String(row.metadata_json?.question || ''), instruction = String(row.metadata_json?.instruction || '')
  const latest = String((last as any)?.[0]?.content || '').trim()
  if (!question || !instruction || !latest.endsWith(question)) return null
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: `${OFFER_EVENT}_used`, message: 'Offer accepted.', metadata_json: { instruction } }).then(() => {}, () => {})
  return instruction
}
