import { createHash } from 'node:crypto'

function safe(value: unknown, max = 1200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function validIso(value: unknown) {
  const text = safe(value, 120)
  if (!text) return ''
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

function validHttpUrl(value: unknown) {
  const text = safe(value, 1200)
  if (!text) return ''
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export type LifeEventCalendarInput = {
  lifeEventId: string
  lifeEventActionId?: string
  title: string
  startAt: string
  endAt: string
  timezone: string
  location?: string | null
  provider?: string | null
  sourceUrl?: string | null
  endEstimated?: boolean
}

export function calendarInputFromLifeEvent(event: any, action?: any): LifeEventCalendarInput | null {
  if (!['event', 'appointment', 'reservation'].includes(String(event?.event_type || ''))) return null
  const startAt = validIso(event?.start_at)
  if (!startAt) return null

  const explicitEnd = validIso(event?.end_at)
  const defaultMinutes = event?.event_type === 'event' ? 120 : 60
  const estimatedEnd = new Date(Date.parse(startAt) + defaultMinutes * 60_000).toISOString()
  const endAt = explicitEnd && Date.parse(explicitEnd) > Date.parse(startAt) ? explicitEnd : estimatedEnd
  const metadata = event?.metadata_json || {}
  const sourceUrl = validHttpUrl(metadata.sourceUrl || metadata.bookingUrl || metadata.statusUrl || '') || null

  return {
    lifeEventId: safe(event?.id, 80),
    lifeEventActionId: action?.id ? safe(action.id, 80) : undefined,
    title: safe(event?.title || 'AskGogo event', 240),
    startAt,
    endAt,
    timezone: safe(event?.timezone || 'Asia/Kolkata', 100),
    location: safe(event?.location, 300) || null,
    provider: safe(event?.provider, 180) || null,
    sourceUrl,
    endEstimated: !explicitEnd,
  }
}

export type LifecycleMonitorTarget = {
  url: string
  cadenceMinutes: number
  objective: string
}

export function lifecycleMonitorTarget(event: any, action?: any): LifecycleMonitorTarget | null {
  const eventType = String(event?.event_type || '')
  if (!['purchase', 'delivery', 'application', 'event'].includes(eventType)) return null
  const payload = action?.payload_json || {}
  const metadata = event?.metadata_json || {}
  const url = validHttpUrl(
    payload.statusUrl || payload.trackingUrl || payload.sourceUrl ||
    metadata.statusUrl || metadata.trackingUrl || metadata.sourceUrl || metadata.bookingUrl || ''
  )
  if (!url) return null

  const cadenceMinutes = eventType === 'delivery' ? 60 : eventType === 'purchase' ? 180 : eventType === 'application' ? 360 : 180
  const objective = eventType === 'delivery' || eventType === 'purchase'
    ? 'Read the current order or delivery status only. Do not sign in, submit forms, cancel, return, reorder, purchase, or change the order.'
    : eventType === 'application'
      ? 'Read the current application status only. Do not submit, withdraw, accept, reject, edit, or sign anything.'
      : 'Read the current event timing, venue, cancellation or reschedule status only. Do not book, cancel, submit, or change the reservation.'
  return { url, cadenceMinutes, objective }
}

export type LifecycleTerminal = { terminal: boolean; label: string | null }
export type LifecycleTerminalContext = {
  title?: string | null
  confirmationRef?: string | null
  provider?: string | null
}

function anchoredStatusText(text: string, context?: LifecycleTerminalContext) {
  const reference = safe(context?.confirmationRef, 240).toLowerCase()
  if (reference.length >= 4) {
    const index = text.indexOf(reference)
    if (index >= 0) {
      return {
        anchored: true,
        text: text.slice(index, Math.min(text.length, index + reference.length + 420)),
      }
    }
  }

  const title = safe(context?.title, 240).toLowerCase()
  if (title.length >= 6) {
    const index = text.indexOf(title)
    if (index >= 0) {
      return {
        anchored: true,
        text: text.slice(index, Math.min(text.length, index + title.length + 420)),
      }
    }
  }
  return { anchored: false, text }
}

function commerceTerminalState(text: string, anchored: boolean): LifecycleTerminal {
  const delivered = anchored
    ? /\b(delivered|delivery complete|package delivered)\b/
    : /\b(your (?:order|package|shipment) (?:has been|was|is) delivered|current status\s*[:\-]?\s*delivered|order status\s*[:\-]?\s*delivered|package (?:has been|was) delivered)\b/
  const refunded = anchored
    ? /\b(refund(?:ed)?|refunded successfully)\b/
    : /\b(your (?:order )?refund (?:has been|was|is) (?:completed|processed)|refund status\s*[:\-]?\s*(?:completed|refunded)|refunded successfully)\b/
  const cancelled = anchored
    ? /\b(order )?(cancelled|canceled)\b/
    : /\b(your order (?:has been|was|is) (?:cancelled|canceled)|order status\s*[:\-]?\s*(?:cancelled|canceled))\b/

  if (delivered.test(text)) return { terminal: true, label: 'delivered' }
  if (refunded.test(text)) return { terminal: true, label: 'refunded' }
  if (cancelled.test(text)) return { terminal: true, label: 'cancelled' }
  return { terminal: false, label: null }
}

export function lifecycleTerminalState(eventType: string, pageText: unknown, context?: LifecycleTerminalContext): LifecycleTerminal {
  const text = safe(pageText, 12000).toLowerCase()
  if (!text) return { terminal: false, label: null }
  if (eventType === 'delivery' || eventType === 'purchase') {
    const focused = anchoredStatusText(text, context)
    return commerceTerminalState(focused.text, focused.anchored)
  }
  if (eventType === 'application') {
    if (/\b(approved|accepted|offer extended|selected)\b/.test(text)) return { terminal: true, label: 'approved' }
    if (/\b(rejected|declined|not selected|unsuccessful)\b/.test(text)) return { terminal: true, label: 'closed' }
    if (/\bwithdrawn\b/.test(text)) return { terminal: true, label: 'withdrawn' }
  }
  if (eventType === 'event') {
    if (/\b(event )?(cancelled|canceled)\b/.test(text)) return { terminal: true, label: 'cancelled' }
  }
  return { terminal: false, label: null }
}

export function lifecycleFingerprint(title: unknown, pageText: unknown) {
  const normalized = `${safe(title, 500)}\n${safe(pageText, 6000)}`.toLowerCase()
  return createHash('sha256').update(normalized).digest('hex')
}
