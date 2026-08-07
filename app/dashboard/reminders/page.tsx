import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Phase-2 placeholder: proves the session guard end to end. It renders nothing
// but "Signed in as …". The real reminders surface arrives in Phase 4.

// Mask a phone number to its last two digits: +91 98765 43210 → +91 •••••••• 10.
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return 'your account'
  const last = digits.slice(-2)
  const masked = '•'.repeat(Math.max(digits.length - 2, 4))
  return `+${digits.slice(0, digits.length - masked.length - 2)} ${masked} ${last}`.replace(/\s+/g, ' ').trim()
}

export default async function RemindersPage() {
  const session = await getSession()
  if (!session) redirect('/dashboard')

  // Identity is resolved ONLY from the session's telegram_id (never a URL). It's
  // TEXT in dashboard_sessions; users.telegram_id is bigint — cast at the boundary.
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('whatsapp_id, name')
    .eq('telegram_id', parseInt(session.telegramId, 10))
    .maybeSingle()

  const who = user?.whatsapp_id ? maskPhone(user.whatsapp_id) : user?.name || 'your account'

  return (
    <main
      style={{
        fontFamily: 'system-ui',
        maxWidth: 480,
        margin: '0 auto',
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      <p style={{ color: '#666', fontSize: 15 }}>
        Signed in as <strong>{who}</strong>.
      </p>
    </main>
  )
}
