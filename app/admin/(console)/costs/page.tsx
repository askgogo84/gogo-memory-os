import Link from 'next/link'
import { Kpis, Head, BarList, VBars, Pill } from '@/components/admin/ui'
import { RateTable } from '@/components/admin/rate-table'
import { costByUser, costByVendor, costByDay, userRows, payments, runCounts, messageCounts, rateCard, istMonthStart, istDateKey, inr, inrSmart, PLAN_LABEL, PLAN_BUDGET_INR, VENDOR_LABEL, CATEGORY_GROUP } from '@/lib/admin/console-data'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000
const RANGES: [string, string][] = [['week', '7 days'], ['month', 'This month'], ['last', 'Last month']]

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const range = sp.r || 'month'
  const gate = await requireAdminConsole('viewer')
  const isOwner = gate.ok && gate.admin.role === 'owner'
  const now = new Date(), monthStart = istMonthStart(now), lastStart = istMonthStart(new Date(monthStart.getTime() - DAY))
  const since = range === 'week' ? new Date(now.getTime() - 7 * DAY) : range === 'last' ? lastStart : monthStart
  const until = range === 'last' ? monthStart : now
  // RPCs take a start only; for last month subtract this month's totals.
  const [usersAll, vSince, vThis, uSince, uThis, dSince, pays, runs, msgs, rates] = await Promise.all([
    userRows(), costByVendor(since), range === 'last' ? costByVendor(monthStart) : Promise.resolve([]), costByUser(since), range === 'last' ? costByUser(monthStart) : Promise.resolve([]),
    costByDay(since), payments(since), runCounts(since), messageCounts(since), rateCard(),
  ])
  const minus = <T extends { cost: number }>(a: T[], b: T[], key: (x: T) => string) => { const m = new Map(b.map(x => [key(x), x.cost])); return a.map(x => ({ ...x, cost: x.cost - (m.get(key(x)) || 0) })).filter(x => x.cost > 0.00005) }
  const vendors = range === 'last' ? minus(vSince, vThis as any, v => v.vendor + v.category) : vSince
  const byUser = range === 'last' ? minus(uSince, uThis as any, u => u.telegram_id) : uSince
  const days = dSince.filter(d => d.day < istDateKey(until) || range !== 'last')
  const total = vendors.reduce((a, v) => a + v.cost, 0)
  const revenue = pays.filter(p => new Date(p.created_at) < until).reduce((a, p) => a + p.amount, 0)
  const taskCount = runs.reduce((a, r) => a + r.runs, 0)
  const activeN = msgs.size
  const elapsedDays = Math.max(1, (Math.min(until.getTime(), now.getTime()) - since.getTime()) / DAY)
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const users = new Map(usersAll.map(u => [u.telegram_id, u]))
  const over = byUser.filter(c => { const u = users.get(c.telegram_id); return u && c.cost > (PLAN_BUDGET_INR[u.tier] ?? 25) })
  const groups = new Map<string, number>(); for (const v of vendors) groups.set(CATEGORY_GROUP(v.vendor), (groups.get(CATEGORY_GROUP(v.vendor)) || 0) + v.cost)
  const tiers = new Map<string, { users: number; cost: number; rev: number }>()
  for (const u of usersAll) { const t = tiers.get(u.tier) || { users: 0, cost: 0, rev: 0 }; t.users++; tiers.set(u.tier, t) }
  for (const c of byUser) { const u = users.get(c.telegram_id); if (u) tiers.get(u.tier)!.cost += c.cost }
  for (const p of pays) { const u = p.telegram_id ? users.get(p.telegram_id) : null; if (u) tiers.get(u.tier)!.rev += p.amount }
  const system = byUser.find(c => c.telegram_id === 'system')?.cost || 0

  return (
    <div className="adm-stack">
      <Head title="Costs" lede="Usage cost per person: every AI call, web search, phone call, secure-browser session and WhatsApp message is priced with the rate card below and logged against the person it served. Fixed bills are under Tools and APIs.">
        {RANGES.map(([k, l]) => <Link key={k} className="chip" aria-current={range === k} href={`?r=${k}`}>{l}</Link>)}
      </Head>
      <Kpis items={[
        { label: 'Usage cost', value: inr(total), sub: `${Math.round(elapsedDays)} days` },
        { label: range === 'month' ? 'Projected month' : 'Per day', value: range === 'month' ? inr((total / elapsedDays) * daysInMonth) : inrSmart(total / elapsedDays) },
        { label: 'Per task', value: taskCount ? inrSmart(total / taskCount) : '—', sub: `${taskCount} tasks` },
        { label: 'Per active user', value: activeN ? inrSmart(total / activeN) : '—', sub: `${activeN} active` },
        { label: 'Revenue', value: inr(revenue), sub: 'payments received' },
        { label: 'Over budget', value: over.length, sub: 'users past plan budget' },
      ]} />
      <section>
        <h2>Daily usage cost</h2>
        <VBars values={days.map(d => d.cost)} fmt={n => inrSmart(n)} labels={[days[0]?.day || '', days[days.length - 1]?.day || '']} />
      </section>
      <div className="adm-cols">
        <section>
          <h2>By category</h2>
          <BarList labelWidth={150} empty="No metered usage in this period yet." rows={[...groups.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => ({ label: g, value: c, display: inrSmart(c), extra: total ? `${Math.round((c / total) * 100)}%` : '' }))} />
          <h3 style={{ marginTop: 20 }}>By service</h3>
          <BarList labelWidth={150} rows={vendors.map(v => ({ label: VENDOR_LABEL[v.vendor] || v.vendor, sub: v.category === 'llm' ? `${v.events} calls · ${(v.input + v.output).toLocaleString('en-IN')} tokens` : `${v.events} ${v.category}`, value: v.cost, display: inrSmart(v.cost) }))} />
        </section>
        <section>
          <h2>By user</h2>
          <div className="adm-list">
            {byUser.slice(0, 30).map(c => { const u = users.get(c.telegram_id); const max = byUser[0]?.cost || 1; return (
              <Link key={c.telegram_id} className="adm-row" style={{ textDecoration: 'none' }} href={c.telegram_id === 'system' ? '/admin/costs' : `/admin/users/${encodeURIComponent(c.telegram_id)}`}>
                <span style={{ flex: '0 0 130px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.telegram_id === 'system' ? 'Background jobs' : u?.name || c.telegram_id}</span>
                <div className="adm-bar ink"><i style={{ width: `${Math.round((c.cost / max) * 100)}%` }} /></div>
                <span style={{ minWidth: 70, textAlign: 'right', fontWeight: 500 }}>{inrSmart(c.cost)}</span>
              </Link>) })}
            {!byUser.length ? <div className="adm-row muted">No metered usage in this period yet.</div> : null}
          </div>
          {system ? <p className="note">Background jobs ({inrSmart(system)}) is work done by scheduled jobs that isn't tied to one person yet.</p> : null}
        </section>
      </div>
      <section>
        <h2>Revenue against cost, by plan</h2>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Plan</th><th scope="col">Users</th><th scope="col">Revenue</th><th scope="col">Usage cost</th><th scope="col">Cost per user</th><th scope="col">Budget per user</th><th scope="col">Margin</th></tr></thead>
            <tbody>
              {[...tiers.entries()].sort((a, b) => b[1].users - a[1].users).map(([t, v]) => { const margin = v.rev ? Math.round(((v.rev - v.cost) / v.rev) * 100) : null; return (
                <tr key={t}><td style={{ fontWeight: 500 }}>{PLAN_LABEL[t] || t}</td><td>{v.users}</td><td>{inr(v.rev)}</td><td>{inrSmart(v.cost)}</td><td>{inrSmart(v.users ? v.cost / v.users : 0)}</td><td style={{ color: 'var(--ink2)' }}>{inr(PLAN_BUDGET_INR[t] ?? 25)}</td>
                  <td>{margin == null ? (v.cost ? <Pill tone="bad">−{inrSmart(v.cost)}</Pill> : <Pill>—</Pill>) : <Pill tone={margin >= 0 ? 'ok' : 'bad'}>{margin}%</Pill>}</td></tr>) })}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Rate card</h2>
        <p className="note" style={{ marginTop: -6, marginBottom: 12 }}>How each metered call is priced. The starting values are estimates from public price lists; correct them to your actual rates. A change applies to new calls from then on.</p>
        <RateTable canEdit={isOwner} rows={rates.map((r: any) => ({ key: r.key, label: r.label, unit: r.unit, usd: r.usd_per_unit == null ? '' : String(Number(r.usd_per_unit)), inr: r.inr_per_unit == null ? '' : String(Number(r.inr_per_unit)), note: r.note || '' }))} />
      </section>
    </div>
  )
}
