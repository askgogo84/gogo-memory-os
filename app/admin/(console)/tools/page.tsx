import { Kpis, Head, BarList, Pill, VBars } from '@/components/admin/ui'
import { ToolCostForm } from '@/components/admin/tool-cost-form'
import { toolsWithCosts, costByDay, messageCounts, rateCard, istMonthStart, inr, inrSmart } from '@/lib/admin/console-data'
import { twilioMonthUsd } from '@/lib/admin/vendor-billing'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000
const GROUPS = ['AI models', 'Messaging and voice', 'Hosting and data', 'Search and data', 'Connected apps', 'Payments and email']

export default async function ToolsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const g = sp.g || 'all'
  const gate = await requireAdminConsole('viewer')
  const isOwner = gate.ok && gate.admin.role === 'owner'
  const now = new Date(), month = istMonthStart(now)
  const sixAgo = istMonthStart(new Date(month.getTime() - 150 * DAY))
  const [data, daily6, msgs, rates, twNow, twLast] = await Promise.all([toolsWithCosts(month), costByDay(sixAgo), messageCounts(new Date(now.getTime() - 30 * DAY)), rateCard(), twilioMonthUsd('ThisMonth'), twilioMonthUsd('LastMonth')])
  const fx = Number(rates.find((r: any) => r.key === 'fx.usd_inr')?.inr_per_unit) || 88
  const meterNow = new Map<string, number>(), meterLast = new Map<string, number>()
  for (const v of data.meteredNow) meterNow.set(v.vendor, (meterNow.get(v.vendor) || 0) + v.cost)
  for (const v of data.meteredBoth) meterLast.set(v.vendor, (meterLast.get(v.vendor) || 0) + v.cost)
  for (const [k, v] of meterNow) meterLast.set(k, (meterLast.get(k) || 0) - v)
  const manual = (toolId: string, monthKey: string) => data.costs.filter((c: any) => c.tool_id === toolId && c.month === monthKey && c.source === 'manual').reduce((a: number, c: any) => a + Number(c.amount_inr || 0), 0)
  const hasManual = (toolId: string, monthKey: string) => data.costs.some((c: any) => c.tool_id === toolId && c.month === monthKey && c.source === 'manual')

  const rows = data.tools.map((t: any) => {
    let now = 0, last = 0, src = ''
    if (hasManual(t.id, data.monthKey) || hasManual(t.id, data.prevKey)) { now = manual(t.id, data.monthKey); last = manual(t.id, data.prevKey); src = 'Invoice' }
    else if (t.id === 'twilio' && twNow != null) { now = twNow * fx; last = (twLast || 0) * fx; src = 'Auto · Twilio billing' }
    else if (t.meter_vendor) { now = meterNow.get(t.meter_vendor) || 0; last = Math.max(0, meterLast.get(t.meter_vendor) || 0); src = t.billing_source === 'free' ? 'Free tier' : 'Metered estimate' }
    else src = t.billing_source === 'free' ? 'Free tier' : 'Add invoice'
    return { ...t, now, last, src }
  })
  const total = rows.reduce((a: number, r: any) => a + r.now, 0), lastTotal = rows.reduce((a: number, r: any) => a + r.last, 0)
  const elapsed = Math.max(1, (now.getTime() - month.getTime()) / DAY)
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const fixed = rows.filter((r: any) => r.src === 'Invoice').reduce((a: number, r: any) => a + r.now, 0)
  const top = [...rows].sort((a: any, b: any) => b.now - a.now)[0]
  const byGroup = GROUPS.map(gr => [gr, rows.filter((r: any) => r.tool_group === gr).reduce((a: number, r: any) => a + r.now, 0)] as [string, number])
  const attention = rows.filter((r: any) => /low|awaiting|closed|fail|down/i.test(r.status) || r.src === 'Add invoice')
  const ist = new Date(now.getTime() + 5.5 * 3600_000)
  const monthsKeys = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - (5 - i), 1)).toISOString().slice(0, 7))
  const hist = monthsKeys.map(mk => daily6.filter(d => d.day.startsWith(mk)).reduce((a, d) => a + d.cost, 0) + data.costs.filter((c: any) => String(c.month).startsWith(mk) && c.source === 'manual').reduce((a: number, c: any) => a + Number(c.amount_inr || 0), 0))
  const shown = rows.filter((r: any) => g === 'all' || r.tool_group === g)
  const tone = (s: string) => /low|fail|down/i.test(s) ? 'bad' : /awaiting/i.test(s) ? 'warn' : /running|paid/i.test(s) ? 'ok' : 'n'

  return (
    <div className="adm-stack">
      <Head title="Tools and APIs" lede="Every service AskGogo runs on, what it does, and what it cost. Twilio comes straight from its billing API. Models, search, calls and the secure browser are metered call by call and priced with the rate card. Fixed bills come from the invoices you add." />
      <Kpis items={[
        { label: 'Spend, this month', value: inr(total), sub: `${Math.round(elapsed)} days in` },
        { label: 'Projected month', value: inr((total / elapsed) * daysInMonth) },
        { label: 'Last month', value: inr(lastTotal), sub: lastTotal ? `${total >= lastTotal ? '+' : ''}${Math.round(((total / lastTotal) - 1) * 100)}% so far` : '' },
        { label: 'From invoices', value: inr(fixed), sub: 'the rest is usage' },
        { label: 'Biggest line', value: top?.now ? top.name.replace(/ \(.+\)/, '') : '—', sub: top?.now ? `${inr(top.now)}, ${Math.round((top.now / Math.max(1, total)) * 100)}%` : '' },
        { label: 'Per active user', value: msgs.size ? inrSmart(total / msgs.size) : '—', sub: `${msgs.size} active, 30 days` },
      ]} />
      <div className="adm-cols">
        <section>
          <h2>Spend by group, this month</h2>
          <BarList labelWidth={160} rows={byGroup.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l, value: v, display: inr(v), extra: total ? `${Math.round((v / total) * 100)}%` : '' }))} empty="No costs recorded yet." />
        </section>
        <section>
          <h2>Needs attention</h2>
          <div className="adm-list">
            {attention.map((r: any) => (
              <div className="adm-row" key={r.id}><div className="grow"><div>{r.name}</div><div className="muted">{r.src === 'Add invoice' ? 'No invoice recorded for this month yet.' : r.does}</div></div><Pill tone={r.src === 'Add invoice' ? 'n' : tone(r.status) as any}>{r.src === 'Add invoice' ? 'Add invoice' : r.status}</Pill></div>
            ))}
            {!attention.length ? <div className="adm-row muted">All good.</div> : null}
          </div>
        </section>
      </div>
      <section>
        <h2>Monthly spend, last 6 months</h2>
        <VBars values={hist} fmt={n => inr(n)} labels={[monthsKeys[0], 'This month (so far)']} />
      </section>
      {isOwner ? <section><h2>Add an invoice</h2><ToolCostForm tools={data.tools.map((t: any) => ({ id: t.id, name: t.name }))} months={[data.monthKey, data.prevKey]} /></section> : null}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="chips"><h2 style={{ margin: '0 12px 0 0' }}>All tools</h2>{[['all', 'All'], ...GROUPS.map(x => [x, x])].map(([k, l]) => <a key={k} className="chip" aria-current={g === k} href={`?g=${encodeURIComponent(k)}`}>{l}</a>)}</div>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Tool</th><th scope="col">What it does for AskGogo</th><th scope="col">Plan and pricing</th><th scope="col">This month</th><th scope="col">Last month</th><th scope="col">Where the number comes from</th><th scope="col">Renews</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {shown.map((r: any) => (
                <tr key={r.id}>
                  <td><div style={{ fontWeight: 500 }}>{r.name}</div><div style={{ fontSize: 12, color: 'var(--ink3)' }}>{r.tool_group}</div></td>
                  <td className="wrap" style={{ color: 'var(--ink2)' }}>{r.does}</td>
                  <td className="wrap" style={{ color: 'var(--ink2)', minWidth: 150 }}>{r.plan || '—'}</td>
                  <td style={{ fontWeight: 500 }}>{inrSmart(r.now)}</td>
                  <td style={{ color: 'var(--ink2)' }}>{inrSmart(r.last)}</td>
                  <td><Pill tone={r.src.startsWith('Auto') ? 'ok' : 'n'}>{r.src}</Pill></td>
                  <td style={{ color: 'var(--ink3)' }}>{r.renews || '—'}</td>
                  <td><Pill tone={tone(r.status) as any}>{r.status}</Pill></td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={8} style={{ color: 'var(--ink3)' }}>The tools register appears once the admin console migration is applied.</td></tr> : null}
            </tbody>
            {shown.length ? <tfoot><tr><td style={{ fontWeight: 600 }}>Total</td><td /><td /><td style={{ fontWeight: 600 }}>{inr(shown.reduce((a: number, r: any) => a + r.now, 0))}</td><td style={{ color: 'var(--ink2)' }}>{inr(shown.reduce((a: number, r: any) => a + r.last, 0))}</td><td /><td /><td /></tr></tfoot> : null}
          </table>
        </div>
        <p className="note">Rupees. Dollar amounts convert at the rate card's dollar rate ({fx}). API keys never appear here; they stay in Vercel.</p>
      </section>
    </div>
  )
}
