import { WhatsAppIcon } from './icons'
import { waLink } from '@/lib/product-urls'

// ── The single most important component on the dashboard ──────────────────────
// A green pill that hands the user back to WhatsApp with a message prefilled. It
// is what keeps the dashboard an on-ramp to the bot instead of a competing app
// (UI/UX brief §6). WhatsApp green (#25D366) is reserved EXCLUSIVELY for this —
// nothing else on the dashboard is ever green, so the user learns in one session
// that green means "this takes me back to Gogo". Do not reuse this colour.

type WhatsAppChipProps = {
  /** The text Gogo receives, e.g. "Gogo, remind me to…". Prefilled, not sent. */
  message: string
  /** Visible chip label; defaults to the message. */
  label?: string
}

export function WhatsAppChip({ message, label }: WhatsAppChipProps) {
  const href = waLink(message)
  return (
    // Sized to the export's inline prefill chip (frame 1d: ~7px/11px padding,
    // 11.5px semibold) — small enough to sit inside a list card, not the biggest
    // element on the screen. Dropping min-h-11 is deliberate: the mockup's chip is
    // a compact affordance, not a full-height CTA button.
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-[11px] py-[7px] text-[11.5px] font-semibold text-white transition-colors duration-500 ease-calm hover:bg-[#1EBE5B]"
    >
      <WhatsAppIcon className="block h-3 w-3" />
      {label ?? message}
    </a>
  )
}
