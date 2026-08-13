import { buildThread } from '@/lib/dashboard/thread'
import type { ReminderRow } from '@/lib/dashboard/queries'

// ── The Today spine, compacted for the 3a "Your day" card ─────────────────────
// The SAME in-flow gutter as components/dashboard/reminder-thread.tsx — every row
// is a flex triplet (a right-aligned time, a 9px dot column, the flex:1 content)
// and the spine is one absolute hairline drawn THROUGH the dot column — only at
// the frame's smaller values: 9px dot column, gap 14, 14px content, 11.5px labels.
// It reuses buildThread — the same past/now/upcoming model the full thread computes,
// times already formatted by its formatTime — so the two spines can never disagree
// about where "now" sits or how a time reads.
//
// Read-only by design: frame 3a's compact thread carries NO per-row edit/delete
// affordance (on desktop, edits happen through the command bar / WhatsApp), so
// there is no ReminderActions here — that lives only on the full mobile thread.
//
// The label column stays 46px — the SAME width the full thread uses — so the always-
// rendered meridiem ("9:00pm") never clips. Bare times were a real bug (a phone test,
// 8 Aug), and the export is unreliable here: its own YOUR DAY renders "9:00" for a
// reminder its Reminders card labels "9:00 PM". So we do NOT trust the export's 36px
// column; we widen to fit the meridiem and move the spine with it. The spine then
// sits at the DOT-COLUMN CENTRE (46 + 14 + 4.5 ≈ 64px), not the export's literal
// left:37px — that value floats a whole dot-column left of the dots (the same quirk
// reminder-thread.tsx documents and corrects).

export function TodayThreadCompact({ rows, tz }: { rows: ReminderRow[]; tz: string }) {
  const { before, gapLine, after } = buildThread(rows, new Date(), tz)

  return (
    <div className="relative mt-[14px]">
      {/* The rail: a sand hairline through the dot column, fading down the day. */}
      <div className="pointer-events-none absolute bottom-2 left-[64px] top-2 w-px bg-gradient-to-b from-gogo-sand to-gogo-sand/20" />

      {before.map((node) => (
        <div key={node.id} className="flex gap-[14px] py-[7px] opacity-[0.55]">
          <span className="w-[46px] shrink-0 pt-0.5 text-right text-[11.5px] font-semibold tabular-nums text-gogo-ink-3">
            {node.timeLabel}
          </span>
          <span className="flex w-[9px] shrink-0 justify-center pt-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-gogo-sand" />
          </span>
          <span className="min-w-0 flex-1 text-[14px] font-medium text-gogo-ink line-through decoration-gogo-ink/20">
            {node.label}
          </span>
        </div>
      ))}

      {/* The now-marker — orange, once, between past and upcoming. The 36px column
          fits the word "now" where a full clock time would clip. */}
      <div className="flex items-center gap-[14px] py-2">
        <span className="w-[46px] shrink-0 text-right text-[11.5px] font-bold tabular-nums text-gogo-orange">now</span>
        <span className="flex w-[9px] shrink-0 justify-center">
          <span className="h-[11px] w-[11px] rounded-full bg-gogo-orange shadow-[0_0_0_4px_rgba(241,130,25,0.16)]" />
        </span>
        <span className="h-px flex-1 bg-gogo-orange opacity-50" />
      </div>

      {/* The spoken gap line, indented to the content column (46 + 14 + 9 = 69). */}
      {gapLine && (
        <p className="mb-1 ml-[69px] mt-0.5 font-serif text-[14px] font-semibold leading-[1.35] text-gogo-plum">
          {gapLine}
        </p>
      )}

      {after.map((node) => (
        <div key={node.id} className="flex gap-[14px] py-[7px]">
          <span className="w-[46px] shrink-0 pt-0.5 text-right text-[11.5px] font-semibold tabular-nums text-gogo-ink-2">
            {node.timeLabel}
          </span>
          <span className="flex w-[9px] shrink-0 justify-center pt-[5px]">
            <span className="h-[9px] w-[9px] rounded-full border-2 border-gogo-plum bg-gogo-surface" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-gogo-ink">{node.label}</div>
            {node.seriesMeta && <div className="mt-0.5 text-[12px] text-gogo-ink-3">{node.seriesMeta}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
