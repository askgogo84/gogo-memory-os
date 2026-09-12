import { supabaseAdmin } from '@/lib/supabase-admin'
import { registerLifeEvent } from './life-event-engine'

function safe(v: unknown, max = 600) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function firstUrl(text: string) { const m = String(text || '').match(/https?:\/\/[^\s<>]+/i); return m ? m[0].replace(/[),.;!?]+$/, '') : '' }
function providerFrom(text: string, url: string) {
  const h = `${text} ${url}`.toLowerCase()
  if (/bookmyshow|bmsurl\.co/.test(h)) return 'BookMyShow'
  if (/district\.in/.test(h)) return 'District'
  if (/insider\.in/.test(h)) return 'Insider'
  if (/ticketmaster/.test(h)) return 'Ticketmaster'
  return 'Booking provider'
}
function titleFrom(text: string) {
  const raw = String(text || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  const watching = raw.match(/we(?:'|’)re\s+watching\s+(.+?)(?=\.\s*(?:find|here|ticket)|\s+find\s+ticket|$)/i)
  if (watching?.[1]) return watching[1].trim().slice(0, 180)
  return 'Event booking'
}

async function existingByUrl(telegramId: number, url: string) {
  const { data } = await supabaseAdmin.from('life_events')
    .select('id,metadata_json,source_refs,title,provider')
    .eq('telegram_id', String(telegramId)).eq('event_type', 'event')
    .order('updated_at', { ascending: false }).limit(40)
  return (data || []).find((row: any) => {
    const refs = Array.isArray(row.source_refs) ? row.source_refs : []
    const known = [row.metadata_json?.bookingUrl, row.metadata_json?.resolvedUrl, ...refs.map((r: any) => r?.url)].filter(Boolean).map(String)
    return known.includes(url)
  }) || null
}

function bookingWorkerDueAt(now: Date) {
  // The generic life-event cron runs earlier in the minute than the dedicated
  // booking cron. Make booking closure visible just before the dedicated worker
  // so it cannot be consumed by the generic prepare-step handler first.
  const due = new Date(now)
  due.setUTCSeconds(45, 0)
  if (due.getTime() <= now.getTime()) due.setUTCMinutes(due.getUTCMinutes() + 1)
  return due.toISOString()
}

export async function queueBookingClosure(params: { telegramId: number; text: string; whatsappTo: string }) {
  const url = firstUrl(params.text)
  if (!url) return null
  const provider = providerFrom(params.text, url)
  const title = titleFrom(params.text)
  let event = await existingByUrl(params.telegramId, url)
  if (!event) {
    event = await registerLifeEvent({
      telegramId: params.telegramId,
      eventType: 'event',
      subtype: /movie|watching|cinema|theatre/i.test(params.text) ? 'movie_booking' : 'event_booking',
      source: 'whatsapp_booking_link',
      title,
      provider,
      metadata: { bookingUrl: url, closureQueued: true, schedulePending: true },
      sourceRefs: [{ source: 'whatsapp', kind: 'booking_link', url }],
    })
  }
  const lifeEventId = String(event.id)
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const dueAt = bookingWorkerDueAt(nowDate)
  const payload = {
    originalText: String(params.text || '').slice(0, 4000),
    whatsappTo: params.whatsappTo,
    bookingUrl: url,
    queuedAt: now,
    dedicatedWorker: 'booking-events',
  }

  // One action per Life Event makes webhook retries/repeated forwards idempotent.
  // browser_prepare is intentionally NOT the generic prepare action type: the
  // dedicated booking worker owns this action key and performs the real closure.
  const { error } = await supabaseAdmin.from('life_event_actions').upsert({
    life_event_id: lifeEventId,
    telegram_id: String(params.telegramId),
    action_key: 'booking-closure',
    action_type: 'browser_prepare',
    capability: 'browser',
    title: `Resolve ${safe(title, 160)} booking`,
    due_at: dueAt,
    requires_approval: false,
    irreversible: false,
    status: 'ready',
    payload_json: payload,
    updated_at: now,
  }, { onConflict: 'life_event_id,action_key' })
  if (error) throw new Error(`booking_closure_queue_failed:${error.message}`)

  const { error: eventUpdateError } = await supabaseAdmin.from('life_events').update({
    lifecycle_state: 'captured',
    metadata_json: { ...(event.metadata_json || {}), bookingUrl: url, closureQueued: true, closureQueuedAt: now },
    updated_at: now,
  }).eq('id', lifeEventId).eq('telegram_id', String(params.telegramId))
  if (eventUpdateError) console.error('BOOKING_CLOSURE_EVENT_UPDATE_FAILED:', eventUpdateError.message)

  return {
    lifeEventId,
    text: `🎟️ *Got it — I’m handling this booking now.*\n\nI’m opening the provider link and checking your connected email in the background for the booking details and the actual provider-issued ticket/QR.\n\nI’ll send the completed booking back here with the ticket/QR, reminder and calendar action — you don’t need to reopen the link.`,
  }
}
