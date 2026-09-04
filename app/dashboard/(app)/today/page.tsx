import { Suspense } from 'react'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getTodayReminders,
  getLists,
  getUsageSummary,
  getTodayCalendar,
  getProfile,
  getFriendContacts,
  type ReminderRow,
} from '@/lib/dashboard/queries'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { countRecurringSeries } from '@/lib/dashboard/thread'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { ReminderThread } from '@/components/dashboard/reminder-thread'
import { TodayDesktop } from '@/components/dashboard/today-desktop'
import { CardError } from '@/components/dashboard/card-error'
import { CalendarIcon, ListsIcon, UsageIcon } from '@/components/dashboard/icons'

export const dynamic = 'force-dynamic'

function greetingPeriod(now: Date, tz: string): string {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now),
    10,
  )
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function dayLine(now: Date, tz: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(now)
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: tz }).format(now)
  return `${weekday}, ${dayMonth}`
}

function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function RestRow({
  title,
  fact,
  tone,
  Icon,
  chip,
}: {
  title: string
  fact: string
  tone: string
  Icon: typeof ListsIcon
  chip?: { message: string; label: string }
}) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[13px] py-3">
      <span className={tone}>
        <Icon className="block h-[22px] w-[22px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-gogo-ink">{title}</div>
        <div className="truncate text-[12.5px] text-gogo-ink-3">{fact}</div>
      </div>
      {chip && <WhatsAppChip message={chip.message} label={chip.label} />}
    </div>
  )
}

async function CalendarRestRow({ telegramId }: { telegramId: string }) {
  const calendar = await getTodayCalendar(telegramId)
  if (!calendar.ok || !calendar.connected) return null
  const fact =
    calendar.events.length > 0
      ? calendar.events
          .slice(0, 2)
          .map((e) => (e.time ? `${e.title} ${e.time}` : e.title))
          .join(' · ')
      : 'Clear today'
  return (
    <RestRow
      title="Calendar"
      fact={fact}
      tone="text-gogo-plum"
      Icon={CalendarIcon}
      chip={{ message: 'Gogo, what’s on today?', label: 'Ask' }}
    />
  )
}

