// "What's scheduled" (Dots parity slice 1, 2 Nov): one numbered list of everything Gogo will do on its own —
// repeating reminders, one-time reminders in the next 7 days, active watches, goals, the morning briefing and
// Gogo's own check-ins — with the next run and the command that stops it. Read-only: saved state, exact owner,
// no writes, sends or provider calls. A source that fails to read is said, never reported as "nothing scheduled".
import { watchName, watchRule } from './watch-command'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { describeCadence } from '@/lib/services/reminder-series'
import type { AgentActor } from './actor'

/** Cut at a word boundary with an ellipsis, never mid-word. */
function shortTitle(v: string, max: number) {
  const t = clean(v, 400)
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:·—-]+$/, '')
  return `${cut || t.slice(0, max - 1)}…`
}
const clean = (v: unknown, max = 80) => String(v ?? '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)

/** "what's scheduled", "show my scheduled tasks", "what have you scheduled for me". Never "my schedule today" (calendar). */
export function isScheduledListQuery(text: string) {
  const t = String(text || '').trim().toLowerCase().replace(/[?.!]+$/, '').replace(/\s+/g, ' ')
  if (/\b(?:today|tonight|tomorrow|this week|next week|on (?:mon|tue|wed|thu|fri|sat|sun)|calendar|meetings?)\b/.test(t)) return false
  return /^(?:what(?:'s| is| all is)?|show(?: me)?|list|see|view)?\s*(?:all\s+)?(?:my\s+)?(?:scheduled(?: (?:tasks|things|jobs|items|stuff|work|reminders))?|schedules|recurring (?:tasks|reminders|jobs)|repeating (?:tasks|reminders))(?: (?:with|in|on|for) (?:you|gogo|askgogo|me))?$/.test(t)
    || /^what (?:have you|did you|do you have|has gogo|is gogo) (?:got )?scheduled(?: for me)?$/.test(t)
    || /^what (?:will|do) you do (?:on your own|automatically|by yourself)(?: for me)?$/.test(t)
    || /^what(?:'s| is) (?:on repeat|running on a schedule|set to run)$/.test(t)
}

export type ScheduledInput = {
  reminders: Array<{ id?: string; message?: string | null; remind_at?: string | null; is_recurring?: boolean | null; recurring_pattern?: string | null }> | null
  watchers: Array<{ id?: string; type?: string | null; condition_json?: any; cadence_minutes?: number | null; next_check_at?: string | null }> | null
  goals: Array<{ id?: string; title?: string | null; status?: string | null; next_action?: string | null }> | null
  briefing: { enabled: boolean; time: string } | null
  checkIns: { everyMinutes: number; quietStart: number; quietEnd: number } | null
}

function when(iso: unknown, timezone: string) {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return ''
  try { return new Intl.DateTimeFormat('en-IN', { timeZone: timezone || 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t)) } catch { return '' }
}
function every(minutes: number) {
  const m = Math.max(1, Math.round(Number(minutes) || 0))
  if (m % 1440 === 0) return m === 1440 ? 'once a day' : `every ${m / 1440} days`
  if (m % 60 === 0) return m === 60 ? 'every hour' : `every ${m / 60} hours`
  return `every ${m} minutes`
}
function clock(hhmm: string) {
  const [h, m] = String(hhmm || '08:00').split(':').map(Number)
  if (!Number.isFinite(h)) return '8:00 am'
  return `${((h + 11) % 12) + 1}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`

export function composeScheduledList(i: ScheduledInput, opts: { timezone?: string; now?: number } = {}) {
  const tz = opts.timezone || 'Asia/Kolkata', now = opts.now ?? Date.now()
  const sections: string[] = []
  const unreadable: string[] = []
  let n = 0
  const line = (s: string) => `${++n}. ${s}`

  if (i.reminders === null) unreadable.push('reminders')
  else {
    const repeating = i.reminders.filter(r => r.is_recurring && r.recurring_pattern && !String(r.recurring_pattern).startsWith('followup:'))
    const soon = i.reminders.filter(r => !r.is_recurring && Date.parse(String(r.remind_at || '')) >= now && Date.parse(String(r.remind_at || '')) <= now + 7 * 86_400_000)
      .sort((a, b) => Date.parse(String(a.remind_at)) - Date.parse(String(b.remind_at))).slice(0, 5)
    if (repeating.length) sections.push(['*Repeating reminders*', ...repeating.map(r => line(`${clean(r.message, 70)} · ${describeCadence(r.recurring_pattern)}${when(r.remind_at, tz) ? ` · next ${when(r.remind_at, tz)}` : ''}`))].join('\n'))
    if (soon.length) sections.push(['*Reminders in the next 7 days*', ...soon.map(r => line(`${clean(r.message, 70)} · ${when(r.remind_at, tz)}`))].join('\n'))
  }
  if (i.watchers === null) unreadable.push('watches')
  else {
    const watches = i.watchers.filter(w => String(w.type || '') !== 'goal_review')
    if (watches.length) sections.push(['*Watches*', ...watches.map(w => {
      const c = w.condition_json || {}
      // 4 Nov (retest #1): titles read "…below" and "256GB 256GB". Same name and rule as "show my watches".
      const name = shortTitle(watchName(w), 70)
      const rule = watchRule(w)
      const title = rule ? `${name} · ${rule}` : name
      const cadence = Number(w.cadence_minutes || c.cadenceMinutes || 0)
      return line(`${title}${cadence ? ` · checks ${every(cadence)}` : ''}${when(w.next_check_at, tz) ? ` · next ${when(w.next_check_at, tz)}` : ''}`)
    })].join('\n'))
  }
  if (i.goals === null) unreadable.push('goals')
  else if (i.goals.length) sections.push(['*Goals Gogo is working on*', ...i.goals.map(g => line(`${clean(g.title, 70)}${g.next_action ? ` · next: ${clean(g.next_action, 60)}` : ''}`))].join('\n'))

  const routine: string[] = []
  if (i.briefing === null) unreadable.push('the morning briefing')
  else if (i.briefing.enabled) routine.push(line(`Morning briefing · daily at ${clock(i.briefing.time)}`))
  if (i.checkIns) routine.push(line(`Gogo check-ins · ${every(i.checkIns.everyMinutes)}, quiet ${hour(i.checkIns.quietStart)} to ${hour(i.checkIns.quietEnd)}`))
  if (routine.length) sections.push(['*Routine*', ...routine].join('\n'))

  const missing = unreadable.length ? `\n\nI couldn't check ${unreadable.join(', ').replace(/, ([^,]*)$/, ' and $1')} just now, so ${unreadable.length > 1 ? 'they are' : 'it is'} not in this list.` : ''
  if (!n) return unreadable.length
    ? `🗓️ I couldn't read your schedules just now (${unreadable.join(', ')}). Nothing was changed; please ask again in a minute.`
    : `🗓️ Nothing is scheduled right now: no repeating reminders, watches or goals.\n\nSay "remind me every Monday at 9 am to …" or "watch the price of …" to add one.`
  return `🗓️ *Scheduled* · ${n} item${n === 1 ? '' : 's'}\n\n${sections.join('\n\n')}${missing}\n\nTo stop one, say "cancel reminder <name>", "stop watching <name>" or "stop daily briefing".`
}

const ownerKey = (tg: string): number | string => { const n = Number(tg); return Number.isSafeInteger(n) && String(n) === tg ? n : tg }

export async function loadScheduledList(telegramId: string | number, now = Date.now()) {
  if (typeof telegramId === 'number' && !Number.isSafeInteger(telegramId)) throw new Error('scheduled_owner_invalid')
  const tg = String(telegramId ?? '').trim()
  if (!/^-?[1-9]\d{0,18}$/.test(tg)) throw new Error('scheduled_owner_invalid')
  const key = ownerKey(tg)
  const since = new Date(now - 3600_000).toISOString()
  const [rem, wat, goals, user] = await Promise.all([
    supabaseAdmin.from('reminders').select('id,message,remind_at,is_recurring,recurring_pattern').eq('telegram_id', key).eq('sent', false).gte('remind_at', since).order('remind_at', { ascending: true }).limit(60),
    supabaseAdmin.from('agent_watchers').select('id,type,condition_json,cadence_minutes,next_check_at').eq('telegram_id', tg).eq('active', true).order('created_at', { ascending: false }).limit(20),
    supabaseAdmin.from('agent_goals').select('id,title,status,next_action').eq('telegram_id', tg).not('status', 'in', '(completed,cancelled,failed,archived)').order('updated_at', { ascending: false }).limit(10),
    supabaseAdmin.from('users').select('telegram_id,timezone,briefing_enabled,briefing_time').eq('telegram_id', key).maybeSingle(),
  ])
  const rows = (r: any) => (r?.error ? null : Array.isArray(r?.data) ? r.data : [])
  const u: any = user?.error || (user?.data && String(user.data.telegram_id) !== tg) ? null : user?.data
  let checkIns: ScheduledInput['checkIns'] = null
  try {
    const { getAlertPreferences } = await import('./alert-preferences')
    const p = await getAlertPreferences(tg)
    checkIns = { everyMinutes: p.checkEveryMinutes, quietStart: p.quietStart, quietEnd: p.quietEnd }
  } catch { checkIns = null }
  return {
    timezone: String(u?.timezone || 'Asia/Kolkata'),
    input: { reminders: rows(rem), watchers: rows(wat), goals: rows(goals), briefing: user?.error ? null : { enabled: Boolean(u?.briefing_enabled), time: String(u?.briefing_time || '08:00') }, checkIns } as ScheduledInput,
  }
}

export async function tryGetScheduledList(params: { actor: Pick<AgentActor, 'legacyTelegramId'>; text: string }) {
  if (!isScheduledListQuery(params.text)) return null
  try {
    const { timezone, input } = await loadScheduledList(params.actor.legacyTelegramId)
    return { runId: 'scheduled-list', status: 'completed' as const, capability: 'tasks' as const, risk: 'low' as const, text: composeScheduledList(input, { timezone }), handledBy: 'scheduled-list' }
  } catch (err: any) {
    console.error('SCHEDULED_LIST_FAILED:', String(err?.message || err).slice(0, 120))
    return { runId: 'scheduled-list', status: 'failed' as const, capability: 'tasks' as const, risk: 'low' as const, text: "🗓️ I couldn't read your schedules just now. Nothing was changed; please ask again in a minute.", handledBy: 'scheduled-list' }
  }
}
