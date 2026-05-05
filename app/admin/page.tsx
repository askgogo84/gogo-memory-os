import type { ReactNode } from 'react'
import { getAdminAnalytics } from '@/lib/bot/handlers/admin-analytics'

export const dynamic = 'force-dynamic'

const GOAL_WHATSAPP_USERS = 1000
const SPRINT_DAYS = 10

function StatCard({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/80 p-5 shadow-sm backdrop-blur">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{children}</span>
}

function SoftBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{children}</span>
}

function getSprintStats(whatsappUsers: number) {
  const remaining = Math.max(0, GOAL_WHATSAPP_USERS - whatsappUsers)
  const progress = Math.min(100, Math.round((whatsappUsers / GOAL_WHATSAPP_USERS) * 100))
  const requiredPerDay = Math.ceil(remaining / SPRINT_DAYS)

  return { remaining, progress, requiredPerDay }
}

export default async function AdminPage() {
  let analytics: any

  try {
    analytics = await getAdminAnalytics()
  } catch (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">AskGogo Admin</h1>
          <p className="mt-3 text-slate-600">Unable to load dashboard.</p>
          <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error instanceof Error ? error.message : 'Unknown dashboard error'}
          </p>
          <p className="mt-4 text-sm text-slate-500">
            Check Vercel environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
          </p>
        </div>
      </main>
    )
  }

  const totals = analytics.totals
  const sprint = getSprintStats(totals.whatsappUsers || 0)

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dcfce7,transparent_30%),linear-gradient(135deg,#f8fafc,#eef2ff)] p-6 text-slate-950 md:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge>Founder dashboard</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">AskGogo Admin Dashboard</h1>
            <p className="mt-2 text-slate-600">Users, plans, platforms, institution pilots, referrals and payment intent in one place.</p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-sm text-white shadow-sm">Live data from Supabase</div>
        </div>

        <section className="mb-8 rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Badge>10-day growth sprint</Badge>
              <h2 className="mt-4 text-3xl font-semibold">Goal: 1,000 WhatsApp users</h2>
              <p className="mt-2 text-sm text-slate-300">Current WhatsApp users: {totals.whatsappUsers}. Remaining: {sprint.remaining}. Required pace: {sprint.requiredPerDay}/day.</p>
            </div>
            <div className="min-w-[260px] rounded-3xl bg-white/10 p-5">
              <p className="text-sm text-slate-300">Progress</p>
              <p className="mt-2 text-5xl font-semibold">{sprint.progress}%</p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${sprint.progress}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total users" value={totals.users} hint="WhatsApp + Telegram" />
          <StatCard label="WhatsApp users" value={totals.whatsappUsers} hint="Primary growth channel" />
          <StatCard label="Telegram users" value={totals.telegramUsers} hint="Legacy beta users" />
          <StatCard label="Payment intents" value={totals.paymentIntents} hint="High-intent leads" />
        </section>

        <section className="mt-4 grid gap-4 md:grid-cols-4">
          <StatCard label="Institutions" value={totals.institutions || 0} hint="Schools, colleges, clinics" />
          <StatCard label="Institution users" value={totals.institutionUsers || 0} hint="Mapped users" />
          <StatCard label="Pilot institutions" value={totals.pilotInstitutions || 0} hint="Active pilots" />
          <StatCard label="Active reminders" value={totals.activeReminders} />
        </section>

        <section className="mt-4 grid gap-4 md:grid-cols-4">
          <StatCard label="Free" value={totals.freeUsers} />
          <StatCard label="Starter" value={totals.starterUsers} />
          <StatCard label="Pro" value={totals.proUsers} />
          <StatCard label="Founder Pro" value={totals.founderProUsers} />
        </section>

        <section className="mt-8 rounded-3xl bg-white/85 p-6 shadow-sm ring-1 ring-black/5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Institution pilots</h2>
              <p className="text-sm text-slate-500">Track warm-network pilots across schools, colleges, clinics and coaching centres.</p>
            </div>
            <Badge>{analytics.institutions?.length || 0} institutions</Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {(analytics.institutions || []).slice(0, 9).map((inst: any) => (
              <div key={inst.id || inst.name} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{inst.name}</p>
                    <p className="mt-1 text-sm capitalize text-slate-500">{inst.type || 'institution'}{inst.city ? ` • ${inst.city}` : ''}</p>
                  </div>
                  <SoftBadge>{inst.status || 'pilot'}</SoftBadge>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xl font-semibold">{inst.user_count || 0}</p><p className="text-xs text-slate-500">Users</p></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xl font-semibold">{inst.whatsapp_users || 0}</p><p className="text-xs text-slate-500">WA</p></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xl font-semibold">{inst.telegram_users || 0}</p><p className="text-xs text-slate-500">TG</p></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <SoftBadge>Plan: {inst.plan || 'pilot'}</SoftBadge>
                  {(inst.segments || []).slice(0, 3).map((segment: string) => <SoftBadge key={segment}>{segment}</SoftBadge>)}
                </div>
                {(inst.contact_name || inst.contact_phone) ? <p className="mt-4 text-sm text-slate-500">Contact: {inst.contact_name || '-'} {inst.contact_phone ? `• ${inst.contact_phone}` : ''}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-white/85 p-6 shadow-sm ring-1 ring-black/5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Recent users</h2><Badge>{analytics.recentUsers.length} latest</Badge></div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Platform</th><th className="p-3">Plan</th><th className="p-3">Institution</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {analytics.recentUsers.map((user: any) => (
                    <tr key={`${user.telegram_id}-${user.whatsapp_id || ''}`}><td className="p-3 font-medium">{user.name || 'Friend'}</td><td className="p-3 capitalize text-slate-600">{user.platform || 'unknown'}</td><td className="p-3 capitalize text-slate-600">{String(user.tier || 'free').replace('_', ' ')}</td><td className="p-3 text-slate-500">{user.institution_name || '-'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl bg-white/85 p-6 shadow-sm ring-1 ring-black/5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Payment intent</h2><Badge>{totals.paymentIntents} captured</Badge></div>
            <div className="space-y-3">
              {analytics.recentPaymentIntents.length ? analytics.recentPaymentIntents.slice(0, 12).map((item: any, idx: number) => (
                <div key={`${item.telegram_id}-${item.created_at}-${idx}`} className="rounded-2xl border border-slate-100 bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{item.userName || item.telegram_id}</p><Badge>{String(item.plan || 'unknown').replace('_', ' ')}</Badge></div><p className="mt-2 text-sm text-slate-600">“{item.rawText || 'payment intent'}”</p></div>
              )) : <p className="text-slate-500">No payment intent yet.</p>}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          <StatCard label="Referral joins" value={totals.referrals} />
          <StatCard label="Unknown plan users" value={totals.unknownTierUsers} />
        </section>
      </div>
    </main>
  )
}
