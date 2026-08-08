import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'

export const dynamic = 'force-dynamic'

// Phase-3 placeholder. The real month grid + connect/empty-day states are Phase 4.
export default function CalendarPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] font-semibold text-gogo-ink">Calendar</h1>
      <EmptyState
        message="Your calendar will live here."
        detail="Month view and today’s agenda arrive next."
        action={<WhatsAppChip message="Gogo, what’s on today?" />}
      />
    </div>
  )
}
