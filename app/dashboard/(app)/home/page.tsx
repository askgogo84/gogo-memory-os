import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, getLists } from '@/lib/dashboard/queries'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { CommandBar } from '@/components/dashboard/command-bar'
import { GogoCharacter } from '@/components/gogo/gogo-character'

export const dynamic = 'force-dynamic'

function period(now: Date, tz: string) {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now), 10)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function Portal({ href, eyebrow, title, detail }: { href: string; eyebrow: string; title: string; detail: string }) {
  return (
    <Link href={href} className="group relative overflow-hidden rounded-[24px] border border-gogo-ink/8 bg-gogo-surface/82 p-5 shadow-[0_14px_38px_rgba(45,32,22,.045)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-gogo-teal/24 hover:shadow-[0_20px_48px_rgba(45,32,22,.075)] sm:p-6">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gogo-teal/70" />
      <div className="relative text-[9px] font-extrabold uppercase tracking-[0.18em] text-gogo-teal">{eyebrow}</div>
      <div className="relative mt-2 font-serif text-[27px] leading-[1.02] tracking-[-0.6px] text-gogo-ink">{title}</div>
      <div className="relative mt-3 max-w-[34ch] text-[12px] leading-5 text-gogo-ink-3">{detail}</div>
      <div className="relative mt-5 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-gogo-ink-3">Open</span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gogo-teal-soft text-[16px] font-bold text-gogo-teal transition duration-200 group-hover:bg-gogo-teal group-hover:text-white">→</span>
      </div>
    </Link>
  )
}

