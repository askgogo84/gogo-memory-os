import { EmptyState } from '@/components/dashboard/empty-state'

export const dynamic = 'force-dynamic'

// Phase-3 placeholder for the "You" surface (formerly Profile). Phone, plan,
// channel, CreditIQ status and Sign out arrive in Phase 4. Sign out will DELETE
// the session row server-side (not just clear the cookie) and land on the
// expired-link screen.
export default function YouPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] font-semibold text-gogo-ink">You</h1>
      <EmptyState
        message="Your account and sign out will live here."
        detail="Phone, plan and sign out arrive next."
      />
    </div>
  )
}
