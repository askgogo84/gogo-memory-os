import { getSession } from '@/lib/dashboard/session'
import { getTodayCalendar } from '@/lib/dashboard/queries'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

function dayLine(now: Date): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(now)
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(now)
  return `${weekday}, ${dayMonth}`
}

export default async function CalendarPage() {
  const session = await getSession()
  const calendar = session ? await getTodayCalendar(session.telegramId) : ({ ok: true, connected: false } as const)
  const today = dayLine(new Date())

  if (!calendar.ok) {
    return (
      <div className="w-full">
        <header className="rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your schedule</p>
          <h1 className="mt-1 font-serif text-[36px] font-semibold tracking-[-0.8px] text-gogo-ink">Calendar</h1>
        </header>
        <div className="mt-5"><CardError message="Couldn’t load your calendar right now." /></div>
      </div>
    )
  }

  if (!calendar.connected) {
    return (
      <div className="w-full">
        <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-7 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-gogo-plum/10 blur-3xl" />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.25fr_.75fr]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your schedule</p>
              <h1 className="mt-1 font-serif text-[38px] font-semibold tracking-[-0.9px] text-gogo-ink">Calendar</h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-6 text-gogo-ink-3">Connect Google Calendar once and AskGogo can quietly fold your meetings into Today, reminders and your daily brief.</p>
              <div className="mt-5"><WhatsAppChip message="Gogo, connect my calendar" label="Connect Google Calendar" /></div>
            </div>
            <div className="grid min-h-[190px] place-items-center rounded-[26px] border border-dashed border-gogo-ink/10 bg-gogo-cream/45">
              <div className="text-center">
                <img src="/gogo-figure.png" alt="" className="mx-auto h-20 w-20 animate-[gogo-float_6s_ease-in-out_infinite]" />
                <div className="mt-2 font-serif text-[18px] font-semibold text-gogo-ink">I can hold your meetings too.</div>
                <div className="mt-1 text-[12px] text-gogo-ink-3">One connection, calmer days.</div>
              </div>
            </div>
          </div>
        </header>
      </div>
    )
  }

  const { events } = calendar

  return (
    <div className="w-full">
      <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-gogo-plum/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your schedule</p>
            <h1 className="mt-1 font-serif text-[38px] font-semibold tracking-[-0.9px] text-gogo-ink">Calendar</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-gogo-ink-3">{today}</p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gogo-ink/10 bg-gogo-surface px-2.5 py-1 text-[11px] font-semibold text-gogo-ink-2">
                <span className="h-2 w-2 rounded-full bg-gogo-plum" /> Google Calendar connected
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <WhatsAppChip message="Gogo, what’s on tomorrow?" label="Tomorrow" />
            <WhatsAppChip message="Gogo, add a meeting" label="Add event" />
          </div>
        </div>
      </header>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_340px]">
        <section className="min-h-[520px] rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/80 p-6 shadow-[0_18px_50px_rgba(62,35,18,0.045)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-ink-3">Today</p>
              <h2 className="mt-1 font-serif text-[26px] font-semibold text-gogo-ink">Your agenda</h2>
            </div>
            <div className="font-serif text-[26px] font-semibold text-gogo-plum">{events.length}</div>
          </div>

          {events.length === 0 ? (
            <div className="mt-6 grid min-h-[380px] place-items-center rounded-[22px] border border-dashed border-gogo-ink/10 bg-gogo-cream/30 text-center">
              <div>
                <img src="/gogo-figure.png" alt="" className="mx-auto h-16 w-16 opacity-90" />
                <div className="mt-3 font-serif text-[20px] font-semibold text-gogo-ink">Your calendar’s clear today.</div>
                <div className="mt-1 text-[13px] text-gogo-ink-3">Nothing scheduled — enjoy the quiet.</div>
              </div>
            </div>
          ) : (
            <ol className="relative mt-6 space-y-3 before:absolute before:bottom-4 before:left-[80px] before:top-4 before:w-px before:bg-gogo-ink/8">
              {events.map((e, index) => (
                <li key={e.id} className="relative grid grid-cols-[68px_1fr] gap-5 rounded-[20px] border border-gogo-ink/8 bg-gogo-cream/40 px-4 py-4 transition hover:bg-gogo-surface">
                  <div className="pt-0.5 text-right text-[12px] font-semibold tabular-nums text-gogo-ink-3">{e.time ?? 'all day'}</div>
                  <span className="absolute left-[75px] top-[23px] h-3 w-3 rounded-full border-[3px] border-gogo-surface bg-gogo-orange shadow-[0_0_0_1px_rgba(62,35,18,.08)]" />
                  <div>
                    <div className="text-[15px] font-semibold text-gogo-ink">{e.title}</div>
                    <div className="mt-1 text-[11.5px] text-gogo-ink-3">Google Calendar · event {index + 1}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/80 p-5 shadow-[0_18px_50px_rgba(62,35,18,0.04)] backdrop-blur-xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-ink-3">At a glance</p>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-[16px] bg-gogo-cream/55 px-4 py-3"><span className="text-[12.5px] text-gogo-ink-2">Events today</span><strong className="font-serif text-[20px] text-gogo-ink">{events.length}</strong></div>
              <div className="flex items-center justify-between rounded-[16px] bg-gogo-cream/55 px-4 py-3"><span className="text-[12.5px] text-gogo-ink-2">Calendar</span><strong className="text-[12px] text-gogo-plum">Connected</strong></div>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/80 p-5 shadow-[0_18px_50px_rgba(62,35,18,0.04)]">
            <div className="pointer-events-none absolute -bottom-12 -right-10 h-32 w-32 rounded-full bg-gogo-orange/10 blur-2xl" />
            <img src="/gogo-figure.png" alt="" className="relative h-14 w-14" />
            <div className="relative mt-3 font-serif text-[20px] font-semibold text-gogo-ink">Need space?</div>
            <p className="relative mt-2 text-[12.5px] leading-5 text-gogo-ink-3">Ask Gogo to move, add or remind you about anything on your schedule.</p>
            <div className="relative mt-4"><WhatsAppChip message="Gogo, help me plan today" label="Plan with Gogo" /></div>
          </section>
        </aside>
      </div>
    </div>
  )
}
