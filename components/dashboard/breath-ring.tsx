// ── The breath ring ───────────────────────────────────────────────────────────
// The hero of the Usage screen (frame 1f): the mascot sits inside the ring and
// the arc IS the gauge — today's AI actions against the plan's daily allowance.
// Not a warning dial: it fills calmly and never turns red. Caller renders the
// "38 of 50 today" number and the reassuring line below it.
//
// Gauge internals (track / arc / faint guide rings) use the design's own values;
// the arc is the orange token via its CSS variable so it tracks the palette.

const R = 88
const CIRCUMFERENCE = 2 * Math.PI * R // ≈ 552.9

export function BreathRing({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  const filled = ratio * CIRCUMFERENCE

  return (
    <div className="relative mx-auto h-[214px] w-[214px]">
      <svg viewBox="0 0 200 200" width="214" height="214" className="absolute inset-0">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#F3E7DA" strokeWidth="10" />
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke="var(--color-gogo-orange)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          transform="rotate(-90 100 100)"
        />
        <circle cx="100" cy="100" r="74" fill="none" stroke="rgba(241,130,25,.14)" strokeWidth="1" />
        <circle cx="100" cy="100" r="66" fill="none" stroke="rgba(113,76,119,.12)" strokeWidth="1" />
      </svg>
      {/* The resting figure as the gauge's face — the same asset the empty states use. */}
      <div className="absolute inset-[42px] flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gogo-figure.png" alt="" className="h-full w-full select-none object-contain" />
      </div>
    </div>
  )
}
