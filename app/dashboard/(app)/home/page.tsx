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

const portalTone = {
  orange: {
    eyebrow: 'text-gogo-orange', glow: 'bg-gogo-orange/12', line: 'bg-gogo-orange',
    arrow: 'bg-gogo-orange-tint text-gogo-orange group-hover:bg-gogo-orange group-hover:text-white',
  },
  emerald: {
    eyebrow: 'text-emerald-700', glow: 'bg-emerald-400/10', line: 'bg-emerald-500',
    arrow: 'bg-emerald-500/10 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white',
  },
  plum: {
    eyebrow: 'text-gogo-plum', glow: 'bg-gogo-plum/10', line: 'bg-gogo-plum',
    arrow: 'bg-gogo-plum-tint text-gogo-plum group-hover:bg-gogo-plum group-hover:text-white',
  },
}

function Portal({ href, eyebrow, title, detail, tone }: { href: string; eyebrow: string; title: string; detail: string; tone: keyof typeof portalTone }) {
  const t = portalTone[tone]
  return (
    <Link href={href} className="group relative overflow-hidden rounded-[26px] border border-gogo-ink/8 bg-gogo-surface/86 p-6 shadow-[0_18px_48px_rgba(45,32,22,.06)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-gogo-ink/12 hover:shadow-[0_24px_60px_rgba(45,32,22,.10)]">
      <div className={`absolute inset-x-0 top-0 h-1 ${t.line}`} />
      <div className={`pointer-events-none absolute -right-14 -top-14 h-32 w-32 rounded-full blur-3xl ${t.glow}`} />
      <div className={`relative text-[9.5px] font-extrabold uppercase tracking-[0.18em] ${t.eyebrow}`}>{eyebrow}</div>
      <div className="relative mt-2 font-serif text-[29px] leading-none tracking-[-0.7px] text-gogo-ink">{title}</div>
      <div className="relative mt-3 max-w-[31ch] text-[12px] leading-5 text-gogo-ink-3">{detail}</div>
      <div className="relative mt-5 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-gogo-ink-3">Open</span>
        <span className={`grid h-9 w-9 place-items-center rounded-full text-[16px] font-bold transition duration-200 ${t.arrow}`}>→</span>
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

  return (
    <div className="zen-home relative min-h-[calc(100vh-3.5rem)] overflow-hidden rounded-[34px] border border-gogo-ink/8 shadow-[0_34px_100px_rgba(45,32,22,.10)]">
      <div className="pointer-events-none absolute -left-24 top-6 h-[26rem] w-[26rem] rounded-full bg-gogo-orange/12 blur-[100px]" />
      <div className="pointer-events-none absolute -right-20 top-[28%] h-[32rem] w-[32rem] rounded-full bg-gogo-plum/12 blur-[120px]" />
      <div className="pointer-events-none absolute inset-x-[16%] bottom-[-18%] h-[42%] rounded-[50%] bg-emerald-200/13 blur-[80px]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-[1220px] flex-col px-7 py-7 xl:px-12 xl:py-9">
        <div className="flex items-center justify-between gap-5">
          <div className="flex items-center gap-2.5 text-[9.5px] font-extrabold uppercase tracking-[0.19em] text-gogo-ink-2">
            <span className="h-2 w-2 rounded-full bg-gogo-orange shadow-[0_0_0_5px_rgba(239,122,39,.10)]" />
            AskGogo · Meet Gogo
          </div>
          <div className="zen-home-pill flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-bold text-gogo-ink-2 shadow-[0_8px_22px_rgba(45,32,22,.04)] backdrop-blur-xl">
            <span className={`h-2 w-2 rounded-full ${approvals>0?'bg-amber-500':'bg-emerald-500'}`} />
            {approvals>0?`${approvals} action${approvals===1?'':'s'} need you`:watchers>0?`Background Gogo is watching`:'Gogo is ready'}
          </div>
        </div>

        <section className="mx-auto flex w-full max-w-[920px] flex-1 items-center justify-center py-8 text-center xl:py-10">
          <div className="zen-hero-card relative w-full overflow-hidden rounded-[36px] border border-gogo-ink/7 px-7 py-9 shadow-[0_24px_70px_rgba(45,32,22,.07)] backdrop-blur-xl sm:px-10 xl:px-14 xl:py-10">
            <div className="pointer-events-none absolute left-1/2 top-[-30%] h-72 w-72 -translate-x-1/2 rounded-full bg-gogo-orange/12 blur-[75px]" />
            <div className="relative mb-4 inline-flex">
              <div className="absolute inset-[-22%] rounded-full bg-gogo-orange/14 blur-2xl" />
              <Link href={approvals>0?'/dashboard/agent':'/dashboard/chat'} aria-label="Talk to Gogo" className="relative block transition duration-300 hover:scale-105">
                <GogoCharacter state={gogoState} size={108} showStatus={watchers>0||approvals>0} />
              </Link>
            </div>

            <h1 className="relative font-serif text-[46px] font-normal leading-[.98] tracking-[-1.35px] text-gogo-ink xl:text-[60px]">Good {period(now, tz)}, <span className="text-gogo-orange">{name}.</span></h1>
            <p className="relative mt-4 text-[16px] font-semibold text-gogo-ink-2">You don’t have to keep it all in your head.</p>
            <p className="relative mt-1.5 text-[12.5px] font-medium text-gogo-ink-3">Tell Gogo the outcome. Gogo can remember, plan, act and keep working when you leave.</p>

            <div className="relative mx-auto mt-7 w-full max-w-[780px]"><CommandBar /></div>

            <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2 text-[10.5px] font-bold text-gogo-ink-2">
              <span className="zen-home-pill flex items-center gap-2 rounded-full border px-3.5 py-2 backdrop-blur"><i className="h-2 w-2 rounded-full bg-gogo-orange" />{pending} reminders</span>
              <span className="zen-home-pill flex items-center gap-2 rounded-full border px-3.5 py-2 backdrop-blur"><i className="h-2 w-2 rounded-full bg-emerald-500" />{memoryCount} memories</span>
              <span className="zen-home-pill flex items-center gap-2 rounded-full border px-3.5 py-2 backdrop-blur"><i className="h-2 w-2 rounded-full bg-gogo-plum" />{watchers} background watches</span>
              {goals>0&&<span className="zen-home-pill flex items-center gap-2 rounded-full border px-3.5 py-2 backdrop-blur"><i className="h-2 w-2 rounded-full bg-gogo-ink/45" />{goals} goals</span>}
              {approvals>0&&<Link href="/dashboard/agent" className="zen-home-pill flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50/80 px-3.5 py-2 text-amber-800 backdrop-blur"><i className="h-2 w-2 rounded-full bg-amber-500" />{approvals} approvals</Link>}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Portal href="/dashboard/agent" eyebrow="Gogo Agent" title="Give Gogo an outcome" detail="Plan, act, watch and pause only when an important decision needs you." tone="orange" />
          <Portal href="/dashboard/today" eyebrow="Daily Gogo" title="See what matters now" detail="Calendar, reminders and proactive context distilled into one calm daily view." tone="plum" />
          <Portal href="/dashboard/memory" eyebrow="Gogo Memory" title="Find what Gogo knows" detail={`Search what you saved and the context Gogo can use later. ${listCount ? `${listCount} lists are ready too.` : ''}`} tone="emerald" />
        </section>
      </div>
    </div>
  )
}