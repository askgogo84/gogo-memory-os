// "What's pending?" — the person's own open items, never a web search (round 6, #48: it searched "pending bank
// transactions"). One reply from the same sources the dashboard shows: decisions waiting for a yes, sites waiting
// for a sign-in, tasks Gogo is running, background watches, reminders still due today and open to-dos.
import { getTaskFeed } from '@/lib/dashboard/task-feed'
import { getTodayReminders } from '@/lib/dashboard/queries'
import { getDashboardTasks } from '@/lib/dashboard/tasks'

const PENDING_RE = /^(?:so\s+|ok\s+|and\s+)?(?:what(?:'s|’s| is| all is| else is)?\s+(?:still\s+)?(?:pending|left|open|outstanding)(?:\s+(?:for me|today|now|on my plate))?|anything\s+(?:still\s+)?(?:pending|left|open|outstanding)(?:\s+(?:for me|today))?|what(?:'s| is)\s+on my plate(?:\s+today)?|what do i (?:still )?(?:need|have) to do(?:\s+today)?|my pending (?:items|tasks|stuff)|pending (?:items|tasks|stuff)|show (?:me )?(?:what(?:'s| is) )?pending)$/i

export function isPendingAsk(text: string): boolean {
  const t = String(text || '').trim().replace(/[\s!.?,]+$/g, '')
  return t.length <= 60 && PENDING_RE.test(t)
}

const clock = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(iso))

export async function buildPendingSummary(telegramId: string, tz = 'Asia/Kolkata', now = new Date()): Promise<string> {
  const [feed, today, todos] = await Promise.all([
    getTaskFeed(telegramId, now),
    getTodayReminders(telegramId).catch(() => ({ ok: false } as const)),
    getDashboardTasks(telegramId).catch(() => ({ ok: false } as const)),
  ])
  const lines: string[] = []
  const section = (title: string, items: string[], more = 0) => {
    if (!items.length) return
    lines.push(`*${title}*`, ...items.map(i => `• ${i}`))
    if (more > 0) lines.push(`• …and ${more} more`)
    lines.push('')
  }
  section('Needs your yes', feed.need.slice(0, 5).map(i => `${i.title}${i.tag ? ` — ${i.tag.toLowerCase()}` : ''}`), feed.need.length - 5)
  const working = feed.radar.filter(i => i.tag === 'Working now')
  const watches = feed.radar.filter(i => i.tag !== 'Working now')
  section('Gogo is working on', working.slice(0, 4).map(i => i.title), working.length - 4)
  const dueToday = (today as any).ok ? (today as any).reminders.filter((r: any) => !r.sent && r.status !== 'cancelled' && r.delivery_state !== 'cancelled' && Date.parse(r.remind_at) >= now.getTime()) : []
  section('Reminders still due today', dueToday.slice(0, 5).map((r: any) => `${clock(r.remind_at, tz)} · ${r.message || 'Reminder'}`), dueToday.length - 5)
  const open = (todos as any).ok ? (todos as any).open : []
  section('Open to-dos', open.slice(0, 5).map((t: any) => t.label), open.length - 5)
  const watchTotal = Math.max(0, (feed.radarCount ?? feed.radar.length) - working.length)
  if (watchTotal) lines.push(`👀 ${watchTotal} background watch${watchTotal === 1 ? '' : 'es'} running${watches[0] ? ` (e.g. ${watches[0].title})` : ''}.`, '')

  if (!lines.length) return '✅ Nothing is pending right now — no decisions waiting, no reminders left today and no open to-dos.'
  return ['📋 *Here’s what’s pending*', '', ...lines, 'Open the dashboard for details: app.askgogo.in/dashboard/tasks'].join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
