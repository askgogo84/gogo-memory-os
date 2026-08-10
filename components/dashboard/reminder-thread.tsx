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
      <span
        className={`absolute -left-[74px] top-px w-[46px] text-right text-[11.5px] font-semibold tabular-nums ${
          node.past ? 'text-gogo-ink-3' : 'text-gogo-ink-2'
        }`}
      >
        {node.timeLabel}
      </span>
      {/* Past nodes get a small solid sand dot; upcoming ones a hollow plum ring
          on surface white — the mockup's two states for done vs still-to-come. */}
      {node.past ? (
        <span className="absolute -left-[23px] top-2 h-[7px] w-[7px] rounded-full bg-gogo-sand" />
      ) : (
        <span className="absolute -left-6 top-1.5 h-[9px] w-[9px] rounded-full border-2 border-gogo-plum bg-gogo-surface" />
      )}
      <p
        className={`text-[14.5px] leading-[1.35] ${
          node.past
            ? 'font-medium text-gogo-ink-3 line-through decoration-gogo-ink/20'
            : 'font-semibold text-gogo-ink'
        }`}
      >
        {node.label}
      </p>
      {node.seriesMeta && <p className="mt-[3px] text-[12.5px] text-gogo-ink-3">{node.seriesMeta}</p>}
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
      {/* The rail: a sand hairline that fades from full at the top to faint at the
          bottom — the day draining away below the now-marker. */}
      <div className="pointer-events-none absolute bottom-6 left-[52px] top-1.5 w-px bg-gradient-to-b from-gogo-sand to-gogo-sand/25" />

      {before.map((node) => (
        <Node key={node.id} node={node} />
      ))}

      {/* The now-marker — one per screen, orange, between past and upcoming. */}
      <div className="relative mb-[30px] mt-0.5">
        <span className="absolute -left-[74px] -top-0.5 w-[46px] text-right text-[11.5px] font-bold tabular-nums text-gogo-orange">
          {nowLabel}
        </span>
        <span className="absolute -left-[27px] top-0.5 h-[15px] w-[15px] rounded-full bg-gogo-orange shadow-[0_0_0_5px_rgba(241,130,25,0.16)]" />
        <div className="mt-2 h-0.5 rounded-sm bg-gradient-to-r from-gogo-orange to-transparent" />
        {/* The spoken gap line — Fraunces, plum, the one bit of voice on the spine. */}
        {gapLine && (
          <p className="mt-[7px] font-serif text-[14px] font-semibold leading-[1.4] text-gogo-plum">{gapLine}</p>
        )}
      </div>

      {after.map((node) => (
        <Node key={node.id} node={node} />
      ))}
    </div>
  )
}
