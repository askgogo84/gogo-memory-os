// Usage trends (31 Oct, from what Muse users built for themselves: "gauges based on the weekly reset, trends over
// 7d, 30d, 60d, 90d, history of past months"). One read per source over 90 days, bucketed here. Read-only.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type ActivityInput = {
  aiEvents: { created_at: string; action?: string | null }[]
  reminders: { remind_at: string }[]
  runs: { created_at: string; status?: string | null; title?: string | null; type?: string | null }[]
  alerts: { created_at: string }[]
}
export type Trend = { days: 7 | 30 | 60 | 90; ai: number; reminders: number; tasks: number; alerts: number }
export type ActivityTrends = {
  weekUsed: number
  weekLimit: number
  weekStart: string
  trends: Trend[]
  weeks: { start: string; ai: number; tasks: number }[]
  topActions: { action: string; count: number }[]
  recent: { title: string; status: string; at: string }[]
}

const DAY = 86400_000
const IST = 330 * 60_000

/** Monday 00:00 IST of the week that contains `t`, as a UTC timestamp. */
export function istWeekStart(t: number) {
  const ist = new Date(t + IST)
  const dow = (ist.getUTCDay() + 6) % 7
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow) - IST
}

const ACTION_LABEL: Record<string, string> = {
  chat: 'Questions answered', web_search: 'Web lookups', expense: 'Expenses logged', document: 'Documents saved',
  reminder: 'Reminders', calendar: 'Calendar', email: 'Email', image: 'Images', voice: 'Voice notes',
}
export function actionLabel(action: string) {
  const a = String(action || 'other').toLowerCase()
  return ACTION_LABEL[a] || a.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

export function buildActivityTrends(input: ActivityInput, now = Date.now(), aiPerDay = 0): ActivityTrends {
  const ts = (s: string) => Date.parse(String(s || ''))
  const within = (t: number, days: number) => Number.isFinite(t) && t <= now && now - t < days * DAY
  const done = input.runs.filter(r => String(r.status || '') === 'completed')
  const trends = ([7, 30, 60, 90] as const).map(days => ({
    days,
    ai: input.aiEvents.filter(e => within(ts(e.created_at), days)).length,
    reminders: input.reminders.filter(r => within(ts(r.remind_at), days)).length,
    tasks: done.filter(r => within(ts(r.created_at), days)).length,
    alerts: input.alerts.filter(a => within(ts(a.created_at), days)).length,
  }))
  const thisWeek = istWeekStart(now)
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = thisWeek - (11 - i) * 7 * DAY, end = start + 7 * DAY
    const inWeek = (t: number) => Number.isFinite(t) && t >= start && t < end
    return { start: new Date(start).toISOString(), ai: input.aiEvents.filter(e => inWeek(ts(e.created_at))).length, tasks: done.filter(r => inWeek(ts(r.created_at))).length }
  })
  const counts = new Map<string, number>()
  for (const e of input.aiEvents) if (within(ts(e.created_at), 30)) counts.set(actionLabel(String(e.action || 'other')), (counts.get(actionLabel(String(e.action || 'other'))) || 0) + 1)
  const topActions = [...counts.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count).slice(0, 5)
  const recent = [...input.runs].filter(r => r.title && Number.isFinite(ts(r.created_at)))
    .sort((a, b) => ts(b.created_at) - ts(a.created_at)).slice(0, 8)
    .map(r => ({ title: String(r.title).slice(0, 90), status: String(r.status || ''), at: r.created_at }))
  return {
    weekUsed: input.aiEvents.filter(e => ts(e.created_at) >= thisWeek && ts(e.created_at) <= now).length,
    weekLimit: Math.max(0, aiPerDay * 7),
    weekStart: new Date(thisWeek).toISOString(),
    trends, weeks, topActions, recent,
  }
}

/** The WhatsApp version: a few lines, numbers first. */
export function formatActivityTrends(a: ActivityTrends, planLabel = '') {
  const pct = a.weekLimit > 0 ? Math.round((a.weekUsed / a.weekLimit) * 100) : null
  const t = (d: number) => a.trends.find(x => x.days === d)!
  const n = (v: number, w: string) => `${v} ${w}${v === 1 ? '' : 's'}`
  const row = (d: number) => `${d} days: ${n(t(d).ai, 'AI action')} · ${n(t(d).tasks, 'task')} · ${n(t(d).reminders, 'reminder')} · ${n(t(d).alerts, 'alert')}`
  const top = a.topActions.length ? `\n\n*Most used (30 days):* ${a.topActions.map(x => `${x.action} ${x.count}`).join(', ')}` : ''
  return `📊 *Your usage*${planLabel ? ` (${planLabel})` : ''}\n\n*This week:* ${a.weekUsed}${a.weekLimit ? ` of ${a.weekLimit} AI actions${pct !== null ? ` (${pct}%)` : ''}` : ' AI actions'} · resets Monday\n\n${[7, 30, 60, 90].map(row).join('\n')}${top}\n\nThe full view with charts is under Usage in your dashboard.`
}

export function isUsageQuery(text: string) {
  const t = String(text || '').trim().toLowerCase().replace(/[?.!]+$/, '')
  return /^(?:show|what(?:'s| is)|how(?:'s| is| much)|check|see)?\s*(?:me\s+)?(?:my\s+)?(?:askgogo\s+|gogo\s+)?(?:usage|usage\s+(?:dashboard|stats|this\s+week)|quota|limits?)(?:\s+(?:this\s+week|stats|so\s+far))?$/.test(t)
    || /^how\s+much\s+(?:have\s+i|did\s+i)\s+used?(?:\s+(?:you|gogo|askgogo))?(?:\s+this\s+(?:week|month))?$/.test(t)
    || /^how\s+many\s+(?:tasks|things)\s+(?:have\s+you|did\s+you)\s+(?:done|do|finished)\s+for\s+me(?:\s+this\s+(?:week|month))?$/.test(t)
}

export async function getActivityTrends(telegramId: string | number, aiPerDay = 0, now = Date.now()): Promise<ActivityTrends> {
  const tg = String(telegramId), since = new Date(now - 90 * DAY).toISOString(), until = new Date(now).toISOString()
  const [ai, rem, runs, alerts] = await Promise.all([
    supabaseAdmin.from('usage_events').select('created_at,action').eq('telegram_id', tg).eq('counter', 'ai_action').gte('created_at', since).limit(5000),
    supabaseAdmin.from('reminders').select('remind_at').eq('telegram_id', Number(tg)).eq('sent', true).gte('remind_at', since).lte('remind_at', until).limit(5000),
    supabaseAdmin.from('agent_runs').select('created_at,status,title,type').eq('telegram_id', tg).gte('created_at', since).order('created_at', { ascending: false }).limit(2000),
    supabaseAdmin.from('agent_activity').select('created_at').eq('telegram_id', tg).eq('event_type', 'watcher_triggered').gte('created_at', since).limit(5000),
  ])
  for (const r of [ai, rem, runs, alerts]) if ((r as any).error) throw new Error(`activity_read_failed:${(r as any).error.message}`)
  return buildActivityTrends({ aiEvents: (ai.data || []) as any, reminders: (rem.data || []) as any, runs: (runs.data || []) as any, alerts: (alerts.data || []) as any }, now, aiPerDay)
}
