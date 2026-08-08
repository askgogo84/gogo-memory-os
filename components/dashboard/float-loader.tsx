// ── Loading = the float, never a spinner ──────────────────────────────────────
// gogo.gif already establishes the motion language: a slow float with a soft
// shadow. A spinner says "waiting"; the float says "resting" (UI/UX brief §4).
//
// Reduced motion (brief §4 + app-flow §8): drop to a static figure with no JS.
// The animated gif carries `motion-reduce:hidden` and a still png sits under it
// with `hidden motion-reduce:block`, so prefers-reduced-motion swaps one for the
// other purely in CSS.

type FloatLoaderProps = {
  /** Optional line beneath the figure, e.g. "Signing you in…". */
  label?: string
}

export function FloatLoader({ label }: FloatLoaderProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/gogo-float.gif"
        alt=""
        width={120}
        height={120}
        className="block h-[120px] w-[120px] select-none motion-reduce:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/gogo-figure.png"
        alt=""
        width={120}
        height={120}
        className="hidden h-[120px] w-[120px] select-none motion-reduce:block"
      />
      {label && <p className="text-[13px] text-gogo-ink/60">{label}</p>}
    </div>
  )
}
