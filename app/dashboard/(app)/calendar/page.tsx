import { getSession } from '@/lib/dashboard/session'
import { getTodayCalendar } from '@/lib/dashboard/queries'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

// The Calendar surface (frame 1e). Three states, all read-only:
//   • not connected  → the figure + a warm line + a WhatsApp chip to connect
//   • connected, clear → the figure + a calm line
//   • connected, events → today's agenda (time · title)
// The connect flag and token are only ever READ (getTodayCalendar); a failed token
// refresh renders the not-connected state and writes nothing.

// "Monday, 11 August" in IST — the day the agenda belongs to.
function dayLine(now: Date): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(now)
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(now)
  return `${weekday}, ${dayMonth}`
}

export default async function CalendarPage() {
  const session = await getSession()
  const calendar = session ? await getTodayCalendar(session.telegramId) : ({ ok: true, connected: false } as const)

  const Title = (
    <h1 className="font-serif text-[25px] font-semibold tracking-[-0.4px] text-gogo-ink">Calendar</h1>
  )

  if (!calendar.ok) {
    return (
      <div className="flex flex-col gap-5">
        <header>{Title}</header>
        <CardError message="Couldn’t load your calendar right now." />
      </div>
    )
  }

  if (!calendar.connected) {
    // Connect hands to the bot, which owns the Google OAuth flow — no OAuth entry
    // point is built on the dashboard, and nothing is written here.
    return (
      <div className="flex flex-col gap-5">
        <header>{Title}</header>
        <EmptyState
          message="I can hold your meetings too."
          detail="Connect Google Calendar and your daily briefing starts including what’s on your day."
          action={<WhatsAppChip message="Gogo, connect my calendar" />}
        />
      </div>
    )
  }

  const { events } = calendar

  return (
    <div className="flex flex-col gap-5">
      <header>
        {Title}
        <div className="mt-1 flex items-center gap-2">
          <p className="text-[13px] font-medium text-gogo-ink-3">{dayLine(new Date())}</p>
          {/* Connected indicator — plum, NOT green (green lives only in WhatsAppChip). */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gogo-ink/10 bg-gogo-surface px-[9px] py-1 text-[11px] font-semibold text-gogo-ink-2">
            <span className="h-[7px] w-[7px] rounded-full bg-gogo-plum" />
            Google Calendar
          </span>
        </div>
      </header>

      {events.length === 0 ? (
        <EmptyState
          message="Your calendar’s clear today."
          detail="Nothing scheduled — enjoy the quiet."
          action={<WhatsAppChip message="Gogo, what’s on tomorrow?" />}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline gap-3 rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-3"
            >
              <span className="w-[54px] shrink-0 text-[12px] font-semibold tabular-nums text-gogo-ink-3">
                {e.time ?? 'all day'}
              </span>
              <span className="flex-1 text-[14.5px] font-semibold text-gogo-ink">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
