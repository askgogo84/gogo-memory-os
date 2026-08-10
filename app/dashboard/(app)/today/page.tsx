import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, type ReminderRow } from '@/lib/dashboard/queries'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { ReminderThread } from '@/components/dashboard/reminder-thread'
import { CardError } from '@/components/dashboard/card-error'

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

export default async function TodayPage() {
  // The (app) layout already guarantees a session. telegram_id is TEXT in
  // dashboard_sessions; users.telegram_id is bigint — cast at the boundary.
  // Identity and reminders are read in parallel (TRD §5: fetch in parallel).
  const session = await getSession()
  const [{ data: user }, today] = await Promise.all([
    session
      ? supabaseAdmin
          .from('users')
          .select('whatsapp_id, name, timezone')
          .eq('telegram_id', parseInt(session.telegramId, 10))
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session ? getTodayReminders(session.telegramId) : Promise.resolve({ ok: true as const, reminders: [] }),
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
  const doneCount = reminders.length - upcoming.length
  const recurringCount = upcoming.filter((r) => r.is_recurring).length
  const todayCount = upcoming.length - recurringCount
  const leftCount = upcoming.length
  const leftLabel =
    leftCount === 0 ? 'nothing left' : leftCount === 1 ? 'one thing left' : `${leftCount} things left`
  const hasThread = today.ok && reminders.length > 0

  const pills: Array<{ label: string; count: number; active: boolean }> = [
    { label: 'Today', count: todayCount, active: true },
    { label: 'Recurring', count: recurringCount, active: false },
    { label: 'Done', count: doneCount, active: false },
  ]

  return (
    <div className="flex flex-col gap-5">
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
    </div>
  )
}
