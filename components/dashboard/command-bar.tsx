'use client'

import { useState } from 'react'
import { WA_NUMBER } from './whatsapp-chip'

// ── The desktop command bar (frame 3a) ────────────────────────────────────────
// The white pill across the top of the aggregate. It is the SAME promise as the
// WhatsAppChip — hand the user back to Gogo — but freeform: whatever they type
// becomes the prefilled WhatsApp message. This is the on-ramp restated as an input
// instead of a canned chip, so it never becomes a competing chat box: submitting
// only OPENS WhatsApp with the text ready to send (wa.me deep link), it never
// sends anything itself and holds no conversation.
//
// Client-only because it owns the typed text; everything else on Today is server-
// rendered. Empty submit opens the chat with no prefill (the "open chat" case);
// any text opens it prefilled. Same WA_NUMBER as every chip (whatsapp-chip.tsx).

export function CommandBar() {
  const [text, setText] = useState('')

  const openWhatsApp = () => {
    const msg = text.trim()
    const url = msg
      ? `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/${WA_NUMBER}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        openWhatsApp()
      }}
      className="mt-5 flex items-center gap-3 rounded-full border border-gogo-ink/12 bg-gogo-surface px-[18px] py-[14px] shadow-[0_2px_8px_rgba(62,35,18,0.05)]"
    >
      <span className="text-gogo-ink-3">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
      </span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask Gogo anything — it opens WhatsApp with your message ready to send…"
        aria-label="Ask Gogo anything"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-gogo-ink outline-none placeholder:text-gogo-ink-4"
      />
      {/* The one green here is WhatsApp handoff — same reserved semantics as the
          chips. It's the submit affordance, so the whole bar's action reads at a
          glance: this opens the chat. */}
      <button
        type="submit"
        aria-label="Open WhatsApp with this message"
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-gogo-orange text-white transition-colors duration-500 ease-calm hover:bg-gogo-orange-deep"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11" />
          <path d="M8 8.5l4-4 4 4" />
        </svg>
      </button>
    </form>
  )
}
