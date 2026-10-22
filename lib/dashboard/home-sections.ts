// Home v2 (approved 23 Oct mock): one glance at what matters. Pure: takes the task feed and reminders the page
// already reads and sorts them into Needs you now · Gogo is handling · Coming up · Can wait · Done today.
// Nothing here invents urgency: an item is "now" only because a person's decision or sign-in is actually blocking it.
import type { FeedItem, TaskFeed } from './task-feed'

export type HomeReminder = { id: string | number; message?: string | null; remind_at: string; sent?: boolean | null; status?: string | null; delivery_state?: string | null }
export type HomeLine = { id: string; when: string; title: string; href: string }
export type HomeSections = {
  now: FeedItem[]
  handling: FeedItem[]
  comingUp: HomeLine[]
  canWait: FeedItem[]
  canWaitLater: HomeLine[]
  doneToday: FeedItem[]
}

// What blocks Gogo hardest comes first: a code or sign-in waits on a live page, a yes/no unlocks a prepared action,
// "you said not yet" waits for a detail. Equal weight: the oldest first (it is closest to expiring).
const NOW_WEIGHT: Record<string, number> = { 'Code needed': 100, 'Sign-in needed': 95, 'Needs your yes': 90, 'You said not yet': 70 }

export function rankNow(items: FeedItem[]): FeedItem[] {
  const t = (i: FeedItem) => { const v = Date.parse(String(i.at || '')); return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER }
  return [...items].sort((a, b) => (NOW_WEIGHT[b.tag] ?? 50) - (NOW_WEIGHT[a.tag] ?? 50) || t(a) - t(b))
}

function dayKey(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d)
}
function timeLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso))
}
function weekdayLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(new Date(iso))
}
const live = (r: HomeReminder) => r.status !== 'cancelled' && r.delivery_state !== 'cancelled' && !r.sent && r.status !== 'completed'

export function buildHomeSections(input: { feed: TaskFeed; today: HomeReminder[]; upcoming?: HomeReminder[]; now?: Date; tz?: string }): HomeSections {
  const now = input.now || new Date()
  const tz = input.tz || 'Asia/Kolkata'
  const today = dayKey(now, tz)
  // "Gogo thinks done" waits only for a tidy-up tap; nothing is blocked by it.
  const urgent = input.feed.need.filter(i => !i.confirm)
  const tidy = input.feed.need.filter(i => i.confirm)
  // A watch whose own date is over is a review, not live work.
  const handling = input.feed.radar.filter(i => i.tag !== 'Date passed')
  const passed = input.feed.radar.filter(i => i.tag === 'Date passed')
  const comingUp = input.today
    .filter(r => live(r) && Date.parse(r.remind_at) >= now.getTime())
    .map(r => ({ id: `rm-${r.id}`, when: timeLabel(r.remind_at, tz), title: r.message || 'Reminder', href: '/dashboard/today' }))
  const canWaitLater = (input.upcoming || [])
    .filter(r => live(r) && dayKey(new Date(r.remind_at), tz) !== today)
    .slice(0, 5)
    .map(r => ({ id: `rl-${r.id}`, when: weekdayLabel(r.remind_at, tz), title: r.message || 'Reminder', href: '/dashboard/today' }))
  const doneToday = input.feed.recent.filter(i => (i.tag === 'Finished' || i.tag === 'Completed by you') && i.at && dayKey(new Date(i.at), tz) === today)
  return { now: rankNow(urgent), handling, comingUp, canWait: [...tidy, ...passed], canWaitLater, doneToday }
}

/** The one-line summary under the greeting, from the same counts the sections show. */
export function homeSummary(s: HomeSections, extraNeeds = 0): string {
  const need = s.now.length + extraNeeds
  const parts: string[] = []
  if (need) parts.push(`${need} thing${need === 1 ? ' needs' : 's need'} you.`)
  if (s.handling.length) parts.push(`Gogo is handling ${s.handling.length}.`)
  if (s.comingUp[0]) parts.push(`Next: ${s.comingUp[0].title} at ${s.comingUp[0].when}.`)
  return parts.join(' ') || 'Your day is clear. Tell Gogo what matters and it will carry the next safe steps.'
}
