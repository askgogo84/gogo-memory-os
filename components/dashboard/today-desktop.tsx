import type { ReactNode } from 'react'
import { buildThread } from '@/lib/dashboard/thread'
import type { TodayReminders, Lists, UsageSummary } from '@/lib/dashboard/queries'
import { TodayIcon, ListsIcon } from './icons'
import { WhatsAppChip } from './whatsapp-chip'
import { CommandBar } from './command-bar'
import { TodayThreadCompact } from './today-thread-compact'
import { CardError } from './card-error'

// ── Today, the desktop aggregate (frame 3a) ───────────────────────────────────
// The wide Today is a DIFFERENT arrangement of the same day, not the mobile stack
// widened: a command bar across the top, a grid of domain cards on the left, and
// the day's thread + a usage ("breath") ring on the right. Because that DOM order
// diverges fundamentally from the mobile spine, this is its OWN component rendered
// lg-only; the mobile tree stays separate and hidden at lg (see today/page.tsx).
// Data is fetched ONCE in the server page and handed to both — this component adds
// no reads of its own.
//
// It renders inside <main>, whose lg padding (26 / 28 / 30) already IS frame 3a's
// content padding — so there is no outer padding here, only the body layout.
//
// ONLY surfaces with real data get built. Frame 3a's Calendar card, Expenses card,
// Saved-for-later strip, People-you-remind list, Getting-settled and the persona
// chip are all omitted rather than stubbed with invented numbers — the 1fr 1fr
// grid simply reflows the two live cards (Reminders, Lists) into its first row.

// Sentence-case a stored list name for display ("goa" → "Goa"), mirroring
// today/page.tsx and list-collection.tsx. The stored value is never mutated.
function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// One domain card: accent icon + title + big count on the header row, up to two
// fact lines (passed as children), and a prefill chip. Card chrome matches the
// existing surface cards (white, ink/10 hairline, 20px radius).
function DomainCard({
  title,
  Icon,
  accent,
  count,
  chip,
  children,
}: {
  title: string
  Icon: typeof TodayIcon
  accent: 'orange' | 'plum'
  count: ReactNode
  chip: ReactNode
  children: ReactNode
}) {
  const accentText = accent === 'orange' ? 'text-gogo-orange' : 'text-gogo-plum'
  return (
    <div className="rounded-[20px] border border-gogo-ink/10 bg-gogo-surface px-[18px] py-[17px]">
      <div className="flex items-center gap-2.5">
        <span className={accentText}>
          <Icon className="block h-5 w-5" />
        </span>
        <div className="flex-1 text-[16px] font-semibold text-gogo-ink">{title}</div>
        <div className={`font-serif text-[24px] font-semibold leading-none ${accentText}`}>{count}</div>
      </div>
      {children}
      <div className="mt-3 flex flex-wrap gap-[7px]">{chip}</div>
    </div>
  )
}

