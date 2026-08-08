import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders } from '@/lib/dashboard/queries'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { ReminderThread } from '@/components/dashboard/reminder-thread'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

// The Today surface: the day seen as a vertical thread with a now-marker (the
// signature of this screen). Identity — who you're signed in as — is resolved
// ONLY from the session's telegram_id, never a URL. All reminder reads go through
// lib/dashboard/queries.ts; all thread maths through lib/dashboard/thread.ts.

// Mask a phone number to its last two digits: +91 98765 43210 → +91 •••••••• 10.
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return 'your account'
  const last = digits.slice(-2)
  const masked = '•'.repeat(Math.max(digits.length - 2, 4))
  return `+${digits.slice(0, digits.length - masked.length - 2)} ${masked} ${last}`.replace(/\s+/g, ' ').trim()
}

export default async function TodayPage() {
  // The (app) layout already guarantees a session. telegram_id is TEXT in
  // dashboard_sessions; users.telegram_id is bigint — cast at the boundary.
  // Identity and reminders are read in parallel (TRD §5: fetch in parallel).
  const session = await getSession()
  const [{ data: user }, today] = await Promise.all([
    session
      ? supabaseAdmin
          .from('users')
          .select('whatsapp_id, name, timezone')
          .eq('telegram_id', parseInt(session.telegramId, 10))
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session ? getTodayReminders(session.telegramId) : Promise.resolve({ ok: true as const, reminders: [] }),
  ])

  const who = user?.whatsapp_id ? maskPhone(user.whatsapp_id) : user?.name || 'your account'
  // The whole spine renders in the user's CURRENT timezone (fallback IST), never
  // per-row — a row's stored zone is where it was set, not where the user is now.
  const tz = user?.timezone || 'Asia/Kolkata'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] font-semibold text-gogo-ink">Today</h1>
      <p className="text-[13px] text-gogo-ink/60">
        Signed in as <strong className="font-semibold text-gogo-ink">{who}</strong>.
      </p>

      {!today.ok ? (
        // A read failure is not an empty day — show a retry, never a blank thread.
        <CardError message="Couldn’t load your reminders right now." />
      ) : today.reminders.length === 0 ? (
        <EmptyState message="Nothing pending. That’s the idea." action={<WhatsAppChip message="Gogo, remind me to…" />} />
      ) : (
        <>
          <ReminderThread rows={today.reminders} tz={tz} />
          <div>
            <WhatsAppChip message="Gogo, remind me to…" />
          </div>
        </>
      )}
    </div>
  )
}