export default async function HomePage() {
  const session = await getSession()
  const tg = session?.telegramId || ''
  const tgNum = parseInt(tg, 10)
  const [{ data: user }, today, lists, memory, watcherCount, approvalCount, goalCount] = await Promise.all([
    Number.isFinite(tgNum)
      ? supabaseAdmin.from('users').select('name, timezone').eq('telegram_id', tgNum).maybeSingle()
      : Promise.resolve({ data: null as any }),
    session ? getTodayReminders(session.telegramId) : Promise.resolve({ ok: true as const, reminders: [] }),
    session ? getLists(session.telegramId) : Promise.resolve({ ok: true as const, lists: [] }),
    session ? getDashboardMemory(session.telegramId) : Promise.resolve({ ok: true as const, items: [] }),
    session ? supabaseAdmin.from('agent_watchers').select('id',{count:'exact',head:true}).eq('telegram_id',session.telegramId).eq('active',true) : Promise.resolve({count:0}),
    session ? supabaseAdmin.from('agent_approvals').select('id',{count:'exact',head:true}).eq('telegram_id',session.telegramId).eq('status','pending') : Promise.resolve({count:0}),
    session ? supabaseAdmin.from('agent_goals').select('id',{count:'exact',head:true}).eq('telegram_id',session.telegramId).in('status',['active','blocked']) : Promise.resolve({count:0}),
  ])

  const tz = user?.timezone || 'Asia/Kolkata'
  const now = new Date()
  const name = user?.name?.trim().split(/\s+/)[0] || 'there'
  const pending = today.ok ? today.reminders.filter((r) => !r.sent && new Date(r.remind_at).getTime() > now.getTime()).length : 0
  const listCount = lists.ok ? lists.lists.length : 0
  const memoryCount = memory.ok ? memory.items.length : 0
  const watchers = watcherCount.count || 0
  const approvals = approvalCount.count || 0
  const goals = goalCount.count || 0
  const gogoState = approvals > 0 ? 'approval' : watchers > 0 ? 'watching' : 'calm'
  const statusCopy = approvals > 0
    ? `${approvals} action${approvals === 1 ? '' : 's'} waiting for you`
    : watchers > 0
      ? 'Background Gogo is working'
      : 'Gogo is ready'

  return (
    <div className="zen-home relative min-h-[calc(100vh-3.5rem)] overflow-hidden rounded-[30px] border border-gogo-ink/8">
      <div className="pointer-events-none absolute left-1/2 top-[-13rem] h-[31rem] w-[31rem] -translate-x-1/2 rounded-full bg-gogo-teal/9 blur-[105px]" />
      <div className="pointer-events-none absolute -right-28 bottom-[-10rem] h-[28rem] w-[28rem] rounded-full bg-gogo-orange/8 blur-[105px]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-[1180px] flex-col px-5 py-5 sm:px-7 sm:py-7 xl:px-11 xl:py-9">
        <header className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-gogo-ink-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-gogo-teal shadow-[0_0_0_5px_rgba(21,122,110,.09)]" />
            <span className="truncate">One Gogo · everywhere</span>
          </div>
          <Link href={approvals > 0 ? '/dashboard/agent' : '/dashboard/today'} className="zen-home-pill flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[9.5px] font-bold text-gogo-ink-2 backdrop-blur-xl sm:px-4">
            <span className={`h-2 w-2 rounded-full ${approvals > 0 ? 'bg-amber-500' : watchers > 0 ? 'bg-gogo-teal' : 'bg-emerald-500'}`} />
            <span className="hidden sm:inline">{statusCopy}</span>
            <span className="sm:hidden">{approvals > 0 ? `${approvals} need you` : watchers > 0 ? 'Working' : 'Ready'}</span>
          </Link>
        </header>

        <section className="mx-auto flex w-full max-w-[900px] flex-1 items-center justify-center py-8 text-center sm:py-10">
          <div className="w-full">
            <Link href={approvals > 0 ? '/dashboard/agent' : '/dashboard/chat'} aria-label="Talk to Gogo" className="relative mx-auto mb-5 block w-fit transition duration-300 hover:scale-[1.03]">
              <span className="absolute inset-[-28%] rounded-full bg-gogo-orange/12 blur-2xl" />
              <GogoCharacter state={gogoState} size={112} showStatus={watchers > 0 || approvals > 0} />
            </Link>

            <p className="text-[10px] font-bold uppercase tracking-[0.20em] text-gogo-teal">Good {period(now, tz)}, {name}</p>
            <h1 className="mt-3 font-serif text-[51px] font-normal leading-[.92] tracking-[-1.8px] text-gogo-ink sm:text-[64px] xl:text-[76px]">
              Your mind, <em className="font-normal text-gogo-teal">lighter.</em>
            </h1>
            <p className="mx-auto mt-4 max-w-[37rem] text-[13px] leading-6 text-gogo-ink-3 sm:text-[14px]">Tell Gogo what matters. Gogo remembers the context, handles the next steps and asks only when your approval is needed.</p>

            <div className="relative mx-auto mt-7 w-full max-w-[760px]"><CommandBar /></div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[10px] font-bold text-gogo-ink-2">
              <Link href="/dashboard/today" className="zen-home-pill flex items-center gap-2 rounded-full border px-3 py-2 backdrop-blur"><i className="h-1.5 w-1.5 rounded-full bg-gogo-teal" />{pending} reminders</Link>
              <Link href="/dashboard/memory" className="zen-home-pill flex items-center gap-2 rounded-full border px-3 py-2 backdrop-blur"><i className="h-1.5 w-1.5 rounded-full bg-gogo-teal" />{memoryCount} memories</Link>
              <Link href="/dashboard/agent" className="zen-home-pill flex items-center gap-2 rounded-full border px-3 py-2 backdrop-blur"><i className="h-1.5 w-1.5 rounded-full bg-gogo-orange" />{watchers} watches</Link>
              {goals > 0 && <Link href="/dashboard/agent" className="zen-home-pill flex items-center gap-2 rounded-full border px-3 py-2 backdrop-blur"><i className="h-1.5 w-1.5 rounded-full bg-gogo-ink/45" />{goals} goals</Link>}
              {approvals > 0 && <Link href="/dashboard/agent" className="flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-amber-800"><i className="h-1.5 w-1.5 rounded-full bg-amber-500" />{approvals} approvals</Link>}
            </div>
          </div>
        </section>

        <section className="grid gap-3 pb-1 md:grid-cols-3 sm:gap-4">
          <Portal href="/dashboard/today" eyebrow="Daily Gogo" title="What matters now" detail="Calendar, reminders and proactive context — one calm view instead of more noise." />
          <Portal href="/dashboard/agent" eyebrow="Gogo Agent" title="Give Gogo an outcome" detail="Plan, act and keep working. Consequential actions still stop at your approval." />
          <Portal href="/dashboard/memory" eyebrow="Gogo Memory" title="Find what Gogo knows" detail={`Private context, documents and memories Gogo can reuse later.${listCount ? ` ${listCount} lists are ready too.` : ''}`} />
        </section>
      </div>
    </div>
  )
}
