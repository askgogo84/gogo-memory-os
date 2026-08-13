import { Suspense } from 'react'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getTodayReminders,
  getLists,
  getUsageSummary,
  getTodayCalendar,
  type ReminderRow,
} from '@/lib/dashboard/queries'
import { countRecurringSeries } from '@/lib/dashboard/thread'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { ReminderThread } from '@/components/dashboard/reminder-thread'
import { TodayDesktop } from '@/components/dashboard/today-desktop'
import { CardError } from '@/components/dashboard/card-error'
import { CalendarIcon, ListsIcon, UsageIcon } from '@/components/dashboard/icons'

export const dynamic = 'force-dynamic'

// The Today surface: the day seen as a vertical thread with a now-marker (the
// signature of this screen). Identity — who you're signed in as — is resolved
// ONLY from the session's telegram_id, never a URL. All reminder reads go through
// lib/dashboard/queries.ts; all thread maths through lib/dashboard/thread.ts.

// Time-of-day greeting word, in the user's zone — the same zone the spine uses,
// so "Good evening" and the now-marker never disagree about what time it is.
function greetingPeriod(now: Date, tz: string): string {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now),
    10,
  )
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

// "Monday, 10 August" — weekday then day-before-month, in the user's zone.
function dayLine(now: Date, tz: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(now)
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: tz }).format(now)
  return `${weekday}, ${dayMonth}`
}

// Sentence-case a stored list name for display ("goa" → "Goa"), mirroring
// components/dashboard/list-collection.tsx. The stored value is never mutated.
function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// One "rest of today" row — icon, title, one fact line, optional prefill chip.
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

// The Calendar row as its own async server component so <Suspense> can stream it in
// AFTER the page has rendered — the Google token refresh + events fetch never delay
// Today. Renders nothing when the calendar isn't connected or the read fails: a
// missing row, never a blank one.
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
  // The (app) layout already guarantees a session. telegram_id is TEXT in
  // dashboard_sessions; users.telegram_id is bigint — cast at the boundary.
  // Identity and reminders are read in parallel (TRD §5: fetch in parallel).
  const session = await getSession()
  // Reminders drive the spine; lists / usage / calendar feed "the rest of today"
  // (now unblocked). All read in parallel; each degrades independently so a slow or
  // failed cross-domain read never blanks the day — its row is simply omitted.
  // Reminders drive the spine; lists + usage feed "the rest of today" — all cheap,
  // same-DB, read in parallel. The Calendar row is DELIBERATELY not here: it needs a
  // Google token refresh + API round-trip, which must never sit on Today's (the
  // landing surface's) critical path. It streams in separately via <Suspense> below.
  const [{ data: user }, today, lists, usage] = await Promise.all([
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
  ])

  // The whole spine renders in the user's CURRENT timezone (fallback IST), never
  // per-row — a row's stored zone is where it was set, not where the user is now.
  const tz = user?.timezone || 'Asia/Kolkata'
  const now = new Date()
  const firstName = user?.name?.trim().split(/\s+/)[0]
  const greeting = firstName ? `Good ${greetingPeriod(now, tz)}, ${firstName}` : `Good ${greetingPeriod(now, tz)}`

  // Filter-pill counts, derived honestly from the reminders already fetched — no
  // new query, no cross-domain read. Presentation only this phase: the pills carry
  // counts but don't filter yet. "past" is an instant comparison (same rule the
  // thread uses), so Done here matches what renders struck-through on the spine.
  const reminders = today.ok ? today.reminders : []
  const nowMs = now.getTime()
  const isPast = (r: ReminderRow) => r.sent === true || new Date(r.remind_at).getTime() <= nowMs
  const upcoming = reminders.filter((r) => !isPast(r))
  // Today pill and the date-line count are the SAME population on purpose: every
  // upcoming occurrence, recurring or not — exactly the nodes the thread draws
  // above the now-marker. Pointing both at leftCount means "Today N" and
  // "N things left" can never contradict each other six pixels apart.
  const leftCount = upcoming.length
  const doneCount = reminders.length - leftCount
  // Recurring is an INDEPENDENT lens, not a slice of leftCount: distinct recurring
  // series in today's rows, past or upcoming (see countRecurringSeries). So the
  // three pills no longer partition — they're three ways of reading the same day.
  const recurringCount = countRecurringSeries(reminders)
  const leftLabel =
    leftCount === 0 ? 'nothing left' : leftCount === 1 ? 'one thing left' : `${leftCount} things left`
  const hasThread = today.ok && reminders.length > 0

  const pills: Array<{ label: string; count: number; active: boolean }> = [
    { label: 'Today', count: leftCount, active: true },
    { label: 'Recurring', count: recurringCount, active: false },
    { label: 'Done', count: doneCount, active: false },
  ]

  // "The rest of today": one row per other surface, REAL facts only. A row with no
  // available fact (calendar not connected, lists empty, meter down) is omitted —
  // never shown blank. A count-less row would just be the tab bar one screen lower.
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

  // The Calendar row is NOT built here — it streams in via <CalendarRestRow> so its
  // Google round-trip never blocks the page.

  return (
    // Two treatments of the SAME today, split at lg. Below lg: the untouched mobile
    // stack (frame 1i's two-column arrangement is gone — this tree carries no lg:-
    // prefixes, so 375px renders byte-for-byte as before). At lg: an entirely
    // separate DOM, the aggregate (frame 3a), because its order diverges too far
    // from the spine to share one tree. Data is fetched once above and handed to
    // both; neither reads anything the other doesn't.
    <>
      {/* MOBILE — the single stack, hidden at lg. */}
      <div className="flex flex-col gap-5 lg:hidden">
      <header>
        <h1 className="font-serif text-[26px] font-semibold leading-[1.15] tracking-[-0.4px] text-gogo-ink">
          {greeting}
        </h1>
        <p className="mt-[5px] text-[13px] font-medium text-gogo-ink-3">
          {dayLine(now, tz)}
          {hasThread ? ` · ${leftLabel}` : ''}
        </p>

        {hasThread && (
          // Presentation-only filter pills. No onClick, no filter state yet — the
          // counts are the point this phase, not the filtering.
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
        // A read failure is not an empty day — show a retry, never a blank thread.
        <CardError message="Couldn’t load your reminders right now." />
      ) : today.reminders.length === 0 ? (
        <EmptyState message="Nothing pending. That’s the idea." action={<WhatsAppChip message="Gogo, remind me to…" />} />
      ) : (
        <>
          <ReminderThread rows={today.reminders} tz={tz} />
          <div>
            <WhatsAppChip message="Gogo, remind me to…" />
          </div>
        </>
      )}
      {restRows.length > 0 && (
        // "The rest of today" — the mobile aggregate stack, sitting under the thread.
        <section className="flex flex-col gap-[9px]">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">The rest of today</h2>
          {restRows.map((row) => (
            <RestRow key={row.key} title={row.title} fact={row.fact} tone={row.tone} Icon={row.Icon} chip={row.chip} />
          ))}
          {/* Calendar streams in — its Google round-trip is off the critical path. */}
          {session && (
            <Suspense fallback={null}>
              <CalendarRestRow telegramId={session.telegramId} />
            </Suspense>
          )}
        </section>
      )}
      </div>

      {/* DESKTOP — the aggregate, frame 3a. lg only; a wholly separate DOM. */}
      <div className="hidden lg:block">
        <TodayDesktop
          greeting={greeting}
          dayLine={dayLine(now, tz)}
          leftLabel={leftLabel}
          hasThread={hasThread}
          today={today}
          lists={lists}
          usage={usage}
          tz={tz}
        />
      </div>
    </>
  )
}
