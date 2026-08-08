import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'

export const dynamic = 'force-dynamic'

// Phase-3 placeholder. The real usage bars are Phase 5 — blocked on METER_ENABLED,
// and the numbers must match what `usage` returns in WhatsApp exactly, so nothing
// is rendered here until that counting is the single source of truth.
export default function UsagePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] font-semibold text-gogo-ink">Usage</h1>
      <EmptyState
        message="Your plan and usage will live here."
        detail="Usage bars arrive once metering is on."
        action={<WhatsAppChip message="Gogo, how much have I used?" />}
      />
    </div>
  )
}
