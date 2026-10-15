import { getSession } from '@/lib/dashboard/session'
import { getProfile, getUsageSummary } from '@/lib/dashboard/queries'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listSiteConnections } from '@/lib/dashboard/site-sessions'
import { CardError } from '@/components/dashboard/card-error'
import { SettingsView, type SettingsSection } from '@/components/dashboard/settings-view'

export const dynamic = 'force-dynamic'

const SECTIONS: SettingsSection[] = ['general', 'connections', 'permissions', 'payments', 'addresses', 'notifications', 'voice', 'invites']

function fmtPhone(raw: string | null) {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '')
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : raw
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const session = await getSession()
  const requested = String((await searchParams)?.section || '') as SettingsSection
  const section: SettingsSection = SECTIONS.includes(requested) ? requested : 'general'
  const tg = String(session?.telegramId || '')
  const tgNum = parseInt(tg, 10)
  const [profile, usage, user, permissions, sites] = await Promise.all([
    session ? getProfile(tg) : Promise.resolve({ ok: false } as const),
    session ? getUsageSummary(tg) : Promise.resolve({ ok: false } as const),
    Number.isFinite(tgNum) ? supabaseAdmin.from('users').select('timezone').eq('telegram_id', tgNum).maybeSingle() : Promise.resolve({ data: null as any }),
    session ? supabaseAdmin.from('agent_permissions').select('capability,level').eq('telegram_id', tg) : Promise.resolve({ data: [] as any[] }),
    session ? listSiteConnections(tg) : Promise.resolve([]),
  ])
  if (!profile.ok) return <div className="mx-auto max-w-[900px]"><CardError message="Couldn’t load your settings right now." /></div>

  const levels: Record<string, string> = {}
  for (const row of ((permissions as any)?.data || []) as Array<{ capability: string; level: string }>) levels[row.capability] = row.level

  return <SettingsView
    initialSection={section}
    name={profile.name || ''}
    phone={fmtPhone(profile.whatsappId)}
    timezone={String((user as any)?.data?.timezone || 'Asia/Kolkata')}
    planLabel={profile.planLabel}
    usageLine={usage.ok ? `${usage.usage.aiToday} AI actions today · ${usage.usage.docsThisMonth} documents this month` : ''}
    google={{ calendar: profile.connections.googleCalendar, gmail: profile.connections.gmail }}
    creditiq={profile.connections.creditiq}
    levels={levels}
    sites={sites}
  />
}
