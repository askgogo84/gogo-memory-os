// ── A single quota row ────────────────────────────────────────────────────────
// Label on the left, used/limit on the right, a thin fill bar below (frames 1f /
// 2c). Presentation only: it draws whatever numbers it's handed and never decides
// policy. The fill caps at 100% so an over-limit count reads as "full", never a
// bar spilling past its track — usage on this product slows, it doesn't stop.

type Tone = 'orange' | 'plum' | 'sand'

// Fill tones map to the design: documents=plum, friend contacts=sand,
// calendars=orange. The track is a calm sand tint, never a red "danger" colour.
const FILL: Record<Tone, string> = {
  orange: 'bg-gogo-orange',
  plum: 'bg-gogo-plum',
  sand: 'bg-gogo-sand',
}

export function QuotaBar({
  label,
  used,
  limit,
  tone = 'plum',
}: {
  label: string
  used: number
  limit: number
  tone?: Tone
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-[13px]">
      <div className="flex items-center justify-between text-[13.5px] font-semibold text-gogo-ink">
        <span>{label}</span>
        {/* Used in ink-3, the limit a tier fainter (ink-4) — the design's hierarchy
            where "3" carries the weight and "/ 10" recedes. */}
        <span className="tabular-nums">
          <span className="text-gogo-ink-3">{used}</span>
          <span className="text-gogo-ink-4"> / {limit}</span>
        </span>
      </div>
      <div className="mt-[9px] h-1.5 overflow-hidden rounded-[4px] bg-gogo-sand/30">
        <div className={`h-full rounded-[4px] ${FILL[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
