import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDashboardTasks } from '@/lib/dashboard/tasks'
import { getServiceNoticesForPage, EMPTY_SERVICE_NOTICES } from '@/lib/dashboard/service-notices'
import { ServiceNoticeCards } from '@/components/dashboard/service-notice-cards'
import { getTaskFeed, EMPTY_FEED } from '@/lib/dashboard/task-feed'
import { FeedItems, FeedTabs } from '@/components/dashboard/feed-list'
import { CardError } from '@/components/dashboard/card-error'
import { TaskManager } from '@/components/dashboard/task-manager'

export const dynamic = 'force-dynamic'

// Approved 21 Oct mock: Tasks is everything Gogo is doing, waiting on, or has done — Needs you · On radar · Recent,
// each card with its own Gogo character — plus your own to-dos (separate from reminders) in the last tab.
export default async function TasksPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> } = {}) {
  const session = await getSession()
  const tg = session?.telegramId || ''
  const tgNum = parseInt(tg, 10)
  const raw = String((await searchParams)?.tab || '')
  const tab = raw === 'radar' || raw === 'recent' || raw === 'todos' ? raw : 'need'
  const [{ data: user }, todos, feed, notices] = await Promise.all([
    Number.isFinite(tgNum) ? supabaseAdmin.from('users').select('timezone').eq('telegram_id', tgNum).maybeSingle() : Promise.resolve({ data: null as any }),
    session ? getDashboardTasks(session.telegramId) : Promise.resolve({ ok: true as const, open: [], completed: [] }),
    session ? getTaskFeed(tg) : Promise.resolve(EMPTY_FEED),
    session ? getServiceNoticesForPage(tg) : Promise.resolve(EMPTY_SERVICE_NOTICES),
  ])
  const tz = user?.timezone || 'Asia/Kolkata'
  const needCount = feed.need.length + notices.total
  const todoCount = todos.ok ? todos.open.length : 0

  return (
    <div className="mx-auto w-full max-w-[820px] pb-10">
      <header className="pb-4 lg:pt-4">
        <div className="final-dark-eyebrow">Gogo’s work</div>
        <h1 className="final-dark-title mt-1.5 text-[28px] sm:text-[32px]">Tasks</h1>
        <p className="mt-1.5 text-[15px] text-[#a8a8a4]">Everything Gogo is doing, waiting on, or has done for you.</p>
      </header>
      <div className="flex flex-col gap-3">
        <FeedTabs base="/dashboard/tasks" tab={tab} feed={feed} needCount={needCount} extra={{ key: 'todos', label: 'To-dos', count: todoCount }}/>
        {tab === 'need' && <div className="flex flex-col gap-2">
          <FeedItems items={feed.need} size={72} empty={notices.total || notices.unavailable ? '' : 'Nothing is waiting for you.'}/>
          {(notices.total > 0 || notices.unavailable) && <div className="final-dark-panel px-4"><ServiceNoticeCards notices={notices.items} unavailable={notices.unavailable}/></div>}
        </div>}
        {tab === 'radar' && <FeedItems items={feed.radar} size={72} empty="Nothing is running in the background. Ask Gogo to watch a price, a fare or a seat."/>}
        {tab === 'recent' && (feed.recentUnavailable
          ? <p className="py-5 text-[15px] text-[#b7b7b7]">Recent updates could not be loaded. Try again shortly.</p>
          : <FeedItems items={feed.recent} size={72} empty="No finished tasks yet."/>)}
        {tab === 'todos' && (todos.ok
          ? <div><p className="pb-2 text-[14px] text-[#a8a8a4]">Open {todos.open.length} · Completed {todos.completed.length} · separate from reminders</p><TaskManager open={todos.open} completed={todos.completed} tz={tz} /></div>
          : <CardError message="Couldn’t load your to-dos right now." />)}
      </div>
    </div>
  )
}
