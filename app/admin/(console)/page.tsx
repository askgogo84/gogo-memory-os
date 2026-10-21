import Link from 'next/link'
import { Kpis, Head, BarList, VBars, Pill } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/admin-client'
import { waitlistRows, userRows, messageCounts, payments, runCounts, costByUser, toolsWithCosts, cronHeartbeats, cronJobs, istMonthStart, istDayStart, istDateKey, inr, inrSmart, maskPhone, ago, PLAN_LABEL, PLAN_BUDGET_INR } from '@/lib/admin/console-data'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000

export default async function OverviewPage() {
  const now = new Date(), month = istMonthStart(now), today = istDayStart(now)
  const [wl, users, msgs7, pays, runsToday, costUsers, tools, beats] = await Promise.all([
    waitlistRows(), userRows(), messageCounts(new Date(now.getTime() - 7 * DAY)), payments(month), runCounts(today), costByUser(month), toolsWithCosts(month), cronHeartbeats(),
  ])
  const by = (s: string) => wl.filter(w => w.status === s)
  const waiting = by('waiting'), invited = by('invited'), joined = by('joined')
  const usersById = new Map(users.map(u => [u.telegram_id, u]))
  const activeUsers = users.filter(u => u.access_status !== 'blocked')
  const active7 = [...msgs7.keys()].filter(id => usersById.has(id)).length
  const revenue = pays.reduce((a, p) => a + p.amount, 0)
  const payingIds = new Set(pays.map(p => p.telegram_id).filter(Boolean))
  const usage = costUsers.reduce((a, c) => a + c.cost, 0)
  const manual = tools.costs.filter((c: any) => c.month === tools.monthKey).reduce((a: number, c: any) => a + Number(c.amount_inr || 0), 0)
  const spend = usage + manual
  const runTotal = runsToday.reduce((a, r) => a + r.runs, 0)
  const runBy = (pred: (s: string) => boolean) => runsToday.filter(r => pred(r.status)).reduce((a, r) => a + r.runs, 0)
  const done = runBy(s => s === 'completed'), failed = runBy(s => s === 'failed'), waitingYes = runBy(s => s === 'waiting_approval'), running = runBy(s => ['queued', 'running', 'watching', 'paused'].includes(s))

  const days = Array.from({ length: 14 }, (_, i) => istDateKey(new Date(now.getTime() - (13 - i) * DAY)))
  const signups = days.map(d => wl.filter(w => istDateKey(w.created_at) === d).length)
  const funnel: [string, number][] = [['Signed up', wl.length], ['Approved', invited.length + joined.length], ['Joined', joined.length], ['Active 7 days', active7], ['Paid this month', payingIds.size]]
  const tierCounts = new Map<string, number>()
  for (const u of activeUsers) tierCounts.set(u.tier, (tierCounts.get(u.tier) || 0) + 1)
  const overBudget = costUsers.filter(c => { const u = usersById.get(c.telegram_id); return u && c.cost > (PLAN_BUDGET_INR[u.tier] ?? 25) }).length

  const jobs = cronJobs()
  const beatBy = new Map(beats.map((b: any) => [b.job, b]))
  const staleJobs = beats.length ? jobs.filter(j => { const b: any = beatBy.get(j.job); const every = /^\* /.test(j.schedule) ? 3 : /^\*\/5/.test(j.schedule) ? 15 : /^\*\/15/.test(j.schedule) ? 45 : 1500; return !b || Date.now() - new Date(b.last_started_at).getTime() > every * 60_000 }) : []
  const toolAlerts = tools.tools.filter((t: any) => /low|awaiting|fail|down/i.test(t.status))

  const alerts: { tone: 'bad' | 'warn' | 'n'; level: string; title: string; detail: string; href: string; cta: string }[] = []
  if (waiting.length) alerts.push({ tone: 'warn', level: 'Today', title: `${waiting.length} ${waiting.length === 1 ? 'person' : 'people'} waiting for approval`, detail: `${wl.filter(w => istDateKey(w.created_at) === days[13]).length} signed up today.`, href: '/admin/waitlist', cta: 'Review' })
  for (const j of staleJobs.slice(0, 3)) alerts.push({ tone: 'bad', level: 'Check', title: `${j.job} hasn't run on time`, detail: `Scheduled ${j.schedule}.`, href: '/admin/health', cta: 'Health' })
  for (const t of toolAlerts.slice(0, 3)) alerts.push({ tone: /low|fail|down/i.test(t.status) ? 'bad' : 'n', level: /low|fail|down/i.test(t.status) ? 'Urgent' : 'Waiting', title: `${t.name}: ${t.status}`, detail: t.does, href: '/admin/tools', cta: 'Tools' })
  if (overBudget) alerts.push({ tone: 'n', level: 'Watch', title: `${overBudget} ${overBudget === 1 ? 'user is' : 'users are'} past their plan budget this month`, detail: 'Usage cost above the plan budget from the cost guard.', href: '/admin/costs', cta: 'Costs' })

  return (
    <div className="adm-stack">
      <Head title="Overview" lede={`${now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })} · this month unless marked`}>
        <Link className="btn solid lg" href="/admin/waitlist">Review {waiting.length} waiting</Link>
      </Head>
      <Kpis items={[
        { label: 'Waiting', value: waiting.length, sub: 'on the waitlist' },
        { label: 'Approved', value: invited.length, sub: 'not joined yet' },
        { label: 'Users', value: activeUsers.length, sub: `${users.length - activeUsers.length} blocked` },
        { label: 'Active, 7 days', value: active7, sub: 'sent a message' },
        { label: 'Revenue', value: inr(revenue), sub: `${payingIds.size} paid this month` },
        { label: 'Tasks today', value: runTotal, sub: runTotal ? `${Math.round((done / runTotal) * 100)}% finished` : 'none yet' },
        { label: 'Spend', value: inr(spend), sub: `usage ${inr(usage)} · invoices ${inr(manual)}` },
        { label: 'Per active user', value: inrSmart(active7 ? spend / active7 : 0), sub: 'this month' },
      ]} />
      <div className="adm-cols">
        <section>
          <h2>Funnel</h2>
          <BarList labelWidth={120} rows={funnel.map(([l, n], i) => ({ label: l, value: n, display: n, extra: i === 0 || !funnel[i - 1][1] ? '' : `${Math.round((n / funnel[i - 1][1]) * 100)}%` }))} />
          <p className="note">Approved and joined count waitlist numbers only; existing users joined before the waitlist.</p>
        </section>
        <section>
          <h2>Needs your attention</h2>
          <div className="adm-list">
            {alerts.length ? alerts.map((a, i) => (
              <div className="adm-row" key={i} style={{ alignItems: 'flex-start' }}>
                <Pill tone={a.tone}>{a.level}</Pill>
                <div className="grow"><div>{a.title}</div><div className="muted">{a.detail}</div></div>
                <Link href={a.href} style={{ color: 'var(--accent)' }}>{a.cta}</Link>
              </div>
            )) : <div className="adm-row muted">Nothing needs you right now.</div>}
          </div>
        </section>
      </div>
      <div className="adm-cols">
        <section>
          <div className="adm-head"><h2>Waiting for approval</h2><Link href="/admin/waitlist" style={{ color: 'var(--accent)', fontSize: 14 }}>See all {waiting.length}</Link></div>
          <div className="adm-list">
            {waiting.slice(0, 5).map(w => (
              <div className="adm-row" key={w.id} style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ flex: '1 1 180px' }}><div>{maskPhone(w.phone_e164)}{w.profile_name ? ` · ${w.profile_name}` : ''}</div><div className="muted">{w.email || 'no email'} · {w.source || '—'} · {ago(w.created_at)}</div></div>
                <ActionButton action="waitlist.approve" body={{ ids: [w.id] }} label="Approve" className="btn sm solid" />
                <ActionButton action="waitlist.block" body={{ ids: [w.id] }} label="Block" confirm="Block this number?" />
              </div>
            ))}
            {!waiting.length ? <div className="adm-row muted">No one is waiting.</div> : null}
          </div>
        </section>
        <section>
          <h2>Signups, last 14 days</h2>
          <VBars values={signups} labels={[new Date(now.getTime() - 13 * DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }), 'Today']} />
        </section>
      </div>
      <div className="adm-cols">
        <section>
          <h2>Plan mix</h2>
          <BarList labelWidth={110} rows={[...tierCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: PLAN_LABEL[t] || t, value: n, display: n }))} />
        </section>
        <section>
          <h2>Tasks today</h2>
          <div className="adm-list">
            {([['Finished', done, 'ok'], ['Waiting for a yes', waitingYes, 'warn'], ['Running or watching', running, 'n'], ['Failed', failed, 'bad']] as const).map(([l, n, t]) => (
              <div className="adm-row" key={l}><span className="grow">{l}</span><Pill tone={t}>{n}</Pill></div>
            ))}
          </div>
          <Link href="/admin/tasks" style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', color: 'var(--accent)' }}>Open Tasks</Link>
        </section>
        <section>
          <h2>Highest cost users</h2>
          <div className="adm-list">
            {costUsers.filter(c => c.telegram_id !== 'system').slice(0, 5).map(c => { const u = usersById.get(c.telegram_id); return (
              <Link key={c.telegram_id} href={`/admin/users/${encodeURIComponent(c.telegram_id)}`} className="adm-row" style={{ textDecoration: 'none' }}>
                <span className="grow">{u?.name || c.telegram_id} <span className="muted">· {PLAN_LABEL[u?.tier || ''] || u?.tier || '—'}</span></span><span style={{ fontWeight: 500 }}>{inrSmart(c.cost)}</span>
              </Link>) })}
            {!costUsers.length ? <div className="adm-row muted">No metered usage yet. It starts filling as people use AskGogo.</div> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
