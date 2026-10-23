// Approval card v2 (approved 23 Oct mock): every card says the exact action, who/what it touches (from the stored
// payload_preview), what happens when you say yes, why Gogo is asking, and when the card expires. "Later" defers
// the card without approving or rejecting anything. Pure helpers; no database or network.
import { approvalExplicitExpiry, APPROVAL_TTL_HOURS } from './approval-ttl'

export const DEFER_HOURS = 4

const ACTION: Record<string, { label: string; happens: string; yes: string }> = {
  email_send: { label: 'Send an email', happens: 'One email is sent from your account. It cannot be unsent.', yes: 'Send it' },
  gmail_send: { label: 'Send an email', happens: 'One email is sent from your account. It cannot be unsent.', yes: 'Send it' },
  calendar_change: { label: 'Change your calendar', happens: 'Your Google Calendar is updated once, exactly as shown.', yes: 'Update calendar' },
  reminder_change: { label: 'Move a reminder', happens: 'The reminder moves to the new time shown.', yes: 'Move it' },
  browser_action: { label: 'Act on a website', happens: 'Gogo does only the step shown on that website. It never pays without you.', yes: 'Go ahead' },
  booking: { label: 'Make a booking', happens: 'A booking request is sent to the provider. Payment, if any, still waits for you.', yes: 'Book it' },
  reservation: { label: 'Reserve a table', happens: 'A reservation request is sent. Payment, if any, still waits for you.', yes: 'Reserve it' },
  purchase: { label: 'Buy something', happens: 'Gogo prepares checkout up to payment. You pay yourself.', yes: 'Prepare checkout' },
  call: { label: 'Make a call', happens: 'Gogo calls once, says only what is shown, and reports back.', yes: 'Call now' },
}

export function approvalAction(actionType: unknown) {
  const t = String(actionType || '').toLowerCase()
  const key = Object.keys(ACTION).find(k => t === k) || Object.keys(ACTION).find(k => t.includes(k.split('_')[0]))
  return key ? ACTION[key] : { label: 'Needs your yes', happens: 'Gogo does exactly this action, once.', yes: 'Approve & run' }
}

export type PreviewRow = { label: string; value: string }
/** The stored preview rows, cleaned. Risk is shown separately, never as a row. */
export function previewRows(preview: unknown): PreviewRow[] {
  return (Array.isArray(preview) ? preview : [])
    .map((r: any) => ({ label: String(r?.label || '').trim().slice(0, 40), value: String(r?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) }))
    .filter(r => r.label && r.value && !/^risk$/i.test(r.label))
    .slice(0, 8)
}

/** When this card stops being approvable: the explicit expiry, else requested + 24 h. Null when unknown. */
export function approvalExpiresAt(row: { requested_at?: string | null; expires_at?: string | null; execution_payload?: unknown }): string | null {
  const explicit = approvalExplicitExpiry(row)
  if (explicit != null) return new Date(explicit).toISOString()
  const req = Date.parse(String(row?.requested_at || ''))
  return Number.isFinite(req) ? new Date(req + APPROVAL_TTL_HOURS * 3_600_000).toISOString() : null
}

export function whenLabel(iso: string | null | undefined, now = new Date(), tz = 'Asia/Kolkata'): string {
  const ms = Date.parse(String(iso || ''))
  if (!Number.isFinite(ms)) return ''
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(ms))
  const tomorrow = new Date(now.getTime() + 86_400_000)
  const prefix = day(new Date(ms)) === day(now) ? 'today' : day(new Date(ms)) === day(tomorrow) ? 'tomorrow' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(ms))
  return `${prefix} ${time}`
}

/** Latest deferral per approval from agent_activity rows; only deferrals still in the future count. */
export function activeDeferrals(rows: any[], now = Date.now()): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows || []) {
    const id = String(r?.metadata_json?.approval_id || '')
    const until = String(r?.metadata_json?.until || '')
    const ms = Date.parse(until)
    if (!id || !Number.isFinite(ms) || ms <= now) continue
    const prev = out.get(id)
    if (!prev || Date.parse(prev) < ms) out.set(id, new Date(ms).toISOString())
  }
  return out
}

export function parseDeferHours(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 && n <= 24 ? Math.round(n) : DEFER_HOURS
}
