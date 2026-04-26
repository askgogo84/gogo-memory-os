async function getAnalytics() {
  const token = process.env.ADMIN_DASHBOARD_TOKEN || ''
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.askgogo.in'

  if (!token) {
    return { ok: false, error: 'Missing ADMIN_DASHBOARD_TOKEN' }
  }

  const res = await fetch(`${baseUrl}/api/admin/analytics?token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    return { ok: false, error: `Analytics API failed: ${res.status}` }
  }

  return res.json()
}

function StatCard({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/80 p-5 shadow-sm backdrop-blur">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{children}</span>
}

export default async function AdminPage() {
  const data = await getAnalytics()

  if (!data?.ok) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">AskGogo Admin</h1>
          <p className="mt-3 text-slate-600">{data?.error || 'Unable to load dashboard.'}</p>
          <p className="mt-4 text-sm text-slate-500">Set ADMIN_DASHBOARD_TOKEN and NEXT_PUBLIC_APP_URL in Vercel.</p>
        </div>
      </main>
    )
  }

  const analytics = data.analytics
  const totals = analytics.totals

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dcfce7,transparent_30%),linear-gradient(135deg,#f8fafc,#eef2ff)] p-6 text-slate-950 md:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge>Founder dashboard</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">AskGogo Admin Dashboard</h1>
            <p className="mt-2 text-slate-600">Users, plans, platforms, referrals and payment intent in one place.</p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-sm text-white shadow-sm">
            Live data from Supabase
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total users" value={totals.users} hint="WhatsApp + Telegram" />
          <StatCard label="WhatsApp users" value={totals.whatsappUsers} hint="Primary growth channel" />
          <StatCard label="Telegram users" value={totals.telegramUsers} hint="Legacy beta users" />
          <StatCard label="Payment intents" value={totals.paymentIntents} hint="High-intent leads" />
        </section>

        <section className="mt-4 grid gap-4 md:grid-cols-4">
          <StatCard label="Free" value={totals.freeUsers} />
          <StatCard label="Starter" value={totals.starterUsers} />
          <StatCard label="Pro" value={totals.proUsers} />
          <StatCard label="Founder Pro" value={totals.founderProUsers} />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-white/85 p-6 shadow-sm ring-1 ring-black/5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Recent users</h2>
              <Badge>{analytics.recentUsers.length} latest</Badge>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Platform</th>
                    <th className="p-3">Plan</th>
                    <th className="p-3">WhatsApp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {analytics.recentUsers.map((user: any) => (
                    <tr key={`${user.telegram_id}-${user.whatsapp_id || ''}`}>
                      <td className="p-3 font-medium">{user.name || 'Friend'}</td>
                      <td className="p-3 capitalize text-slate-600">{user.platform || 'unknown'}</td>
                      <td className="p-3 capitalize text-slate-600">{String(user.tier || 'free').replace('_', ' ')}</td>
                      <td className="p-3 text-slate-500">{user.whatsapp_id || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl bg-white/85 p-6 shadow-sm ring-1 ring-black/5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Payment intent</h2>
              <Badge>{totals.paymentIntents} captured</Badge>
            </div>
            <div className="space-y-3">
              {analytics.recentPaymentIntents.length ? analytics.recentPaymentIntents.slice(0, 12).map((item: any, idx: number) => (
                <div key={`${item.telegram_id}-${item.created_at}-${idx}`} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{item.userName || item.telegram_id}</p>
                    <Badge>{String(item.plan || 'unknown').replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">“{item.rawText || 'payment intent'}”</p>
                </div>
              )) : <p className="text-slate-500">No payment intent yet.</p>}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <StatCard label="Active reminders" value={totals.activeReminders} />
          <StatCard label="Referral joins" value={totals.referrals} />
          <StatCard label="Unknown plan users" value={totals.unknownTierUsers} />
        </section>
      </div>
    </main>
  )
}
