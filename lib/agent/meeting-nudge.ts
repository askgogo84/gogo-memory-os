// "Your Daily Connect-Standup starts at 11:30am, in about 8 minutes" + the Meet link (23 Oct, Instinct side by side).
// Every minute (autonomous-runs cron): meetings already found by the open-loops sync (meeting_prep items, complete
// calendar reads only) that start in the next 10 minutes get ONE WhatsApp nudge with the join link. No calendar
// call here; the delivery ledger key makes it once per meeting; the owner's Calendar topic and quiet hours apply.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import { deliverNotification } from '@/lib/services/notification-delivery'
import { recordCostEvent } from '@/lib/services/cost-guard'
import { getAlertPreferences, isQuietHour } from './alert-preferences'
import { safeMeetLink } from './meeting-prep'

const MIN = 60_000
export const NUDGE_LEAD_MIN = 10

export function meetingNudgeText(p: { name: string; startsAt: string; meetLink?: string | null; now: number; tz: string }): string {
  const start = Date.parse(p.startsAt)
  const mins = Math.max(1, Math.round((start - p.now) / MIN))
  const at = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: p.tz }).format(new Date(start)).replace(' ', '')
  const link = safeMeetLink(p.meetLink)
  return `📅 Your ${p.name} starts at ${at}, in about ${mins} minute${mins === 1 ? '' : 's'}.${link ? `\n${link}` : ''}`
}

/** A service-role meeting notification must never infer a recipient from an imprecise owner. */
function canonicalMeetingOwner(value: unknown): { id: string; numeric: number } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const id = String(value)
  if (!/^-?[1-9]\d*$/.test(id)) return null
  const numeric = Number(id)
  return Number.isSafeInteger(numeric) && String(numeric) === id ? { id, numeric } : null
}

async function verifiedMeetingRecipient(ownerId: string): Promise<{ whatsappId: string; timezone: string } | null> {
  try {
    const { data, error } = await supabaseAdmin.from('users')
      .select('telegram_id,whatsapp_id,timezone,access_status')
      .eq('telegram_id', ownerId).maybeSingle()
    if (error || !data || canonicalMeetingOwner(data.telegram_id)?.id !== ownerId || data.access_status === 'blocked') return null
    const whatsappId = String(data.whatsapp_id || '').trim()
    if (!whatsappId) return null
    return { whatsappId, timezone: String(data.timezone || 'Asia/Kolkata') }
  } catch { return null }
}

export async function processMeetingNudges(now = new Date(), limit = 30) {
  const nowIso = now.toISOString(), soon = new Date(now.getTime() + NUDGE_LEAD_MIN * MIN + 30_000).toISOString()
  const { data, error } = await supabaseAdmin.from('agent_open_loops').select('id,telegram_id,source_id,title,due_at,evidence_json')
    .eq('source_type', 'meeting_prep').eq('status', 'active').gt('due_at', nowIso).lte('due_at', soon).order('due_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`meeting_nudge_read_failed:${error.message}`)
  let sent = 0, skipped = 0
  for (const loop of (data || []) as any[]) {
    const identity = canonicalMeetingOwner(loop.telegram_id)
    if (!identity) { skipped++; continue }
    const { id: tg, numeric: owner } = identity
    const prefs = await getAlertPreferences(tg).catch(() => null)
    const user = await verifiedMeetingRecipient(tg)
    if (!prefs || !user || prefs.topics.calendar === false) { skipped++; continue }
    const tz = user.timezone
    let quiet = true
    try {
      const hour = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(now))
      quiet = isQuietHour(prefs, hour)
    } catch { /* Unknown timezone or preference state: do not send. */ }
    if (quiet) { skipped++; continue }
    const recipient = user.whatsappId
    const ev = loop.evidence_json || {}
    const name = String(ev.meetingName || String(loop.title || '').replace(/^Prepare for\s+/i, '').replace(/\s+·\s+.*$/, '') || 'meeting').slice(0, 100)
    const message = meetingNudgeText({ name, startsAt: String(ev.startsAt || loop.due_at), meetLink: ev.meetLink, now: now.getTime(), tz })
    const status = await deliverNotification({
      key: `meeting-nudge/${loop.source_id}`, source: 'watch_alert', owner, channel: 'whatsapp', due: nowIso, deadline: Date.now() + 20_000,
      prepare: async () => {},
      // Recheck the exact loop, owner, recipient and latest calendar-topic consent.
      // Earlier consent or phone data is not authority for a later outbound attempt.
      ready: async () => {
        try {
          const { data: again, error: loopError } = await supabaseAdmin.from('agent_open_loops')
            .select('status,due_at,telegram_id').eq('id', loop.id).eq('telegram_id', tg).maybeSingle()
          if (loopError || canonicalMeetingOwner(again?.telegram_id)?.id !== tg ||
            again?.status !== 'active' || String(again.due_at) !== String(loop.due_at)) return false
          const [currentUser, currentPrefs] = await Promise.all([
            verifiedMeetingRecipient(tg),
            getAlertPreferences(tg).catch(() => null),
          ])
          if (!currentUser || currentUser.whatsappId !== recipient || !currentPrefs ||
            currentPrefs.topics.calendar === false) return false
          const hour = Number(new Intl.DateTimeFormat('en-US', {
            hour: '2-digit', hourCycle: 'h23', timeZone: currentUser.timezone,
          }).format(new Date()))
          return !isQuietHour(currentPrefs, hour)
        } catch { return false }
      },
      accepted: async () => { await recordCostEvent({ telegramId: tg, category: 'whatsapp_outbound', metadata: { source: 'meeting_nudge' } }).catch(() => {}) },
      send: async token => String((await sendWhatsApp(recipient, message, null, token))?.sid || ''),
    }).catch(() => 'failed')
    if (['provider_accepted', 'delivered', 'read', 'sent'].includes(String(status))) sent++
  }
  return { checked: (data || []).length, sent, skipped }
}
