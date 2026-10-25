import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAlertPreferences, DEFAULT_ALERT_PREFERENCES } from '@/lib/agent/alert-preferences'
import { AlertSettings } from '@/components/dashboard/alert-settings'

export const dynamic = 'force-dynamic'

// Duet parity step 2 (approved 22 Oct mock, screen 5): what you hear about and how often.
export default async function AlertsPage() {
  const session = await getSession()
  const tg = String(session?.telegramId || '')
  const [prefs, user] = await Promise.all([
    tg ? getAlertPreferences(tg) : Promise.resolve(DEFAULT_ALERT_PREFERENCES),
    tg ? supabaseAdmin.from('users').select('briefing_enabled,briefing_time').eq('telegram_id', Number(tg)).maybeSingle().then(r => r.data) : Promise.resolve(null),
  ])
  const brief = { enabled: Boolean((user as any)?.briefing_enabled), time: String((user as any)?.briefing_time || '08:00').slice(0, 5) }
  return (
    <div className="mx-auto w-full max-w-[680px] pb-10">
      <header className="pb-5 lg:pt-4">
        <div className="final-dark-eyebrow">Notifications</div>
        <h1 className="final-dark-title mt-1.5 text-[28px] sm:text-[32px]">What you hear about</h1>
        <p className="mt-1.5 text-[15px] text-[#a8a8a4]">Choose what Gogo messages you about, how often it checks, and when to stay quiet.</p>
      </header>
      <AlertSettings initial={prefs} initialBrief={brief}/>
    </div>
  )
}
