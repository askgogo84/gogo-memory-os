import type { ReactNode } from 'react'
import { buildThread, type ThreadNode } from '@/lib/dashboard/thread'
import type { ReminderRow } from '@/lib/dashboard/queries'
import { ReminderActions } from './reminder-actions'

// ── The signature of the Today screen ─────────────────────────────────────────
// A vertical time spine: reminders as nodes, ordered by time, with a single
// orange now-marker sitting between what's past and what's next. This isn't
// decoration — it's the whole point of the screen (the day, seen at a glance).
//
// GUTTER MECHANISM — in-flow flex (matches the current export, docs/dashboard-design):
// every row is a flex triplet — a right-aligned time label, a 9px dot column, and
// the flex:1 content — and the spine is a single absolute 1px gradient drawn THROUGH
// the dot column. This replaced the old negative-offset gutter (-left-[74px] against
// <main>'s padding): the offsets were tuned to one column width and would not land in
// the desktop 470px column. In-flow flex is self-contained, so the same thread reads
// correctly in the 480px mobile column and the 470px desktop column with no per-
// breakpoint magic. Values step up at lg to the desktop frame (label 12px, content
// 15px, gap 16). The label stays 46px wide at BOTH sizes — the design mocks bare times
// ("7:00") but production always renders the meridiem ("12:00pm"), which clips at 40px.
//
// The spine runs through the dot centres (~64/66px), NOT the mockup's left:41px — that
// value sits a full dot-column left of the dots in every design frame (an export quirk).
//
// Server component: it takes rows and renders. All computation is in
// lib/dashboard/thread.ts; all reads are in lib/dashboard/queries.ts.

function Node({ node, children }: { node: ThreadNode; children?: ReactNode }) {
  return (
    <div className="flex gap-[14px] py-[9px] lg:gap-4">
      <span
        className={`w-[46px] shrink-0 pt-0.5 text-right text-[11.5px] font-semibold tabular-nums lg:text-[12px] ${
          node.past ? 'text-gogo-ink-3' : 'text-gogo-ink-2'
        }`}
      >
        {node.timeLabel}
      </span>
      {/* The dot column — the spine runs down its centre. Past nodes get a small solid
          sand dot; upcoming ones a hollow plum ring on surface white (done vs to-come).
          The dot's top padding aligns it to the first line of the label text. */}
      <span className={`flex w-[9px] shrink-0 justify-center ${node.past ? 'pt-1.5' : 'pt-[5px]'}`}>
        {node.past ? (
          <span className="h-[7px] w-[7px] rounded-full bg-gogo-sand" />
        ) : (
          <span className="h-[9px] w-[9px] rounded-full border-2 border-gogo-plum bg-gogo-surface" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[14.5px] leading-[1.35] lg:text-[15px] ${
            node.past
              ? 'font-medium text-gogo-ink-3 line-through decoration-gogo-ink/20'
              : 'font-semibold text-gogo-ink'
          }`}
        >
          {node.label}
        </p>
        {node.seriesMeta && <p className="mt-[3px] text-[12.5px] text-gogo-ink-3">{node.seriesMeta}</p>}
        {children}
      </div>
    </div>
  )
}

export function ReminderThread({ rows, tz }: { rows: ReminderRow[]; tz: string }) {
  // One timezone for the whole spine — the user's current one, resolved by the
  // page. A spine is a single ordered scale; mixing zones would put nodes where
  // their labels contradict them.
  const { before, nowLabel, gapLine, after } = buildThread(rows, new Date(), tz)

  return (
    <div className="relative">
      {/* The rail: a sand hairline through the dot column that fades from full at the
          top to faint at the bottom — the day draining away below the now-marker. It
          sits at the dot-column centre (label 46px + gap + half of the 9px dot). */}
      <div className="pointer-events-none absolute bottom-2.5 left-[64px] top-2.5 w-px bg-gradient-to-b from-gogo-sand to-gogo-sand/25 lg:left-[66px]" />

      {before.map((node) => (
        <Node key={node.id} node={node} />
      ))}

      {/* The now-marker — one per screen, orange, between past and upcoming. Same flex
          triplet as a node: label, dot column, then a thin faded rule as the content. */}
      <div className="flex items-center gap-[14px] pb-1.5 pt-2.5 lg:gap-4">
        <span className="w-[46px] shrink-0 text-right text-[11.5px] font-bold tabular-nums text-gogo-orange lg:text-[12px]">
          {nowLabel}
        </span>
        <span className="flex w-[9px] shrink-0 justify-center">
          <span className="h-[11px] w-[11px] rounded-full bg-gogo-orange shadow-[0_0_0_4px_rgba(241,130,25,0.16)]" />
        </span>
        <span className="h-px flex-1 bg-gogo-orange opacity-50" />
      </div>

      {/* The spoken gap line — Fraunces, plum, the one bit of voice on the spine. Empty
          gutter cells keep it aligned to the content column. */}
      {gapLine && (
        <div className="mb-1.5 mt-0.5 flex gap-[14px] lg:gap-4">
          <span className="w-[46px] shrink-0" aria-hidden />
          <span className="w-[9px] shrink-0" aria-hidden />
          <p className="flex-1 font-serif text-[14px] font-semibold leading-[1.4] text-gogo-plum lg:text-[16px]">
            {gapLine}
          </p>
        </div>
      )}

      {/* Upcoming nodes carry the edit/delete affordance. Past/collapsed nodes never
          do: a collapsed node stands for several rows (no single id to act on), and
          editing something already fired is meaningless. */}
      {after.map((node) => (
        <Node key={node.id} node={node}>
          <ReminderActions
            id={node.id}
            isRecurring={node.isRecurring}
            messageRaw={node.messageRaw}
            remindAtIso={node.remindAtIso}
            tz={tz}
          />
        </Node>
      ))}
    </div>
  )
}
