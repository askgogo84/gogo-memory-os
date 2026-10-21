// What the dashboard shell needs on every page: the person's first name, the Wajo-style usage card (real meters
// from lib/services/meter.ts via getUsageSummary, never sample numbers) and the Getting started checklist, built
// only from facts we can check. Any read failure degrades that card, never the page.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUsageSummary } from '@/lib/dashboard/queries'

export type UsageMeter = { label: string; used: number; limit: number | null; resets: string }
export type ShellData = {
  name: string
  plan: string | null
  meters: UsageMeter[]
  setup: { key: string; label: string; done: boolean; href: string }[]
}

export async function getShellData(telegramId: string): Promise<ShellData> {
  const tgNum = parseInt(telegramId, 10)
  const empty: ShellData = { name: '', plan: null, meters: [], setup: [] }
  if (!Number.isFinite(tgNum)) return empty
  const [userRes, usage, runRes, watchRes] = await Promise.all([
    supabaseAdmin.from('users').select('name, google_calendar_connected, gmail_connected').eq('telegram_id', tgNum).maybeSingle().then(r => r, () => ({ data: null } as any)),
    getUsageSummary(telegramId).catch(() => ({ ok: false } as const)),
    supabaseAdmin.from('agent_runs').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId).then(r => r, () => ({ count: null } as any)),
    supabaseAdmin.from('agent_watchers').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId).neq('type', 'goal_review').then(r => r, () => ({ count: null } as any)),
  ])
  const user: any = (userRes as any)?.data || null
  const name = String(user?.name || '').trim().split(/\s+/)[0] || ''
  const meters: UsageMeter[] = []
  let plan: string | null = null
  if ((usage as any)?.ok) {
    const u = usage as any
    plan = u.planLabel || null
    const lim = (n: any) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null)
    meters.push({ label: 'AI actions today', used: Number(u.usage?.aiToday || 0), limit: lim(u.limits?.aiPerDay), resets: 'Resets at midnight' })
    meters.push({ label: 'Documents this month', used: Number(u.usage?.docsThisMonth || 0), limit: lim(u.limits?.docsPerMonth), resets: 'Resets on the 1st' })
  }
  const setup = [
    { key: 'whatsapp', label: 'Chat with Gogo on WhatsApp', done: true, href: '/dashboard/chat' },
    { key: 'google', label: 'Connect Gmail and Calendar', done: Boolean(user?.gmail_connected || user?.google_calendar_connected), href: '/dashboard/settings?section=connections' },
    { key: 'task', label: 'Give Gogo a first task', done: Number((runRes as any)?.count || 0) > 0, href: '/dashboard/chat?prompt=Compare%20iPhone%2016%20256GB%20prices' },
    { key: 'watch', label: 'Set a price or fare watch', done: Number((watchRes as any)?.count || 0) > 0, href: '/dashboard/chat?prompt=Watch%20the%2022K%20gold%20rate%20below%20%E2%82%B913%2C000' },
  ]
  return { name, plan, meters, setup }
}
