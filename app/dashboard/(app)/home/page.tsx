import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, getLists } from '@/lib/dashboard/queries'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { CommandBar } from '@/components/dashboard/command-bar'

export const dynamic = 'force-dynamic'

function period(now: Date, tz: string) {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now), 10)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function Portal({ href, eyebrow, title, detail, accent }: { href: string; eyebrow: string; title: string; detail: string; accent: string }) {
  return (
    <Link href={href} className="zen-home-glass group rounded-[24px] border p-5 shadow-[0_18px_50px_rgba(62,35,18,0.045)] backdrop-blur-2xl transition duration-500 hover:-translate-y-1">
      <div className={`text-[9.5px] font-bold uppercase tracking-[0.16em] ${accent}`}>{eyebrow}</div>
      <div className="mt-2 font-serif text-[25px] font-semibold tracking-[-0.45px] text-gogo-ink">{title}</div>
      <div className="mt-1 text-[12px] leading-5 text-gogo-ink-3">{detail}</div>
      <div className="mt-4 text-[11px] font-bold text-gogo-ink-3 transition group-hover:text-gogo-orange">Open →</div>
    </Link>
  )
}

export default async function HomePage() {
  const session = await getSession()
  const tg = session?.telegramId || ''
  const tgNum = parseInt(tg, 10)
  const [{ data: user }, today, lists, memory] = await Promise.all([
    Number.isFinite(tgNum)
      ? supabaseAdmin.from('users').select('name, timezone').eq('telegram_id', tgNum).maybeSingle()
      : Promise.resolve({ data: null as any }),
    session ? getTodayReminders(session.telegramId) : Promise.resolve({ ok: true as const, reminders: [] }),
    session ? getLists(session.telegramId) : Promise.resolve({ ok: true as const, lists: [] }),
    session ? getDashboardMemory(session.telegramId) : Promise.resolve({ ok: true as const, items: [] }),
  ])

  const tz = user?.timezone || 'Asia/Kolkata'
  const now = new Date()
  const name = user?.name?.trim().split(/\s+/)[0] || 'there'
  const pending = today.ok ? today.reminders.filter((r) => !r.sent && new Date(r.remind_at).getTime() > now.getTime()).length : 0
  const listCount = lists.ok ? lists.lists.length : 0
  const memoryCount = memory.ok ? memory.items.length : 0

  return (
    <div className="zen-home relative min-h-[calc(100vh-3.5rem)] overflow-hidden rounded-[34px] border border-gogo-ink/6 shadow-[0_30px_90px_rgba(62,35,18,.07)]">
      <div className="pointer-events-none absolute -left-24 top-20 h-96 w-96 rounded-full bg-gogo-orange/10 blur-[90px]" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-[30rem] w-[30rem] rounded-full bg-gogo-plum/10 blur-[110px]" />
      <div className="pointer-events-none absolute inset-x-[18%] bottom-[-16%] h-[36%] rounded-[50%] bg-emerald-200/10 blur-[70px]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-[1180px] flex-col px-7 py-8 xl:px-12 xl:py-10">
        <div className="flex items-center justify-between gap-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gogo-ink-3">AskGogo · your calm space</div>
          <div className="zen-home-pill rounded-full border px-3.5 py-2 text-[11px] font-semibold text-gogo-ink-2 backdrop-blur-xl">Everything is under control</div>
        </div>

        <section className="mx-auto flex w-full max-w-[820px] flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="relative mb-4">
            <div className="absolute inset-[-25%] rounded-full bg-gogo-orange/16 blur-2xl" />
            <Link href="/dashboard/today" aria-label="Open Today" className="relative block transition duration-500 hover:scale-105">
              <img src="/gogo-figure.png" alt="Gogo" className="gogo-float h-24 w-24 rounded-full object-cover shadow-[0_20px_50px_rgba(113,76,119,.16)] xl:h-28 xl:w-28" />
            </Link>
          </div>

          <h1 className="font-serif text-[42px] font-semibold leading-[1.05] tracking-[-1px] text-gogo-ink xl:text-[52px]">Good {period(now, tz)}, {name}.</h1>
          <p className="mt-3 text-[16px] font-medium text-gogo-ink-2">You don’t have to keep it all in your head.</p>
          <p className="mt-1 text-[13px] text-gogo-ink-3">Tell Gogo what matters. Everything else can stay quiet.</p>

          <div className="mt-7 w-full"><CommandBar /></div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold text-gogo-ink-3">
            <span className="zen-home-pill rounded-full border px-3 py-2 backdrop-blur">{pending} reminders</span>
            <span className="zen-home-pill rounded-full border px-3 py-2 backdrop-blur">{memoryCount} memories</span>
            <span className="zen-home-pill rounded-full border px-3 py-2 backdrop-blur">{listCount} lists</span>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Portal href="/dashboard/today" eyebrow="Today" title="Move through the day" detail="Reminders, calendar and what needs your attention — nothing more." accent="text-gogo-orange" />
          <Portal href="/dashboard/memory" eyebrow="Memory" title="Find what you saved" detail="Documents, images and the things you asked Gogo not to forget." accent="zen-memory-accent" />
          <Portal href="/dashboard/tasks" eyebrow="Focus" title="Clear what’s pending" detail="See today, upcoming and completed actions in one calm board." accent="text-gogo-plum" />
        </section>
      </div>
    </div>
  )
}
