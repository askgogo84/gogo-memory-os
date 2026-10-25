import { Suspense } from 'react'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GogoChat, type ChatBrief } from '@/components/dashboard/gogo-chat'
import { firstNameOf } from '@/lib/dashboard/chat-suggestions'
import { getTodayReminders, getUpcomingReminders } from '@/lib/dashboard/queries'
import { getTaskFeed, EMPTY_FEED } from '@/lib/dashboard/task-feed'
import { buildHomeSections, homeSummary } from '@/lib/dashboard/home-sections'
import { getServiceNoticesForPage, EMPTY_SERVICE_NOTICES } from '@/lib/dashboard/service-notices'

export const dynamic = 'force-dynamic'

/** The brief on top of the one thread (approved 22 Oct Duet-parity mock): what needs you, what is next, what Gogo is
 *  handling, from the same sources as Tasks. A read failure only drops the card. */
async function loadBrief(tg: string, tz: string): Promise<ChatBrief | null> {
  const now = new Date()
  const [today, upcoming, feed, notices] = await Promise.all([
    getTodayReminders(tg).catch(() => ({ ok: false as const })),
    getUpcomingReminders(tg).catch(() => []),
    getTaskFeed(tg).catch(() => EMPTY_FEED),
    getServiceNoticesForPage(tg).catch(() => EMPTY_SERVICE_NOTICES),
  ])
  const sections = buildHomeSections({ feed, today: (today as any).ok ? (today as any).reminders : [], upcoming, now, tz })
  const items: ChatBrief['items'] = [
    ...sections.now.slice(0, 2).map(i => ({ text: i.sub ? `${i.title}. ${i.sub}` : i.title, tone: 'amber' as const, href: i.href || '/dashboard/tasks' })),
    ...(notices.items || []).slice(0, 1).map((n: any) => ({ text: String(n.title || 'Service notice').replace(/^Review service (?:billing )?notice\s*[—-]\s*/i, '').slice(0, 120), tone: 'amber' as const, href: '/dashboard/tasks' })),
    ...sections.comingUp.slice(0, 1).map(l => ({ text: `${l.when} ${l.title}`, tone: 'muted' as const, href: l.href })),
    ...sections.handling.slice(0, 1).map(i => ({ text: `Gogo is handling: ${i.title}`, tone: 'teal' as const, href: i.href || '/dashboard/tasks' })),
  ].slice(0, 3)
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(now))
  const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(now).replace(' ', '').toLowerCase()
  return { title: `${hour < 12 ? 'Morning brief' : hour < 17 ? 'Afternoon brief' : 'Evening brief'} · ${time}`, summary: homeSummary(sections, notices.total || 0), items }
}

export default async function ChatPage() {
  const session = await getSession()
  const tg = parseInt(session?.telegramId || '', 10)
  let comfortDrink = 'coffee'
  let userName = ''
  let brief: ChatBrief | null = null
  if (Number.isFinite(tg)) {
    const [{ data }, { data: user }] = await Promise.all([
      supabaseAdmin.from('user_experience_preferences').select('comfort_drink').eq('telegram_id', tg).maybeSingle(),
      supabaseAdmin.from('users').select('name,timezone').eq('telegram_id', tg).maybeSingle(),
    ])
    comfortDrink = data?.comfort_drink || 'coffee'
    userName = firstNameOf(user?.name)
    brief = await loadBrief(String(tg), user?.timezone || 'Asia/Kolkata').catch(() => null)
  }

  return (
    <Suspense fallback={<div className="p-8 text-[16px] text-gogo-ink-3">Opening Gogo’s room…</div>}>
      <GogoChat initialDrink={comfortDrink} userName={userName} brief={brief} />
    </Suspense>
  )
}
