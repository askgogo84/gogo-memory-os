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

export async function processMeetingNudges(now = new Date(), limit = 30) {
  const nowIso = now.toISOString(), soon = new Date(now.getTime() + NUDGE_LEAD_MIN * MIN + 30_000).toISOString()
  const { data, error } = await supabaseAdmin.from('agent_open_loops').select('id,telegram_id,source_id,title,due_at,evidence_json')
    .eq('source_type', 'meeting_prep').eq('status', 'active').gt('due_at', nowIso).lte('due_at', soon).order('due_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`meeting_nudge_read_failed:${error.message}`)
  let sent = 0, skipped = 0
  for (const loop of (data || []) as any[]) {
    const tg = String(loop.telegram_id)
    const owner = Number(tg)
    if (!Number.isSafeInteger(owner)) { skipped++; continue }
    const prefs = await getAlertPreferences(tg).catch(() => null)
    const { data: user } = await supabaseAdmin.from('users').select('whatsapp_id,timezone').eq('telegram_id', owner).maybeSingle()
    const tz = String(user?.timezone || 'Asia/Kolkata')
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(now))
    if (!prefs || prefs.topics.calendar === false || isQuietHour(prefs, hour) || !user?.whatsapp_id) { skipped++; continue }
    const ev = loop.evidence_json || {}
    const name = String(ev.meetingName || String(loop.title || '').replace(/^Prepare for\s+/i, '').replace(/\s+·\s+.*$/, '') || 'meeting').slice(0, 100)
    const message = meetingNudgeText({ name, startsAt: String(ev.startsAt || loop.due_at), meetLink: ev.meetLink, now: now.getTime(), tz })
    const status = await deliverNotification({
      key: `meeting-nudge/${loop.source_id}`, source: 'watch_alert', owner, channel: 'whatsapp', due: nowIso, deadline: Date.now() + 20_000,
      prepare: async () => {},
      // Still on: the meeting was not moved or resolved since we looked.
      ready: async () => {
        const { data: again } = await supabaseAdmin.from('agent_open_loops').select('status,due_at').eq('id', loop.id).eq('telegram_id', tg).maybeSingle()
        return again?.status === 'active' && String(again.due_at) === String(loop.due_at)
      },
      accepted: async () => { await recordCostEvent({ telegramId: tg, category: 'whatsapp_outbound', metadata: { source: 'meeting_nudge' } }).catch(() => {}) },
      send: async token => String((await sendWhatsApp(String(user.whatsapp_id), message, null, token))?.sid || ''),
    }).catch(() => 'failed')
    if (['provider_accepted', 'delivered', 'read', 'sent'].includes(String(status))) sent++
  }
  return { checked: (data || []).length, sent, skipped }
}
