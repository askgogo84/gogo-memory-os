import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'

export const dynamic = 'force-dynamic'

// Phase-3 placeholder for the Today surface (formerly /dashboard/reminders). The
// real time-view — reminders on a vertical spine with a now-marker — arrives in
// Phase 4. For now it proves the session guard end to end: it renders who you're
// signed in as, resolved ONLY from the session's telegram_id, never a URL.

// Mask a phone number to its last two digits: +91 98765 43210 → +91 •••••••• 10.
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return 'your account'
  const last = digits.slice(-2)
  const masked = '•'.repeat(Math.max(digits.length - 2, 4))
  return `+${digits.slice(0, digits.length - masked.length - 2)} ${masked} ${last}`.replace(/\s+/g, ' ').trim()
}

export default async function TodayPage() {
  // The (app) layout already guarantees a session; this read is for identity.
  // telegram_id is TEXT in dashboard_sessions; users.telegram_id is bigint —
  // cast at the boundary.
  const session = await getSession()
  const { data: user } = session
    ? await supabaseAdmin
        .from('users')
        .select('whatsapp_id, name')
        .eq('telegram_id', parseInt(session.telegramId, 10))
        .maybeSingle()
    : { data: null }

  const who = user?.whatsapp_id ? maskPhone(user.whatsapp_id) : user?.name || 'your account'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] font-semibold text-gogo-ink">Today</h1>
      <p className="text-[13px] text-gogo-ink/60">
        Signed in as <strong className="font-semibold text-gogo-ink">{who}</strong>.
      </p>
      <p className="text-[15px] text-gogo-ink">Your day’s reminders will live here.</p>
      <div>
        <WhatsAppChip message="Gogo, remind me to…" />
      </div>
    </div>
  )
}
