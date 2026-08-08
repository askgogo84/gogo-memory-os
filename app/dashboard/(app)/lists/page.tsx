import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'

export const dynamic = 'force-dynamic'

// Phase-3 placeholder. The real list-of-lists with inline expand is Phase 4.
export default function ListsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] font-semibold text-gogo-ink">Lists</h1>
      <EmptyState
        message="Your lists will live here."
        detail="Add items in WhatsApp; they show up here."
        action={<WhatsAppChip message="Gogo, add milk to my groceries" />}
      />
    </div>
  )
}
