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

type ClosureAction = { status: string; payload_json: any }
const UNCERTAIN = ['outcomeUnknown', 'sendStarted', 'reconciliationRequired', 'deviceHandoffRequired', 'providerBlock', 'leaseUntil', 'closedAt', 'receipt', 'unresolvedAttempts']

/** The event's booking-closure action, 'missing' when there verifiably is none, 'unreadable' when it could not be read. */
async function existingClosureAction(lifeEventId: string, telegramId: number): Promise<ClosureAction | 'missing' | 'unreadable'> {
  try {
    const { data, error } = await supabaseAdmin.from('life_event_actions').select('status,payload_json')
      .eq('life_event_id', lifeEventId).eq('telegram_id', String(telegramId)).eq('action_key', 'booking-closure').limit(1)
    if (error || !Array.isArray(data)) return 'unreadable'
    return data[0] ? { status: String(data[0].status || ''), payload_json: data[0].payload_json || {} } : 'missing'
  } catch { return 'unreadable' }
}

/** Only a plain failure, with no evidence that work started or a provider effect may have happened, is re-armed. */
function retryable(a: ClosureAction) {
  return (a.status === 'failed' || a.status === 'cancelled') && !UNCERTAIN.some(k => a.payload_json?.[k])
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
    const registered = await registerLifeEvent({
      telegramId: params.telegramId,
      eventType: 'event',
      subtype: /movie|watching|cinema|theatre/i.test(params.text) ? 'movie_booking' : 'event_booking',
      source: 'whatsapp_booking_link',
      title,
      provider,
      metadata: { bookingUrl: url, closureQueued: true, schedulePending: true },
      sourceRefs: [{ source: 'whatsapp', kind: 'booking_link', url }],
    })
    event = { id:registered.id, metadata_json:{bookingUrl:url,closureQueued:true,schedulePending:true}, source_refs:[{source:'whatsapp',kind:'booking_link',url}], title, provider }
  }
  const lifeEventId = String(event.id)
  const nowDate = new Date()
  const now = nowDate.toISOString()

  // 31 Oct review: a re-forwarded link must never re-arm closure work that is done, running, blocked on a person, or
  // whose provider effect is unknown. Once this event's closure was durably queued (closureQueuedAt is written only
  // after the queue upsert succeeded), the action is left untouched unless it is verifiably missing or a plain
  // failure with no uncertain-outcome evidence. If its state cannot be read, nothing is re-armed.
  let prior: ClosureAction | null = null
  if (event.metadata_json?.closureQueuedAt) {
    const existing = await existingClosureAction(lifeEventId, params.telegramId)
    if (existing !== 'missing' && existing !== 'unreadable') prior = existing
    if (existing !== 'missing' && !(existing !== 'unreadable' && retryable(existing))) {
      const { error: touchError } = await supabaseAdmin.from('life_events').update({
        metadata_json: { ...(event.metadata_json || {}), lastForwardedAt: now },
        updated_at: now,
      }).eq('id', lifeEventId).eq('telegram_id', String(params.telegramId))
      if (touchError) console.error('BOOKING_CLOSURE_EVENT_UPDATE_FAILED:', touchError.message)
      const done = existing !== 'unreadable' && existing.status === 'completed'
      return {
        lifeEventId,
        text: done
          ? `🎟️ *This booking is already done.*\n\nI sent the completed booking and ticket/QR here earlier; I'm not starting it again. Ask me for the ticket any time.`
          : `🎟️ *I already have this booking link.*\n\nI'm not starting it again; I'll send the result here as soon as it's ready.`,
      }
    }
  }
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
  // A plain failure being retried keeps its earlier evidence alongside the new request.
  if (prior) Object.assign(payload, { ...(prior.payload_json || {}), ...payload, retriedFrom: prior.status })
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

