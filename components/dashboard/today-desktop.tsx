import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { buildThread } from '@/lib/dashboard/thread'
import {
  getTodayCalendar,
  type TodayReminders,
  type Lists,
  type UsageSummary,
  type Profile,
  type FriendContacts,
} from '@/lib/dashboard/queries'
import type { DashboardMemory } from '@/lib/dashboard/memory'
import { TodayIcon, ListsIcon, MemoryIcon, CalendarIcon, YouIcon, UsageIcon } from './icons'
import { WhatsAppChip } from './whatsapp-chip'
import { CommandBar } from './command-bar'
import { CardError } from './card-error'

function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function ZenCard({
  eyebrow,
  title,
  Icon,
  accent,
  count,
  href,
  action,
  children,
}: {
  eyebrow?: string
  title: string
  Icon: typeof TodayIcon
  accent: 'orange' | 'plum' | 'green'
  count?: ReactNode
  href?: string
  action?: ReactNode
  children: ReactNode
}) {
  const accentText = accent === 'orange' ? 'text-gogo-orange' : accent === 'plum' ? 'text-gogo-plum' : 'text-emerald-600'
  const accentBg = accent === 'orange' ? 'bg-gogo-orange-tint' : accent === 'plum' ? 'bg-gogo-plum-tint' : 'bg-emerald-500/10'
  const body = (
    <article className="group relative h-full overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/88 p-5 shadow-[0_16px_44px_rgba(62,35,18,0.045)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(62,35,18,0.075)]">
      <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-gogo-orange/5 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <span className={`grid h-10 w-10 flex-none place-items-center rounded-[14px] ${accentBg} ${accentText}`}>
          <Icon className="block h-[19px] w-[19px]" />
        </span>
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">{eyebrow}</div>}
          <h2 className="mt-0.5 text-[17px] font-semibold tracking-[-0.2px] text-gogo-ink">{title}</h2>
        </div>
        {count !== undefined && <div className={`font-serif text-[31px] font-semibold leading-none ${accentText}`}>{count}</div>}
      </div>
      <div className="relative mt-4 min-h-[72px]">{children}</div>
      <div className="relative mt-4 flex items-center justify-between gap-3">
        {action ?? <span />}
        {href && <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-gogo-ink-4 transition-colors group-hover:text-gogo-orange">Open →</span>}
      </div>
    </article>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

async function CalendarCard({ telegramId }: { telegramId: string }) {
  const calendar = await getTodayCalendar(telegramId)
  if (!calendar.ok) {
    return (
      <ZenCard eyebrow="Schedule" title="Calendar" Icon={CalendarIcon} accent="plum" count="—" href="/dashboard/calendar">
        <p className="text-[13px] leading-5 text-gogo-ink-3">Couldn’t load your calendar right now.</p>
      </ZenCard>
    )
  }
  if (!calendar.connected) {
    return (
      <ZenCard eyebrow="Schedule" title="Calendar" Icon={CalendarIcon} accent="plum" count="0" href="/dashboard/calendar">
        <p className="text-[13px] leading-5 text-gogo-ink-3">Connect Google Calendar and let AskGogo keep the day in view.</p>
      </ZenCard>
    )
  }
  return (
    <ZenCard
      eyebrow="Schedule"
      title="Calendar"
      Icon={CalendarIcon}
      accent="plum"
      count={calendar.events.length}
      href="/dashboard/calendar"
      action={<WhatsAppChip message="Gogo, what’s on today?" label="Ask what’s on today" />}
    >
      {calendar.events.length ? (
        <div className="space-y-2">
          {calendar.events.slice(0, 2).map((event) => (
            <div key={event.id} className="flex items-center gap-2 text-[13px] text-gogo-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gogo-plum" />
              <span className="truncate"><strong>{event.time || 'All day'}</strong> · {event.title}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-[13px] leading-5 text-gogo-ink-3">Your calendar is clear today.</p>}
    </ZenCard>
  )
}

function UsagePulse({ usage }: { usage: UsageSummary }) {
  if (!usage.ok) return <CardError message="Couldn’t load usage right now." />
  const used = usage.usage.aiToday
  const limit = usage.limits.aiPerDay
  const frac = limit > 0 ? Math.min(used / limit, 1) : 0
  const circ = 2 * Math.PI * 84
  const dash = frac * circ
  const message = frac < 0.55 ? 'Plenty of room today.' : frac < 0.85 ? 'You’re moving at a healthy pace.' : 'A busy day — AskGogo is keeping up.'
  return (
    <Link href="/dashboard/usage" className="block rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/88 p-5 shadow-[0_16px_44px_rgba(62,35,18,0.045)] backdrop-blur-xl transition hover:-translate-y-0.5">
      <div className="flex items-center gap-5">
        <div className="relative h-[108px] w-[108px] flex-none">
          <svg viewBox="0 0 200 200" width="108" height="108" className="absolute inset-0" aria-hidden="true">
            <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" className="text-gogo-ink/8" strokeWidth="11" />
            <circle cx="100" cy="100" r="84" fill="none" stroke="#F18219" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 100 100)" />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div><div className="font-serif text-[30px] font-semibold text-gogo-ink">{used}</div><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gogo-ink-4">of {limit}</div></div>
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Quiet pulse</div>
          <div className="mt-1 font-serif text-[23px] font-semibold tracking-[-0.4px] text-gogo-ink">You’re doing fine.</div>
          <p className="mt-2 text-[12.5px] leading-5 text-gogo-ink-3">{message}</p>
        </div>
      </div>
    </Link>
  )
}

function ConnectionsCard({ profile }: { profile: Profile }) {
  const rows = profile.ok
    ? [
        ['Calendar', profile.connections.googleCalendar],
        ['Gmail', profile.connections.gmail],
        ['CreditIQ', profile.connections.creditiq],
      ] as const
    : []
  const connected = rows.filter(([, ok]) => ok).length
  return (
    <ZenCard eyebrow="Your ecosystem" title="Connected apps" Icon={UsageIcon} accent="green" count={connected} href="/dashboard/you">
      {rows.length ? (
        <div className="space-y-2.5">
          {rows.map(([name, ok]) => (
            <div key={name} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-gogo-ink-2">{name}</span>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${ok ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gogo-cream text-gogo-ink-4'}`}>{ok ? 'Connected' : 'Not connected'}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-[13px] leading-5 text-gogo-ink-3">Connection status is unavailable right now.</p>}
    </ZenCard>
  )
}

export function TodayDesktop({
  greeting,
  dayLine,
  leftLabel,
  hasThread,
  today,
  lists,
  usage,
  memory,
  profile,
  friends,
  telegramId,
  tz,
}: {
  greeting: string
  dayLine: string
  leftLabel: string
  hasThread: boolean
  today: TodayReminders
  lists: Lists
  usage: UsageSummary
  memory: DashboardMemory
  profile: Profile
  friends: FriendContacts
  telegramId: string | null
  tz: string
}) {
  const model = today.ok ? buildThread(today.reminders, new Date(), tz) : null
  const upcoming = model?.after ?? []
  const listRows = lists.ok ? lists.lists : []
  const topList = listRows[0]
  const secondList = listRows[1]
  const topOpen = topList ? topList.items.filter((i) => !i.done).length : 0
  const topName = topList ? sentenceCase(topList.name) : ''
  const memoryItems = memory.ok ? memory.items : []
  const recentMemory = memoryItems.slice(0, 3)
  const people = friends.ok ? friends.contacts.slice(0, 4) : []

  return (
    <div className="mx-auto w-full max-w-[1540px] pb-8">
      <section className="relative overflow-hidden rounded-[34px] border border-gogo-ink/7 bg-gogo-surface/72 px-8 py-8 shadow-[0_24px_80px_rgba(62,35,18,0.055)] backdrop-blur-2xl xl:px-10 xl:py-9">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-gogo-orange/10 blur-[90px]" />
        <div className="pointer-events-none absolute left-[44%] top-[-10rem] h-80 w-[34rem] -translate-x-1/2 rounded-full bg-gogo-plum/8 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-[-12rem] right-[18%] h-72 w-72 rounded-full bg-emerald-400/7 blur-[90px]" />
        <div className="relative grid grid-cols-[minmax(0,1fr)_220px] items-center gap-8">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.08)]" />
              Everything is under control
            </div>
            <h1 className="mt-4 max-w-[850px] font-serif text-[44px] font-semibold leading-[1.02] tracking-[-1.1px] text-gogo-ink xl:text-[52px]">{greeting}</h1>
            <p className="mt-3 text-[14px] font-medium text-gogo-ink-3">{dayLine}{hasThread ? ` · ${leftLabel}` : ' · a quiet day'}</p>
            <p className="mt-5 max-w-[720px] text-[15px] leading-7 text-gogo-ink-2">You don’t need to remember everything. AskGogo is holding the details, the follow-ups and the little things in one calm place.</p>
          </div>
          <div className="relative hidden h-[190px] items-center justify-center xl:flex">
            <div className="absolute h-40 w-40 rounded-full bg-gogo-orange/12 blur-3xl" />
            <img src="/gogo-figure.png" alt="" className="relative h-[146px] w-[146px] object-contain drop-shadow-[0_24px_30px_rgba(62,35,18,0.12)]" />
          </div>
        </div>
        <div className="relative mt-7 max-w-[1040px]"><CommandBar /></div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          <WhatsAppChip message="Gogo, brief me on my day" label="Brief my day" />
          <WhatsAppChip message="Gogo, what’s next?" label="What’s next?" />
          <WhatsAppChip message="Gogo, what did I save recently?" label="Search memory" />
        </div>
      </section>

      <div className="mt-5 grid grid-cols-12 gap-5">
        <section className="col-span-8 grid grid-cols-2 gap-5 xl:grid-cols-3">
          <ZenCard
            eyebrow="Today"
            title="Reminders"
            Icon={TodayIcon}
            accent="orange"
            count={upcoming.length}
            href="/dashboard/today"
            action={<WhatsAppChip message="Gogo, remind me to…" label="New reminder" />}
          >
            {!today.ok ? <p className="text-[13px] text-gogo-ink-3">Couldn’t load reminders.</p> : upcoming[0] ? (
              <div className="space-y-2">
                <div className="text-[13.5px] font-semibold text-gogo-ink-2">Next · {upcoming[0].label}</div>
                <div className="text-[12px] text-gogo-ink-3">{upcoming[0].timeLabel}{upcoming[1] ? ` · then ${upcoming[1].label}` : ''}</div>
              </div>
            ) : <p className="text-[13px] leading-5 text-gogo-ink-3">Nothing needs your attention right now.</p>}
          </ZenCard>

          {telegramId ? <Suspense fallback={<div className="min-h-[220px] animate-pulse rounded-[28px] border border-gogo-ink/7 bg-gogo-surface/45" />}><CalendarCard telegramId={telegramId} /></Suspense> : null}

          <ZenCard
            eyebrow="Keep track"
            title="Lists"
            Icon={ListsIcon}
            accent="plum"
            count={listRows.length}
            href="/dashboard/lists"
            action={<WhatsAppChip message={topList ? `Gogo, add to ${topName}` : 'Gogo, start a list'} label={topList ? `Add to ${topName}` : 'Start a list'} />}
          >
            {topList ? (
              <div className="space-y-2">
                <div className="text-[13.5px] font-semibold text-gogo-ink-2">{topName} · {topOpen} of {topList.items.length} left</div>
                {secondList && <div className="text-[12px] text-gogo-ink-3">{sentenceCase(secondList.name)} · {secondList.items.filter((i) => !i.done).length} left</div>}
              </div>
            ) : <p className="text-[13px] leading-5 text-gogo-ink-3">No lists yet. Start one naturally in WhatsApp.</p>}
          </ZenCard>

          <ZenCard eyebrow="Remembered" title="Memory" Icon={MemoryIcon} accent="green" count={memoryItems.length} href="/dashboard/memory" action={<WhatsAppChip message="Gogo, save this for me" label="Save something" />}>
            {recentMemory.length ? (
              <div className="space-y-2">
                {recentMemory.map((item) => (
                  <div key={item.id} className="rounded-[14px] border border-gogo-ink/7 bg-gogo-cream/55 px-3 py-2.5">
                    <div className="truncate text-[12px] font-semibold text-gogo-ink-2">{item.title}</div>
                    <div className="mt-0.5 truncate text-[10.5px] text-gogo-ink-4">{item.subtitle}</div>
                  </div>
                ))}
              </div>
            ) : <p className="text-[13px] leading-5 text-gogo-ink-3">Nothing saved yet. Send AskGogo a document, screenshot or thought.</p>}
          </ZenCard>

          <ZenCard eyebrow="People" title="Your circle" Icon={YouIcon} accent="orange" count={friends.ok ? friends.count : '—'} href="/dashboard/you">
            {people.length ? (
              <div>
                <div className="flex -space-x-2">
                  {people.map((person) => <span key={person.name} title={person.name} className="grid h-9 w-9 place-items-center rounded-full border-2 border-gogo-surface bg-gogo-orange-tint text-[10px] font-bold text-gogo-orange">{person.initials}</span>)}
                </div>
                <p className="mt-3 text-[12.5px] leading-5 text-gogo-ink-3">People you remind, remember and keep in the loop.</p>
              </div>
            ) : <p className="text-[13px] leading-5 text-gogo-ink-3">Your people will appear here as AskGogo learns who matters to you.</p>}
          </ZenCard>

          <ConnectionsCard profile={profile} />
        </section>

        <aside className="col-span-4 flex flex-col gap-5">
          <section className="rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/88 p-5 shadow-[0_16px_44px_rgba(62,35,18,0.045)] backdrop-blur-xl">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Your flow</div>
            <div className="mt-1 font-serif text-[25px] font-semibold tracking-[-0.45px] text-gogo-ink">What’s ahead</div>
            <div className="mt-5 space-y-3">
              {upcoming.length ? upcoming.slice(0, 4).map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex gap-3 rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/48 p-3.5">
                  <div className="mt-1 h-2 w-2 flex-none rounded-full bg-gogo-orange" />
                  <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-[0.08em] text-gogo-orange">{item.timeLabel}</div><div className="mt-1 truncate text-[13px] font-semibold text-gogo-ink">{item.label}</div></div>
                </div>
              )) : <div className="rounded-[18px] border border-dashed border-gogo-ink/10 bg-gogo-cream/35 px-5 py-9 text-center text-[13px] leading-5 text-gogo-ink-3">Nothing pressing. Enjoy the space.</div>}
            </div>
            <div className="mt-4"><WhatsAppChip message="Gogo, what’s next?" label="Ask what’s next" /></div>
          </section>

          <UsagePulse usage={usage} />
        </aside>
      </div>

      <section className="mt-5 grid grid-cols-[1.35fr_.65fr] gap-5">
        <div className="rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/72 p-5 shadow-[0_16px_44px_rgba(62,35,18,0.04)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-5">
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">A little less to carry</div>
              <div className="mt-1 font-serif text-[24px] font-semibold tracking-[-0.4px] text-gogo-ink">Quick actions</div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <WhatsAppChip message="Gogo, remind me to…" label="Add reminder" />
              <WhatsAppChip message="Gogo, save this for me" label="Save memory" />
              <WhatsAppChip message="Gogo, start a list" label="Create list" />
              <WhatsAppChip message="Gogo, add an event" label="Add event" />
            </div>
          </div>
        </div>
        <div className="rounded-[28px] border border-gogo-ink/8 bg-[linear-gradient(135deg,var(--color-gogo-orange-tint),var(--color-gogo-plum-tint))] p-5 shadow-[0_16px_44px_rgba(62,35,18,0.04)]">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Your plan</div>
          <div className="mt-2 font-serif text-[25px] font-semibold text-gogo-ink">{profile.ok ? profile.planLabel : 'AskGogo'}</div>
          <p className="mt-2 text-[12px] leading-5 text-gogo-ink-3">Your dashboard stays private on this device for up to 30 days after sign-in.</p>
        </div>
      </section>
    </div>
  )
}
