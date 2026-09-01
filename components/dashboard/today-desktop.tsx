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
import { TodayThreadCompact } from './today-thread-compact'
import { CardError } from './card-error'

function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function DomainCard({
  title,
  Icon,
  accent,
  count,
  href,
  chip,
  children,
}: {
  title: string
  Icon: typeof TodayIcon
  accent: 'orange' | 'plum' | 'green'
  count: ReactNode
  href?: string
  chip?: ReactNode
  children: ReactNode
}) {
  const accentText = accent === 'orange' ? 'text-gogo-orange' : accent === 'plum' ? 'text-gogo-plum' : 'text-emerald-600'
  const body = (
    <div className="group h-full rounded-[22px] border border-gogo-ink/10 bg-gogo-surface px-[18px] py-[17px] shadow-[0_10px_35px_rgba(62,35,18,0.035)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_42px_rgba(62,35,18,0.07)]">
      <div className="flex items-center gap-2.5">
        <span className={accentText}><Icon className="block h-5 w-5" /></span>
        <div className="flex-1 text-[15.5px] font-semibold text-gogo-ink">{title}</div>
        <div className={`font-serif text-[25px] font-semibold leading-none ${accentText}`}>{count}</div>
      </div>
      {children}
      {chip && <div className="mt-3 flex flex-wrap gap-[7px]">{chip}</div>}
      {href && <div className="mt-3 text-[11.5px] font-semibold text-gogo-ink-3 transition-colors group-hover:text-gogo-orange">Open {title.toLowerCase()} →</div>}
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

function BreathRing({ usage }: { usage: UsageSummary }) {
  if (!usage.ok) return <CardError message="Couldn’t load usage right now." />
  const used = usage.usage.aiToday
  const limit = usage.limits.aiPerDay
  const frac = limit > 0 ? Math.min(used / limit, 1) : 0
  const circ = 2 * Math.PI * 88
  const dash = frac * circ
  const caption = frac < 0.6 ? 'Breathing easy.' : frac < 0.85 ? 'Plenty left today.' : frac < 1 ? 'Almost at today’s limit.' : 'Today’s limit reached.'

  return (
    <Link href="/dashboard/usage" className="flex items-center gap-4 rounded-[22px] border border-gogo-ink/10 bg-gogo-surface p-[18px] shadow-[0_10px_35px_rgba(62,35,18,0.035)] transition hover:-translate-y-0.5">
      <div className="relative h-[94px] w-[94px] flex-none">
        <svg viewBox="0 0 200 200" width="94" height="94" className="absolute inset-0" aria-hidden="true">
          <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" className="text-gogo-ink/8" strokeWidth="13" />
          <circle cx="100" cy="100" r="88" fill="none" stroke="#F18219" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 100 100)" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center"><span className="font-serif text-[25px] font-semibold leading-none text-gogo-ink">{used}</span></div>
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gogo-ink-3">Today’s breath</div>
        <div className="mt-[6px] text-[13px] text-gogo-ink-2">of {limit} actions today</div>
        <div className="mt-1 text-[12px] leading-[1.45] text-gogo-ink-3">{caption}</div>
      </div>
    </Link>
  )
}

async function CalendarCard({ telegramId }: { telegramId: string }) {
  const calendar = await getTodayCalendar(telegramId)
  if (!calendar.ok) {
    return (
      <DomainCard title="Calendar" Icon={CalendarIcon} accent="plum" count="—" href="/dashboard/calendar">
        <div className="mt-[10px] text-[13px] text-gogo-ink-3">Couldn’t load calendar.</div>
      </DomainCard>
    )
  }
  if (!calendar.connected) {
    return (
      <DomainCard title="Calendar" Icon={CalendarIcon} accent="plum" count="0" href="/dashboard/calendar">
        <div className="mt-[10px] text-[13px] text-gogo-ink-3">Connect Google Calendar to see your day here.</div>
      </DomainCard>
    )
  }
  const first = calendar.events[0]
  const second = calendar.events[1]
  return (
    <DomainCard title="Calendar" Icon={CalendarIcon} accent="plum" count={calendar.events.length} href="/dashboard/calendar">
      {first ? (
        <>
          <div className="mt-[10px] text-[13.5px] text-gogo-ink-2">Next · {first.title}{first.time ? ` · ${first.time}` : ''}</div>
          {second && <div className="mt-1 truncate text-[12.5px] text-gogo-ink-3">Then · {second.title}{second.time ? ` · ${second.time}` : ''}</div>}
        </>
      ) : <div className="mt-[10px] text-[13px] text-gogo-ink-3">Your calendar is clear today.</div>}
    </DomainCard>
  )
}

function ConnectionsCard({ profile }: { profile: Profile }) {
  const rows = profile.ok
    ? [
        ['Google Calendar', profile.connections.googleCalendar],
        ['Gmail', profile.connections.gmail],
        ['CreditIQ', profile.connections.creditiq],
      ] as const
    : []
  const connected = rows.filter(([, ok]) => ok).length
  return (
    <Link href="/dashboard/you" className="block rounded-[22px] border border-gogo-ink/10 bg-gogo-surface p-[18px] shadow-[0_10px_35px_rgba(62,35,18,0.035)] transition hover:-translate-y-0.5">
      <div className="flex items-center gap-2.5"><YouIcon className="h-5 w-5 text-gogo-orange" /><div className="flex-1 text-[15.5px] font-semibold text-gogo-ink">Connected apps</div><div className="font-serif text-[25px] font-semibold text-gogo-orange">{connected}</div></div>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map(([name, ok]) => (
          <div key={name} className="flex items-center justify-between text-[12.5px]"><span className="text-gogo-ink-2">{name}</span><span className={ok ? 'font-semibold text-emerald-600' : 'text-gogo-ink-3'}>{ok ? 'Connected' : 'Not connected'}</span></div>
        )) : <div className="text-[12.5px] text-gogo-ink-3">Connection status unavailable.</div>}
      </div>
    </Link>
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
  const lst = lists.ok ? lists.lists : []
  const topList = lst[0]
  const secondList = lst[1]
  const topOpen = topList ? topList.items.filter((i) => !i.done).length : 0
  const secondOpen = secondList ? secondList.items.filter((i) => !i.done).length : 0
  const topName = topList ? sentenceCase(topList.name) : ''
  const memoryItems = memory.ok ? memory.items : []
  const recentMemory = memoryItems[0]

  return (
    <div className="mx-auto w-full max-w-[1220px]">
      <section className="relative overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-gogo-surface px-6 py-5 shadow-[0_18px_55px_rgba(62,35,18,0.05)]">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-gogo-orange/8 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-44 w-72 -translate-x-1/2 rounded-full bg-gogo-plum/8 blur-3xl" />
        <div className="relative flex items-start justify-between gap-6">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gogo-orange">Your personal control center</p>
            <h1 className="mt-1 font-serif text-[34px] font-semibold leading-[1.12] tracking-[-0.8px] text-gogo-ink">{greeting}</h1>
            <p className="mt-1.5 text-[13px] font-medium text-gogo-ink-3">{dayLine}{hasThread ? ` · ${leftLabel}` : ''}</p>
          </div>
          <div className="hidden items-center gap-2 xl:flex">
            <WhatsAppChip message="Gogo, brief me on my day" label="Brief my day" />
            <WhatsAppChip message="Gogo, what did I save recently?" label="Search memory" />
          </div>
        </div>
        <div className="relative mt-5"><CommandBar /></div>
      </section>

      <div className="mt-[18px] grid grid-cols-12 gap-[14px]">
        <div className="col-span-8 grid grid-cols-2 gap-[14px]">
          <DomainCard title="Reminders" Icon={TodayIcon} accent="orange" count={upcoming.length} chip={<WhatsAppChip message="Gogo, remind me to…" />}>
            {!today.ok ? <div className="mt-[10px] text-[13px] text-gogo-ink-3">Couldn’t load reminders.</div> : upcoming[0] ? <><div className="mt-[10px] text-[13.5px] text-gogo-ink-2">Next · {upcoming[0].label} at {upcoming[0].timeLabel}</div>{upcoming[1] && <div className="mt-1 truncate text-[12.5px] text-gogo-ink-3">Then · {upcoming[1].label}</div>}</> : <div className="mt-[10px] text-[13px] text-gogo-ink-3">Nothing scheduled yet.</div>}
          </DomainCard>

          {telegramId ? <Suspense fallback={<div className="h-[174px] animate-pulse rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/60" />}><CalendarCard telegramId={telegramId} /></Suspense> : null}

          <DomainCard title="Memory" Icon={MemoryIcon} accent="green" count={memoryItems.length} href="/dashboard/memory">
            {recentMemory ? <><div className="mt-[10px] truncate text-[13.5px] text-gogo-ink-2">Latest · {recentMemory.title}</div><div className="mt-1 truncate text-[12.5px] text-gogo-ink-3">{recentMemory.subtitle}</div></> : <div className="mt-[10px] text-[13px] text-gogo-ink-3">Nothing saved yet.</div>}
          </DomainCard>

          <DomainCard title="Lists" Icon={ListsIcon} accent="plum" count={lst.length} href="/dashboard/lists" chip={topList ? <WhatsAppChip message={`Gogo, add to ${topName}`} label={`Add to ${topName}`} /> : <WhatsAppChip message="Gogo, start a list" label="Start a list" />}>
            {!lists.ok ? <div className="mt-[10px] text-[13px] text-gogo-ink-3">Couldn’t load lists.</div> : topList ? <><div className="mt-[10px] text-[13.5px] text-gogo-ink-2">{topName} · {topOpen} of {topList.items.length} left</div>{secondList && <div className="mt-1 text-[12.5px] text-gogo-ink-3">{sentenceCase(secondList.name)} · {secondOpen} left</div>}</> : <div className="mt-[10px] text-[13px] text-gogo-ink-3">No lists yet.</div>}
          </DomainCard>

          <div className="col-span-2 grid grid-cols-3 gap-[14px]">
            <ConnectionsCard profile={profile} />
            <Link href="/dashboard/you" className="rounded-[22px] border border-gogo-ink/10 bg-gogo-surface p-[18px] shadow-[0_10px_35px_rgba(62,35,18,0.035)] transition hover:-translate-y-0.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gogo-ink-3">People you remind</div>
              <div className="mt-2 font-serif text-[30px] font-semibold text-gogo-plum">{friends.ok ? friends.count : '—'}</div>
              <div className="mt-1 text-[12.5px] text-gogo-ink-3">Friend-to-friend reminders and saved contacts.</div>
            </Link>
            <Link href="/dashboard/memory" className="rounded-[22px] border border-gogo-ink/10 bg-gradient-to-br from-gogo-surface to-gogo-rail p-[18px] shadow-[0_10px_35px_rgba(62,35,18,0.035)] transition hover:-translate-y-0.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gogo-orange">Quick action</div>
              <div className="mt-2 font-serif text-[20px] font-semibold leading-tight text-gogo-ink">Find anything you’ve saved</div>
              <div className="mt-2 text-[12.5px] text-gogo-ink-3">Search documents, images, payments and memories.</div>
            </Link>
          </div>
        </div>

        <aside className="col-span-4 flex flex-col gap-[14px]">
          <div className="rounded-[22px] border border-gogo-ink/10 bg-gogo-surface p-[18px] shadow-[0_10px_35px_rgba(62,35,18,0.035)]">
            <div className="flex items-center justify-between"><div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gogo-ink-3">Your day</div><span className="text-[11px] text-gogo-ink-3">Today</span></div>
            {!today.ok ? <div className="mt-[14px] text-[13px] text-gogo-ink-3">Couldn’t load your day.</div> : today.reminders.length === 0 ? <div className="mt-[14px] rounded-[15px] bg-gogo-rail/70 px-4 py-5 text-center text-[13px] text-gogo-ink-3">Nothing on today. Add a reminder from WhatsApp.</div> : <TodayThreadCompact rows={today.reminders} tz={tz} />}
          </div>
          <BreathRing usage={usage} />
          <div className="rounded-[22px] border border-gogo-ink/10 bg-gogo-surface p-[18px] shadow-[0_10px_35px_rgba(62,35,18,0.035)]">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gogo-ink-3">AskGogo can help</div>
            <div className="mt-3 grid gap-2">
              {[
                ['Plan my day', 'Gogo, help me plan my day'],
                ['Find a saved file', 'Gogo, show me my recent documents'],
                ['Create a reminder', 'Gogo, remind me to…'],
              ].map(([label, message]) => <WhatsAppChip key={label} message={message} label={label} />)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
