import { buildThread, type ThreadNode } from '@/lib/dashboard/thread'
import type { ReminderRow } from '@/lib/dashboard/queries'

// ── The signature of the Today screen ─────────────────────────────────────────
// A vertical time spine: reminders as nodes, ordered by time, with a single
// orange now-marker sitting between what's past and what's next. This isn't
// decoration — it's the whole point of the screen (the day, seen at a glance),
// so the geometry follows the mockup (docs/askgogo-dashboard-mockup.html) closely.
//
// Server component: it takes rows and renders. All computation is in
// lib/dashboard/thread.ts; all reads are in lib/dashboard/queries.ts.

function Node({ node }: { node: ThreadNode }) {
  return (
    <div className="relative mb-[26px]">
      <span className="absolute -left-[74px] top-px w-[46px] text-right text-xs tabular-nums text-gogo-ink/55">
        {node.timeLabel}
      </span>
      <span
        className={`absolute -left-6 top-1.5 h-[9px] w-[9px] rounded-full border-2 ${
          node.past ? 'border-transparent bg-gogo-ink/20' : 'border-gogo-plum bg-gogo-cream'
        }`}
      />
      <p
        className={`text-[15px] font-medium leading-[1.35] ${
          node.past ? 'text-gogo-ink/40 line-through decoration-gogo-ink/20' : 'text-gogo-ink'
        }`}
      >
        {node.label}
      </p>
      {node.seriesMeta && <p className="mt-[3px] text-[12.5px] text-gogo-ink/55">{node.seriesMeta}</p>}
    </div>
  )
}

export function ReminderThread({ rows, tz }: { rows: ReminderRow[]; tz: string }) {
  // One timezone for the whole spine — the user's current one, resolved by the
  // page. A spine is a single ordered scale; mixing zones would put nodes where
  // their labels contradict them.
  const { before, nowLabel, gapLine, after } = buildThread(rows, new Date(), tz)

  return (
    <div className="relative pl-[74px]">
      {/* The rail: a hairline that fades in at the top and out at the bottom. */}
      <div className="pointer-events-none absolute bottom-6 left-[52px] top-1.5 w-0.5 bg-gradient-to-b from-gogo-ink/10 via-gogo-ink/20 to-gogo-ink/10" />

      {before.map((node) => (
        <Node key={node.id} node={node} />
      ))}

      {/* The now-marker — one per screen, orange, between past and upcoming. */}
      <div className="relative mb-[30px] mt-0.5">
        <span className="absolute -left-[74px] -top-0.5 w-[46px] text-right text-xs font-bold tabular-nums text-gogo-orange">
          {nowLabel}
        </span>
        <span className="absolute -left-[27px] top-0.5 h-[15px] w-[15px] rounded-full bg-gogo-orange shadow-[0_0_0_5px_rgba(241,130,25,0.16)]" />
        <div className="mt-2 h-0.5 rounded-sm bg-gradient-to-r from-gogo-orange to-transparent" />
        {gapLine && <p className="mt-[7px] text-xs font-semibold text-gogo-orange-deep">{gapLine}</p>}
      </div>

      {after.map((node) => (
        <Node key={node.id} node={node} />
      ))}
    </div>
  )
}
