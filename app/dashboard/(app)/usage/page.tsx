import { getSession } from '@/lib/dashboard/session'
import { getUsageSummary } from '@/lib/dashboard/queries'
import { CardError } from '@/components/dashboard/card-error'
import { BreathRing } from '@/components/dashboard/breath-ring'
import { QuotaBar } from '@/components/dashboard/quota-bar'

export const dynamic = 'force-dynamic'

// The Usage surface (frame 1f): the breath ring is today's AI actions against the
// plan's daily allowance; the mascot sits inside it. Below, the metered ledgers as
// calm bars. Reminders are NOT metered — one reassuring fair-use line, never a bar.
// Every number comes from lib/services/meter.ts + plan_limits; nothing hardcoded.
export default async function UsagePage() {
  const session = await getSession()
  const summary = session ? await getUsageSummary(session.telegramId) : ({ ok: false } as const)

  const Title = (
    <h1 className="font-serif text-[25px] font-semibold tracking-[-0.4px] text-gogo-ink">Usage</h1>
  )

  if (!summary.ok) {
    // A read failure is never fabricated zeros — show a soft retry.
    return (
      <div className="flex flex-col gap-5">
        <header>{Title}</header>
        <CardError message="Couldn’t load your usage right now." />
      </div>
    )
  }

  const { usage, limits, planLabel, planPriceInr, calendarsConnected } = summary
  const ai = usage.aiToday
  const aiLimit = limits.aiPerDay
  const ratio = aiLimit > 0 ? ai / aiLimit : 0

  // Reassuring, never punitive — the meter slows, it never stops.
  const status =
    ratio < 0.8
      ? 'Breathing easy.'
      : ratio < 1
        ? 'Almost at today’s pace — I slow down, I don’t stop.'
        : 'At today’s pace — nothing stops, I just slow down and tell you.'

  const priceLine = planPriceInr > 0 ? `₹${planPriceInr} / month` : 'Free'

  return (
    // temporary desktop freeze — removed in this surface's own 5c phase
    <div className="flex flex-col gap-5 lg:max-w-[480px]">
      <header>
        {Title}
        <p className="mt-1 text-[13px] font-medium text-gogo-ink-3">
          {planLabel} · {priceLine} · resets at midnight
        </p>
      </header>

      {/* The breath ring — today's AI actions. */}
      <div className="rounded-[22px] border border-gogo-ink/10 bg-gogo-surface px-4 pb-[18px] pt-[22px] text-center">
        <BreathRing used={ai} limit={aiLimit} />
        <div className="mt-3.5 font-serif text-[30px] font-semibold tracking-[-0.6px] text-gogo-ink">
          {ai} <span className="font-sans text-[17px] font-medium text-gogo-ink-3">of {aiLimit} today</span>
        </div>
        <p className="mx-auto mt-1.5 max-w-[250px] text-[13.5px] leading-[1.5] text-gogo-ink-2">{status}</p>
      </div>

      {/* Metered ledgers — calm bars, never red. */}
      <div className="flex flex-col gap-3">
        <QuotaBar label="Documents this month" used={usage.docsThisMonth} limit={limits.docsPerMonth} tone="plum" />
        <QuotaBar label="Friend contacts" used={usage.friendContacts} limit={limits.friendContactsMax} tone="sand" />
        <QuotaBar label="Calendars connected" used={calendarsConnected} limit={limits.calendarsMax} tone="orange" />
      </div>

      {/* Reminders are NOT metered — a fair-use ceiling, never a bar approaching a limit. */}
      <p className="text-center text-[12.5px] leading-[1.5] text-gogo-ink-3">
        Reminders aren’t metered — they run under a fair-use daily ceiling
        {limits.remindersFairUse > 0 ? ` of ${limits.remindersFairUse}` : ''}.
      </p>
    </div>
  )
}
