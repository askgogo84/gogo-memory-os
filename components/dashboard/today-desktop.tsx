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
import { TodayIcon, ListsIcon, MemoryIcon, CalendarIcon, YouIcon } from './icons'
import { WhatsAppChip } from './whatsapp-chip'
import { CommandBar } from './command-bar'
import { CardError } from './card-error'

function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function DashboardCard({
  title,
  Icon,
  accent,
  count,
  href,
  action,
  children,
}: {
  title: string
  Icon: typeof TodayIcon
  accent: 'orange' | 'plum' | 'green'
  count?: ReactNode
  href?: string
  action?: ReactNode
  children: ReactNode
}) {
  const accentText = accent === 'orange' ? 'text-gogo-orange' : accent === 'plum' ? 'text-gogo-plum' : 'text-emerald-600'
  const body = (
    <div className="group h-full min-h-[190px] rounded-[24px] border border-gogo-ink/10 bg-gogo-surface p-5 shadow-[0_12px_34px_rgba(62,35,18,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(62,35,18,0.075)]">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 place-items-center rounded-xl bg-gogo-cream ${accentText}`}>
          <Icon className="block h-[19px] w-[19px]" />
        </span>
        <div className="flex-1 text-[17px] font-semibold text-gogo-ink">{title}</div>
        {count !== undefined && <div className={`font-serif text-[29px] font-semibold leading-none ${accentText}`}>{count}</div>}
      </div>
      <div className="mt-4">{children}</div>
      <div className="mt-4 flex items-center justify-between gap-3">
        {action ?? <span />}
        {href && <span className="text-[11.5px] font-semibold text-gogo-ink-3 transition-colors group-hover:text-gogo-orange">View all →</span>}
      </div>
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

async function CalendarOverview({ telegramId }: { telegramId: string }) {
  const calendar = await getTodayCalendar(telegramId)
  if (!calendar.ok) {
    return (
      <DashboardCard title="Calendar" Icon={CalendarIcon} accent="plum" count="—" href="/dashboard/calendar">
        <p className="text-[13px] text-gogo-ink-3">Couldn’t load calendar.</p>
      </DashboardCard>
    )
  }
  if (!calendar.connected) {
    return (
      <DashboardCard title="Calendar" Icon={CalendarIcon} accent="plum" count="0" href="/dashboard/calendar">
        <p className="text-[13px] text-gogo-ink-3">Connect Google Calendar to bring today’s schedule into AskGogo.</p>
      </DashboardCard>
    )
  }
  const first = calendar.events[0]
  const second = calendar.events[1]
  return (
    <DashboardCard
      title="Calendar"
      Icon={CalendarIcon}
      accent="plum"
      count={calendar.events.length}
      href="/dashboard/calendar"
      action={<WhatsAppChip message="Gogo, what’s on today?" label="Ask what’s on today" />}
    >
      {first ? (
        <div className="space-y-2">
          <div className="text-[13.5px] font-semibold text-gogo-ink-2">{first.time ? `${first.time} · ` : ''}{first.title}</div>
          {second && <div className="truncate text-[12.5px] text-gogo-ink-3">{second.time ? `${second.time} · ` : ''}{second.title}</div>}
        </div>
      ) : <p className="text-[13px] text-gogo-ink-3">Nothing scheduled today.</p>}
    </DashboardCard>
  )
}

function UsagePanel({ usage }: { usage: UsageSummary }) {
  if (!usage.ok) return <CardError message="Couldn’t load usage right now." />
  const used = usage.usage.aiToday
  const limit = usage.limits.aiPerDay
  const frac = limit > 0 ? Math.min(used / limit, 1) : 0
  const circ = 2 * Math.PI * 86
  const dash = frac * circ
  return (
    <Link href="/dashboard/usage" className="block h-full rounded-[24px] border border-gogo-ink/10 bg-gogo-surface p-5 shadow-[0_12px_34px_rgba(62,35,18,0.04)] transition hover:-translate-y-0.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-gogo-ink-3">Daily briefing & usage</div>
      <div className="mt-4 flex items-center gap-5">
        <div className="relative h-[118px] w-[118px] flex-none">
          <svg viewBox="0 0 200 200" width="118" height="118" className="absolute inset-0" aria-hidden="true">
            <circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" className="text-gogo-ink/8" strokeWidth="12" />
            <circle cx="100" cy="100" r="86" fill="none" stroke="#F18219" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 100 100)" />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="font-serif text-[30px] font-semibold text-gogo-ink">{used}</div><div className="text-[10px] text-gogo-ink-3">of {limit}</div></div></div>
        </div>
        <div>
          <div className="font-serif text-[22px] font-semibold text-gogo-ink">Your day, at a glance</div>
          <p className="mt-2 text-[12.5px] leading-5 text-gogo-ink-3">AskGogo can brief you on reminders, calendar, saved memory and what needs attention.</p>
          <div className="mt-3"><WhatsAppChip message="Gogo, brief me on my day" label="Brief my day" /></div>
        </div>
      </div>
    </Link>
  )
}

function ConnectionsOverview({ profile }: { profile: Profile }) {
  const rows = profile.ok
    ? [
        ['Google Calendar', profile.connections.googleCalendar],
        ['Gmail', profile.connections.gmail],
        ['CreditIQ', profile.connections.creditiq],
      ] as const
    : []
  const connected = rows.filter(([, ok]) => ok).length
  return (
    <DashboardCard title="Integrations" Icon={YouIcon} accent="green" count={connected} href="/dashboard/you">
      <div className="space-y-2">
        {rows.length ? rows.map(([name, ok]) => (
          <div key={name} className="flex items-center justify-between text-[12.5px]"><span className="text-gogo-ink-2">{name}</span><span className={ok ? 'font-semibold text-emerald-600' : 'text-gogo-ink-3'}>{ok ? 'Connected' : 'Not connected'}</span></div>
        )) : <p className="text-[12.5px] text-gogo-ink-3">Connection status unavailable.</p>}
      </div>
    </DashboardCard>
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

  return (
    <div className="w-full">
      <section className="relative overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-gogo-surface px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)]">
        <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-gogo-orange/10 blur-3xl" />
        <div className="pointer-events-none absolute left-[42%] top-0 h-48 w-96 -translate-x-1/2 rounded-full bg-gogo-plum/8 blur-3xl" />
        <div className="relative flex items-start justify-between gap-8">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gogo-orange">Welcome back</p>
            <h1 className="mt-1 font-serif text-[38px] font-semibold leading-[1.08] tracking-[-0.9px] text-gogo-ink">{greeting}</h1>
            <p className="mt-2 text-[13px] font-medium text-gogo-ink-3">{dayLine}{hasThread ? ` · ${leftLabel}` : ''}</p>
          </div>
          <div className="hidden items-center gap-2 xl:flex">
            <WhatsAppChip message="Gogo, brief me on my day" label="Brief my day" />
            <WhatsAppChip message="Gogo, what did I save recently?" label="Search memory" />
          </div>
        </div>
        <div className="relative mt-5"><CommandBar /></div>
      </section>

      <section className="mt-4 grid grid-cols-3 gap-4">
        <DashboardCard
          title="Reminders"
          Icon={TodayIcon}
          accent="orange"
          count={upcoming.length}
          href="/dashboard/today"
          action={<WhatsAppChip message="Gogo, remind me to…" label="New reminder" />}
        >
          {!today.ok ? <p className="text-[13px] text-gogo-ink-3">Couldn’t load reminders.</p> : upcoming[0] ? <div className="space-y-2"><div className="text-[13.5px] font-semibold text-gogo-ink-2">Next · {upcoming[0].label} at {upcoming[0].timeLabel}</div>{upcoming[1] && <div className="truncate text-[12.5px] text-gogo-ink-3">Then · {upcoming[1].label}</div>}</div> : <p className="text-[13px] text-gogo-ink-3">Nothing scheduled yet.</p>}
        </DashboardCard>

        {telegramId ? <Suspense fallback={<div className="min-h-[190px] animate-pulse rounded-[24px] border border-gogo-ink/8 bg-gogo-surface/60" />}><CalendarOverview telegramId={telegramId} /></Suspense> : null}

        <DashboardCard
          title="Lists"
          Icon={ListsIcon}
          accent="plum"
          count={listRows.length}
          href="/dashboard/lists"
          action={<WhatsAppChip message={topList ? `Gogo, add to ${topName}` : 'Gogo, start a list'} label={topList ? `Add to ${topName}` : 'Start a list'} />}
        >
          {!lists.ok ? <p className="text-[13px] text-gogo-ink-3">Couldn’t load lists.</p> : topList ? <div className="space-y-2"><div className="text-[13.5px] font-semibold text-gogo-ink-2">{topName} · {topOpen} of {topList.items.length} left</div>{secondList && <div className="text-[12.5px] text-gogo-ink-3">{sentenceCase(secondList.name)} · {secondList.items.filter((i) => !i.done).length} left</div>}</div> : <p className="text-[13px] text-gogo-ink-3">No lists yet.</p>}
        </DashboardCard>
      </section>

      <section className="mt-4 grid grid-cols-3 gap-4">
        <DashboardCard title="Memory" Icon={MemoryIcon} accent="green" count={memoryItems.length} href="/dashboard/memory" action={<WhatsAppChip message="Gogo, save this for me" label="Save something" />}>
          {recentMemory.length ? <div className="space-y-2">{recentMemory.map((item) => <div key={item.id} className="rounded-xl border border-gogo-ink/8 bg-gogo-cream/55 px-3 py-2"><div className="truncate text-[12.5px] font-semibold text-gogo-ink-2">{item.title}</div><div className="mt-0.5 truncate text-[11.5px] text-gogo-ink-3">{item.subtitle}</div></div>)}</div> : <p className="text-[13px] text-gogo-ink-3">Nothing saved yet.</p>}
        </DashboardCard>

        <DashboardCard title="People" Icon={YouIcon} accent="orange" count={friends.ok ? friends.count : '—'} href="/dashboard/you">
          <div className="font-serif text-[20px] font-semibold text-gogo-ink">People you remind</div>
          <p className="mt-2 text-[12.5px] leading-5 text-gogo-ink-3">Friend reminders, saved contacts and shared context all in one place.</p>
        </DashboardCard>

        <ConnectionsOverview profile={profile} />
      </section>

      <section className="mt-4 grid grid-cols-12 gap-4">
        <div className="col-span-8 rounded-[24px] border border-gogo-ink/10 bg-gogo-surface p-5 shadow-[0_12px_34px_rgba(62,35,18,0.04)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-gogo-ink-3">Your day</div>
              <div className="mt-1 font-serif text-[24px] font-semibold text-gogo-ink">What needs your attention</div>
            </div>
            <WhatsAppChip message="Gogo, what’s next?" label="What’s next?" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {upcoming.length ? upcoming.slice(0, 3).map((item, idx) => (
              <div key={`${item.label}-${idx}`} className="rounded-[18px] border border-gogo-ink/8 bg-gogo-cream/55 p-4">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-gogo-orange">{item.timeLabel}</div>
                <div className="mt-2 text-[14px] font-semibold text-gogo-ink">{item.label}</div>
                <div className="mt-1 text-[11.5px] text-gogo-ink-3">Reminder</div>
              </div>
            )) : <div className="col-span-3 rounded-[18px] border border-dashed border-gogo-ink/10 bg-gogo-cream/35 px-5 py-9 text-center text-[13px] text-gogo-ink-3">Your schedule is clear for now.</div>}
          </div>
        </div>
        <div className="col-span-4"><UsagePanel usage={usage} /></div>
      </section>

      <section className="mt-4 rounded-[24px] border border-gogo-ink/10 bg-gogo-surface p-5 shadow-[0_12px_34px_rgba(62,35,18,0.04)]">
        <div className="flex items-center justify-between"><div><div className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-gogo-ink-3">Quick actions</div><div className="mt-1 font-serif text-[21px] font-semibold text-gogo-ink">Get something done</div></div><span className="text-[11px] text-gogo-ink-3">Powered by WhatsApp</span></div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <WhatsAppChip message="Gogo, remind me to…" label="＋ Add reminder" />
          <WhatsAppChip message="Gogo, save this for me" label="＋ Save memory" />
          <WhatsAppChip message="Gogo, start a list" label="＋ Create list" />
          <WhatsAppChip message="Gogo, add an event to my calendar" label="＋ Add calendar event" />
        </div>
      </section>
    </div>
  )
}