export default async function TodayPage() {
  const session = await getSession()
  const [{ data: user }, today, lists, usage, memory, profile, friends] = await Promise.all([
    session
      ? supabaseAdmin
          .from('users')
          .select('whatsapp_id, name, timezone')
          .eq('telegram_id', parseInt(session.telegramId, 10))
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session ? getTodayReminders(session.telegramId) : Promise.resolve({ ok: true as const, reminders: [] }),
    session ? getLists(session.telegramId) : Promise.resolve({ ok: true as const, lists: [] }),
    session ? getUsageSummary(session.telegramId) : Promise.resolve({ ok: false } as const),
    session ? getDashboardMemory(session.telegramId) : Promise.resolve({ ok: true as const, items: [] }),
    session ? getProfile(session.telegramId) : Promise.resolve({ ok: false } as const),
    session ? getFriendContacts(session.telegramId) : Promise.resolve({ ok: true as const, contacts: [], count: 0 }),
  ])

  const tz = user?.timezone || 'Asia/Kolkata'
  const now = new Date()
  const firstName = user?.name?.trim().split(/\s+/)[0]
  const greeting = firstName ? `Good ${greetingPeriod(now, tz)}, ${firstName}` : `Good ${greetingPeriod(now, tz)}`

  const reminders = today.ok ? today.reminders : []
  const nowMs = now.getTime()
  const isPast = (r: ReminderRow) => r.sent === true || new Date(r.remind_at).getTime() <= nowMs
  const upcoming = reminders.filter((r) => !isPast(r))
  const leftCount = upcoming.length
  const doneCount = reminders.length - leftCount
  const recurringCount = countRecurringSeries(reminders)
  const leftLabel = leftCount === 0 ? 'nothing left' : leftCount === 1 ? 'one thing left' : `${leftCount} things left`
  const hasThread = today.ok && reminders.length > 0

  const pills: Array<{ label: string; count: number; active: boolean }> = [
    { label: 'Today', count: leftCount, active: true },
    { label: 'Recurring', count: recurringCount, active: false },
    { label: 'Done', count: doneCount, active: false },
  ]

  type RestRowData = {
    key: string
    title: string
    fact: string
    tone: string
    Icon: typeof ListsIcon
    chip?: { message: string; label: string }
  }
  const restRows: RestRowData[] = []

  if (lists.ok && lists.lists.length > 0) {
    const top = lists.lists[0]
    const total = top.items.length
    const open = top.items.filter((i) => !i.done).length
    const name = sentenceCase(top.name)
    restRows.push({
      key: 'lists',
      title: 'Lists',
      fact: `${name} · ${open} of ${total} left`,
      tone: 'text-gogo-plum',
      Icon: ListsIcon,
      chip: { message: `Gogo, add to ${name}`, label: 'Add' },
    })
  }

  if (usage.ok) {
    restRows.push({
      key: 'usage',
      title: 'Usage',
      fact: `${usage.usage.aiToday} of ${usage.limits.aiPerDay} actions today`,
      tone: 'text-gogo-orange',
      Icon: UsageIcon,
    })
  }

  return (
    <>
      <div className="flex flex-col gap-5 lg:hidden">
        <header>
          <h1 className="font-serif text-[26px] font-semibold leading-[1.15] tracking-[-0.4px] text-gogo-ink">{greeting}</h1>
          <p className="mt-[5px] text-[13px] font-medium text-gogo-ink-3">
            {dayLine(now, tz)}
            {hasThread ? ` · ${leftLabel}` : ''}
          </p>

          {hasThread && (
            <div className="mt-4 flex flex-wrap gap-[7px]">
              {pills.map((p) => (
                <span
                  key={p.label}
                  className={
                    p.active
                      ? 'inline-flex items-center gap-1.5 rounded-full bg-gogo-orange px-[13px] py-[7px] text-[12.5px] font-semibold text-white'
                      : 'inline-flex items-center gap-1.5 rounded-full border border-gogo-ink/10 bg-gogo-surface px-[13px] py-[7px] text-[12.5px] font-semibold text-gogo-ink-2'
                  }
                >
                  {p.label}
                  <span className={p.active ? 'opacity-75' : 'text-gogo-ink-3'}>{p.count}</span>
                </span>
              ))}
            </div>
          )}
        </header>

        {!today.ok ? (
          <CardError message="Couldn’t load your reminders right now." />
        ) : today.reminders.length === 0 ? (
          <EmptyState message="Nothing pending. That’s the idea." action={<WhatsAppChip message="Gogo, remind me to…" />} />
        ) : (
          <>
            <ReminderThread rows={today.reminders} tz={tz} />
            <div><WhatsAppChip message="Gogo, remind me to…" /></div>
          </>
        )}
        {restRows.length > 0 && (
          <section className="flex flex-col gap-[9px]">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">The rest of today</h2>
            {restRows.map((row) => (
              <RestRow key={row.key} title={row.title} fact={row.fact} tone={row.tone} Icon={row.Icon} chip={row.chip} />
            ))}
            {session && (
              <Suspense fallback={null}>
                <CalendarRestRow telegramId={session.telegramId} />
              </Suspense>
            )}
          </section>
        )}
      </div>

      <div className="hidden lg:block [&>div]:mx-0 [&>div]:max-w-none">
        <TodayDesktop
          greeting={greeting}
          dayLine={dayLine(now, tz)}
          leftLabel={leftLabel}
          hasThread={hasThread}
          today={today}
          lists={lists}
          usage={usage}
          memory={memory}
          profile={profile}
          friends={friends}
          telegramId={session?.telegramId || null}
          tz={tz}
        />
      </div>
    </>
  )
}
