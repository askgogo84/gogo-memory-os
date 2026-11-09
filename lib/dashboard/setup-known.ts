// G8 (Duet parity): "Gogo already knows your setup". A plain list of what is connected and what is not, shown once in
// the empty chat and available on WhatsApp 'start'. Pure summary + a loader that only reads the owner's own rows.
export type SetupInput = {
  whatsapp: boolean
  googleCalendar: { connected: boolean; extraAccounts: string[] }
  gmail: { connected: boolean; primaryEmail?: string | null; extraAccounts: string[] }
  sites: string[]            // signed-in sites from the connections page (Swiggy, BookMyShow…)
  spaces: boolean
  creditiq: boolean
}
export type SetupItem = { id: string; label: string; detail?: string; href?: string }
export type SetupKnown = { known: SetupItem[]; missing: SetupItem[]; line: string }

const mask = (email: string) => { const [u, d] = String(email).split('@'); return d ? `${u.slice(0, 3)}…@${d}` : email }

export function setupKnown(i: SetupInput): SetupKnown {
  const known: SetupItem[] = []; const missing: SetupItem[] = []
  if (i.whatsapp) known.push({ id: 'whatsapp', label: 'WhatsApp' })
  if (i.googleCalendar.connected) known.push({ id: 'calendar', label: 'Google Calendar', detail: i.googleCalendar.extraAccounts.length ? `${1 + i.googleCalendar.extraAccounts.length} accounts` : undefined })
  else missing.push({ id: 'calendar', label: 'Google Calendar', detail: 'meetings, conflicts, prep', href: '/dashboard/connections' })
  if (i.gmail.connected) known.push({ id: 'gmail', label: 'Gmail', detail: [i.gmail.primaryEmail, ...i.gmail.extraAccounts].filter(Boolean).map(e => mask(String(e))).join(', ') || undefined })
  else missing.push({ id: 'gmail', label: 'Gmail', detail: 'tickets, bills, replies owed', href: '/dashboard/connections' })
  for (const s of i.sites.slice(0, 6)) known.push({ id: `site:${s}`, label: s })
  if (i.spaces) known.push({ id: 'spaces', label: 'Spaces' })
  if (i.creditiq) known.push({ id: 'creditiq', label: 'CreditIQ' })
  if (!i.sites.length) missing.push({ id: 'sites', label: 'Sites you use', detail: 'Swiggy, BookMyShow, Amazon…', href: '/dashboard/connections' })
  const line = known.length ? `Already set up: ${known.map(k => k.detail ? `${k.label} (${k.detail})` : k.label).join(', ')}.${missing.length ? ` Not yet: ${missing.map(m => m.label).join(', ')}.` : ''}` : `Nothing connected yet. Start with ${missing.map(m => m.label).join(' or ')}.`
  return { known, missing, line }
}

/** Reads only the owner's rows. Never throws; a failed read counts as "not connected" and is logged. */
export async function loadSetupKnown(telegramId: string | number, opts: { spaces?: boolean } = {}): Promise<SetupKnown> {
  const tg = String(telegramId)
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const safe = async <T,>(p: Promise<T>, fallback: T, tag: string): Promise<T> => { try { return await p } catch (e: any) { console.error(`SETUP_KNOWN_${tag}_FAILED:`, String(e?.message || e).slice(0, 120)); return fallback } }
  const [user, cal, gm, sites] = await Promise.all([
    safe(Promise.resolve(supabaseAdmin.from('users').select('whatsapp_id,google_calendar_connected,gmail_connected,email').eq('telegram_id', tg).maybeSingle()).then(r => r.data as any), null, 'USER'),
    safe(import('@/lib/services/google-calendar-accounts').then(m => m.listExtraCalendarAccounts(tg)), [], 'CALENDAR'),
    safe(import('@/lib/agent/gmail-accounts').then(m => m.listExtraGmailAccounts(tg)), [], 'GMAIL'),
    safe(import('@/lib/dashboard/site-sessions').then(m => m.listSiteConnections(tg)), [], 'SITES'),
  ])
  const creditiq = user?.whatsapp_id ? await safe(Promise.resolve(supabaseAdmin.from('wa_creditiq_links').select('consumer_user_id').eq('sender', user.whatsapp_id).maybeSingle()).then(r => !!(r.data as any)?.consumer_user_id), false, 'CREDITIQ') : false
  return setupKnown({
    whatsapp: !!user?.whatsapp_id,
    googleCalendar: { connected: user?.google_calendar_connected === true, extraAccounts: (cal as any[]).map(a => String(a.email)) },
    gmail: { connected: user?.gmail_connected === true || (gm as any[]).length > 0, primaryEmail: user?.gmail_connected === true ? user?.email || null : null, extraAccounts: (gm as any[]).map(a => String(a.email)) },
    sites: (sites as any[]).filter(s => s?.status !== 'revoked' && s?.status !== 'expired').map(s => String(s.name || s.siteId || '')).filter(Boolean),
    spaces: !!opts.spaces,
    creditiq,
  })
}
