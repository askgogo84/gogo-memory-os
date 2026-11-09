// Topic brief (9 Nov, v2 mock scene "Morning brief"): the morning brief as a short list of topics, each a chip that
// says whether it needs you (amber) or Gogo has it (blue). Composed from the same owner-scoped reads Spaces use, so
// nothing is invented and every line can be traced to a block. Pure composer; the writer is in daily-brief-writer.ts.
import type { BlockData } from '@/lib/spaces/sources'

export type BriefTone = 'needs_you' | 'handled'
export type BriefItem = { topic: string; tone: BriefTone; text: string; href?: string }
export type TopicBrief = { date: string; items: BriefItem[]; needsYou: number; generatedAt: string }

const clip = (s: unknown, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`

/** Blocks → topics. `blocks` keys are the My Day / Trip Board / Tipplr block ids; missing or errored blocks are skipped. */
export function composeTopicBrief(blocks: Record<string, BlockData | undefined>, opts: { date: string; now?: number; tipplrHref?: string | null }): TopicBrief {
  const items: BriefItem[] = []
  const ok = (k: string) => { const b = blocks[k]; return b && b.status === 'ok' ? b : null }

  // Tipplr first: money and waiting customers.
  const ex = ok('exceptions')
  if (ex?.table?.rows?.length) {
    const rows = ex.table.rows
    const oldest = rows.map(r => parseInt(String(r[3] || '0'), 10) || 0).sort((a, b) => b - a)[0]
    const outlets = [...new Set(rows.map(r => r[1]))]
    items.push({ topic: 'Tipplr', tone: 'needs_you', text: `${n(rows.length, 'order', 'orders')} waiting for a decision at ${outlets.slice(0, 2).join(' and ')}${outlets.length > 2 ? ` and ${outlets.length - 2} more` : ''}. Oldest ${oldest} min.`, href: opts.tipplrHref || undefined })
  } else {
    const oos = ok('oos')
    const cancelled = Number(oos?.stats?.[0]?.n || 0)
    if (oos && cancelled > 0) items.push({ topic: 'Tipplr', tone: 'handled', text: `${n(cancelled, 'order', 'orders')} cancelled out of stock today across ${oos.stats?.[1]?.n || '?'} outlets. Nothing waiting on you.`, href: opts.tipplrHref || undefined })
  }

  // Mail that needs a reply.
  const mail = ok('mail')
  if (mail?.items?.length) {
    const first = mail.items[0]
    items.push({ topic: 'Mail', tone: 'needs_you', text: `${first.sub ? `${clip(first.sub.split(' · ')[0], 40)} asked: ` : ''}${clip(first.title, 80)}${mail.items.length > 1 ? `. ${n(mail.items.length - 1, 'other needs', 'others need')} you.` : '.'}`, href: '/dashboard/tasks' })
  }

  // Overdue loops.
  const loops = ok('loops')
  if (loops?.items?.length) {
    const overdue = loops.items.filter(i => i.pill?.text === 'overdue')
    const today = loops.items.filter(i => i.pill?.text === 'today')
    if (overdue.length) items.push({ topic: 'Open loops', tone: 'needs_you', text: `${n(overdue.length, 'is', 'are')} overdue: ${clip(overdue[0].title, 70)}${overdue.length > 1 ? ' and more' : ''}.`, href: '/dashboard/spaces/my_day' })
    else if (today.length) items.push({ topic: 'Open loops', tone: 'handled', text: `${n(today.length, 'is', 'are')} due today: ${clip(today[0].title, 70)}.`, href: '/dashboard/spaces/my_day' })
  }

  // Next trip.
  const trip = ok('trip')
  if (trip?.items?.length) items.push({ topic: 'Trip', tone: 'handled', text: `${clip(trip.items[0].title, 60)} on ${trip.items[0].time}${trip.items[0].sub ? `, ${clip(trip.items[0].sub, 60)}` : ''}.`, href: '/dashboard/spaces/trip_board' })

  // Today: first two timed events.
  const cal = ok('today')
  if (cal?.items?.length) {
    const timed = cal.items.filter(i => i.time && i.time !== 'All day')
    const first = timed[0] || cal.items[0]
    items.push({ topic: 'Today', tone: 'handled', text: `${first.time && first.time !== 'All day' ? `${first.time} ` : ''}${clip(first.title, 60)}${cal.items.length > 1 ? `, then ${n(cal.items.length - 1, 'more', 'more')}` : ''}.`, href: '/dashboard/spaces/my_day' })
  }

  // Reminders still due.
  const due = ok('due')
  if (due?.items?.length) items.push({ topic: 'Reminders', tone: 'handled', text: `${n(due.items.length, 'reminder', 'reminders')} today, first at ${due.items[0].time}: ${clip(due.items[0].title, 60)}.`, href: '/dashboard/spaces/my_day' })

  const needsYou = items.filter(i => i.tone === 'needs_you').length
  // Needs-you first, then the rest in the order above.
  items.sort((a, b) => Number(b.tone === 'needs_you') - Number(a.tone === 'needs_you'))
  return { date: opts.date, items: items.slice(0, 7), needsYou, generatedAt: new Date(opts.now ?? Date.now()).toISOString() }
}

/** WhatsApp/plain text of the same brief, so both surfaces say the same thing. */
export function formatTopicBrief(b: TopicBrief): string {
  if (!b.items.length) return 'Nothing needs you this morning.'
  return b.items.map(i => `${i.tone === 'needs_you' ? '🟠' : '🔵'} *${i.topic}*: ${i.text}`).join('\n')
}

export function briefTitle(date: string, tz = 'Asia/Kolkata'): string {
  const d = new Date(`${date}T12:00:00+05:30`)
  return `Morning brief · ${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}`
}
