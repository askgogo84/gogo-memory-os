// One generic nudge after a quiet spell (4 Nov, owner: "only when they don't check in for 2 or 3 days we can push one
// generic msg like what wajo does"). Someone who messaged Gogo in the last 30 days but not in the last 3 gets ONE
// short message, and never another until they write again. Reminders, watches and everything they asked for keep
// running; nothing else is volunteered (lib/channels/proactive-policy.ts).
import { supabaseAdmin } from '@/lib/supabase-admin'

export const QUIET_DAYS = 3
export const ACTIVE_WINDOW_DAYS = 30
export const REENGAGE_TEXT = "👋 Gogo here. It's been a few days. Your reminders and watches are still running. Reply anything, even hi, whenever you need me."
const DAY = 86_400_000

/** Who gets the nudge: quiet for QUIET_DAYS+, active within ACTIVE_WINDOW_DAYS, and not already nudged since their last message. */
export function pickQuietUsers(lastInbound: Map<string, number>, lastNudge: Map<string, number>, now: number, limit = 200): string[] {
  const out: string[] = []
  for (const [tg, at] of lastInbound) {
    if (!Number.isFinite(at)) continue
    const quiet = now - at
    if (quiet < QUIET_DAYS * DAY || quiet > ACTIVE_WINDOW_DAYS * DAY) continue
    const nudged = lastNudge.get(tg)
    if (nudged !== undefined && nudged >= at) continue // already nudged in this quiet spell
    out.push(tg)
    if (out.length >= limit) break
  }
  return out
}

/** Only in daytime India hours, so a nudge never lands at night. */
export function inSendWindow(now: number) {
  const h = new Date(now + 330 * 60_000).getUTCHours()
  return h >= 10 && h < 19
}

type Sender = (to: string, text: string) => Promise<unknown>

export async function runReengagePass(now = Date.now(), send?: Sender) {
  if (!inSendWindow(now)) return { ok: true, skipped: 'outside_window', sent: 0 }
  const since = new Date(now - ACTIVE_WINDOW_DAYS * DAY).toISOString()
  const { data: msgs, error } = await supabaseAdmin.from('conversations').select('telegram_id,created_at').eq('role', 'user').gte('created_at', since).order('created_at', { ascending: false }).limit(20000)
  if (error) return { ok: false, reason: `conversations_read_failed:${error.message}`, sent: 0 }
  const lastInbound = new Map<string, number>()
  for (const m of (msgs || []) as any[]) { const tg = String(m.telegram_id); if (!lastInbound.has(tg)) lastInbound.set(tg, Date.parse(m.created_at)) }
  const { data: nudges, error: nErr } = await supabaseAdmin.from('agent_activity').select('telegram_id,created_at').eq('event_type', 'reengagement_sent').gte('created_at', since).order('created_at', { ascending: false }).limit(5000)
  if (nErr) return { ok: false, reason: `nudges_read_failed:${nErr.message}`, sent: 0 } // unknown history: send nothing
  const lastNudge = new Map<string, number>()
  for (const n of (nudges || []) as any[]) { const tg = String(n.telegram_id); if (!lastNudge.has(tg)) lastNudge.set(tg, Date.parse(n.created_at)) }
  const picked = pickQuietUsers(lastInbound, lastNudge, now)
  const sender: Sender = send || (async (to, text) => (await import('@/lib/whatsapp')).sendWhatsAppReminderTemplate(to, text))
  let sent = 0
  const errors: string[] = []
  for (const tg of picked) {
    const { data: user } = await supabaseAdmin.from('users').select('whatsapp_id,access_status').eq('telegram_id', tg).maybeSingle()
    if (!user?.whatsapp_id || (user.access_status && user.access_status !== 'active')) continue
    // Record first, then send: a crash between the two can only skip a nudge, never send two.
    const { error: logErr } = await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'reengagement_sent', message: REENGAGE_TEXT, metadata_json: { quiet_since: new Date(lastInbound.get(tg)!).toISOString() } })
    if (logErr) { errors.push(`log_failed:${logErr.message.slice(0, 60)}`); continue }
    try { await sender(String(user.whatsapp_id), REENGAGE_TEXT); sent++ } catch (e: any) { errors.push(`send_failed:${String(e?.message || e).slice(0, 60)}`) }
  }
  return { ok: true, considered: lastInbound.size, picked: picked.length, sent, errors }
}