// The usage meter as a "breath" ring — the SAME source the mobile Usage row reads
// (getUsageSummary: today's AI actions against the plan's per-day allowance). The
// arc is the real fraction; the count sits in the ring rather than beside a mascot
// (frame 3a's ring mascot needs a dedicated asset we don't have yet — omitted, not
// invented). A meter failure shows the standard soft retry, never fabricated zeros.
function BreathRing({ usage }: { usage: UsageSummary }) {
  if (!usage.ok) return <CardError message="Couldn’t load usage right now." />

  const used = usage.usage.aiToday
  const limit = usage.limits.aiPerDay
  const frac = limit > 0 ? Math.min(used / limit, 1) : 0
  const circ = 2 * Math.PI * 88 // r=88 in the 200-unit viewBox
  const dash = frac * circ
  const caption =
    frac < 0.6
      ? 'Breathing easy.'
      : frac < 0.85
        ? 'Plenty left today.'
        : frac < 1
          ? 'Almost at today’s limit.'
          : 'Today’s limit reached.'

  return (
    <div className="flex items-center gap-4 rounded-[20px] border border-gogo-ink/10 bg-gogo-surface p-[18px]">
      <div className="relative h-[104px] w-[104px] flex-none">
        <svg viewBox="0 0 200 200" width="104" height="104" className="absolute inset-0" aria-hidden="true">
          <circle cx="100" cy="100" r="88" fill="none" stroke="#F3E7DA" strokeWidth="13" />
          <circle
            cx="100"
            cy="100"
            r="88"
            fill="none"
            stroke="#F18219"
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform="rotate(-90 100 100)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-serif text-[26px] font-semibold leading-none text-gogo-ink">{used}</span>
        </div>
      </div>
      <div>
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">Today’s breath</div>
        <div className="mt-[6px] text-[13.5px] text-gogo-ink-2">of {limit} actions today</div>
        <div className="mt-1 text-[12.5px] leading-[1.45] text-gogo-ink-3">{caption}</div>
      </div>
    </div>
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
  tz,
}: {
  greeting: string
  dayLine: string
  leftLabel: string
  hasThread: boolean
  today: TodayReminders
  lists: Lists
  usage: UsageSummary
  tz: string
}) {
  // One thread model, shared: it drives both the Reminders card's count/next-two
  // and the compact "Your day" spine, so the card and the spine can never contradict
  // each other about what's still upcoming.
  const model = today.ok ? buildThread(today.reminders, new Date(), tz) : null
  const upcoming = model?.after ?? []

  const lst = lists.ok ? lists.lists : []
  const topList = lst[0]
  const secondList = lst[1]
  const topOpen = topList ? topList.items.filter((i) => !i.done).length : 0
  const secondOpen = secondList ? secondList.items.filter((i) => !i.done).length : 0
  const topName = topList ? sentenceCase(topList.name) : ''

  return (
    <div>
      {/* Header — greeting left. The persona chip that sits right in frame 3a is
          omitted (no persona data), so this is just the greeting block. */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.7px] text-gogo-ink">
            {greeting}
          </h1>
          <p className="mt-[7px] text-[13.5px] font-medium text-gogo-ink-3">
            {dayLine}
            {hasThread ? ` · ${leftLabel}` : ''}
          </p>
        </div>
      </div>

      <CommandBar />

      <div className="mt-[22px] flex items-start gap-[26px]">
        {/* LEFT — the domain grid. Two live cards fill row one; the grid keeps its
            1fr 1fr so new cards drop in beside them as their data lands. */}
        <div className="grid flex-1 grid-cols-2 gap-[14px]">
          <DomainCard
            title="Reminders"
            Icon={TodayIcon}
            accent="orange"
            count={upcoming.length}
            chip={<WhatsAppChip message="Gogo, remind me to…" />}
          >
            {!today.ok ? (
              <div className="mt-[10px] text-[13.5px] text-gogo-ink-3">Couldn’t load reminders.</div>
            ) : upcoming.length > 0 ? (
              <>
                <div className="mt-[10px] text-[13.5px] text-gogo-ink-2">
                  Next · {upcoming[0].label} at {upcoming[0].timeLabel}
                </div>
                {upcoming[1] && (
                  <div className="mt-1 text-[13px] text-gogo-ink-3">Then · {upcoming[1].label}</div>
                )}
              </>
            ) : today.reminders.length > 0 ? (
              <div className="mt-[10px] text-[13.5px] text-gogo-ink-2">All done for today.</div>
            ) : (
              <div className="mt-[10px] text-[13.5px] text-gogo-ink-3">Nothing scheduled yet.</div>
            )}
          </DomainCard>

          <DomainCard
            title="Lists"
            Icon={ListsIcon}
            accent="plum"
            count={lst.length}
            chip={
              topList ? (
                <WhatsAppChip message={`Gogo, add to ${topName}`} label={`Add to ${topName}`} />
              ) : (
                <WhatsAppChip message="Gogo, start a list" label="Start a list" />
              )
            }
          >
            {!lists.ok ? (
              <div className="mt-[10px] text-[13.5px] text-gogo-ink-3">Couldn’t load lists.</div>
            ) : topList ? (
              <>
                <div className="mt-[10px] text-[13.5px] text-gogo-ink-2">
                  {topName} · {topOpen} of {topList.items.length} left
                </div>
                {secondList && (
                  <div className="mt-1 text-[13px] text-gogo-ink-3">
                    {sentenceCase(secondList.name)} · {secondOpen} left
                  </div>
                )}
              </>
            ) : (
              <div className="mt-[10px] text-[13.5px] text-gogo-ink-3">No lists yet.</div>
            )}
          </DomainCard>
        </div>

        {/* RIGHT — the day's thread and the breath ring. People-you-remind from
            frame 3a is omitted (friend_contacts carries no schedule to show). */}
        <div className="flex w-[330px] flex-none flex-col gap-[14px]">
          <div className="rounded-[20px] border border-gogo-ink/10 bg-gogo-surface p-[18px]">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">Your day</div>
            {!today.ok ? (
              <div className="mt-[14px] text-[13.5px] text-gogo-ink-3">Couldn’t load your day.</div>
            ) : today.reminders.length === 0 ? (
              <div className="mt-[14px] text-[13.5px] text-gogo-ink-3">Nothing on today.</div>
            ) : (
              <TodayThreadCompact rows={today.reminders} tz={tz} />
            )}
          </div>

          <BreathRing usage={usage} />
        </div>
      </div>
    </div>
  )
}
