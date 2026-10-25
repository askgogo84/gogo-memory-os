import Link from 'next/link'
import { Head, Pill, Bar } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/admin-client'
import { userRows, messageCounts, runCounts, costByUser, payments, istMonthStart, inrSmart, inr, ago, PLAN_LABEL, PLAN_BUDGET_INR } from '@/lib/admin/console-data'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000
const PLANS: [string, string][] = [['all', 'All plans'], ['free', 'Free'], ['starter', 'Starter'], ['pro', 'Pro'], ['founder_pro', 'Founder Pro'], ['blocked', 'Blocked']]
const SORTS: [string, string][] = [['cost', 'Highest cost'], ['tasks', 'Most tasks'], ['active', 'Last active'], ['new', 'Newest']]

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const plan = sp.plan || 'all', sort = sp.sort || 'cost', q = (sp.q || '').trim().toLowerCase()
  const gate = await requireAdminConsole('viewer')
  const canAct = gate.ok && gate.admin.role !== 'viewer'
  const since = new Date(Date.now() - 30 * DAY)
  const [users, msgs, runs, costs, pays] = await Promise.all([userRows(), messageCounts(since), runCounts(since), costByUser(since), payments(istMonthStart())])
  const cost = new Map(costs.map(c => [c.telegram_id, c.cost]))
  const tasks = new Map<string, number>(); for (const r of runs) tasks.set(r.telegram_id, (tasks.get(r.telegram_id) || 0) + r.runs)
  const paid = new Map<string, number>(); for (const p of pays) if (p.telegram_id) paid.set(p.telegram_id, (paid.get(p.telegram_id) || 0) + p.amount)
  let list = users.map(u => ({ ...u, msgs: msgs.get(u.telegram_id)?.n || 0, last: msgs.get(u.telegram_id)?.last || null, tasks: tasks.get(u.telegram_id) || 0, cost: cost.get(u.telegram_id) || 0, paid: paid.get(u.telegram_id) || 0 }))
  list = list.filter(u => plan === 'all' ? true : plan === 'blocked' ? u.access_status === 'blocked' : u.tier === plan)
  if (q) list = list.filter(u => u.name.toLowerCase().includes(q) || u.whatsapp_id.includes(q.replace(/\s/g, '')))
  list.sort((a, b) => sort === 'tasks' ? b.tasks - a.tasks : sort === 'active' ? String(b.last || '').localeCompare(String(a.last || '')) : sort === 'new' ? String(b.created_at || '').localeCompare(String(a.created_at || '')) : b.cost - a.cost)
  const qs = (patch: Record<string, string>) => '?' + new URLSearchParams({ plan, sort, ...(q ? { q } : {}), ...patch }).toString()

  return (
    <div className="adm-stack">
      <Head title="Users" lede={`Everyone with access, with usage and cost for the last 30 days. ${list.length} of ${users.length} shown.`} />
      <div className="chips">
        {PLANS.map(([k, l]) => <Link key={k} className="chip" aria-current={plan === k} href={qs({ plan: k })}>{l}</Link>)}
      </div>
      <form className="chips" action="/admin/users">
        <input type="hidden" name="plan" value={plan} />
        <label className="sr" htmlFor="u-sort">Sort</label>
        <select id="u-sort" name="sort" className="field" defaultValue={sort}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="sr" htmlFor="u-q">Search name or phone</label>
        <input id="u-q" name="q" className="field" type="search" placeholder="Search name or phone" defaultValue={q} style={{ flex: '1 1 200px' }} />
        <button className="btn lg" type="submit">Apply</button>
      </form>
      <div className="adm-table">
        <table>
          <thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Last message</th><th scope="col">Messages</th><th scope="col">Tasks</th><th scope="col">Cost</th><th scope="col">Paid, month</th><th scope="col">Budget used</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {list.slice(0, 300).map(u => {
              const budget = PLAN_BUDGET_INR[u.tier] ?? 25, pct = (u.cost / budget) * 100
              return (
                <tr key={u.telegram_id}>
                  <td style={{ fontWeight: 500 }}><Link href={`/admin/users/${encodeURIComponent(u.telegram_id)}`}>{u.name}</Link></td>
                  <td style={{ color: 'var(--ink2)' }}>{u.whatsapp_id || '—'}</td>
                  <td>{PLAN_LABEL[u.tier] || u.tier}</td>
                  <td>{u.access_status === 'blocked' ? <Pill tone="bad">Blocked</Pill> : pct >= 100 ? <Pill tone="warn">Over budget</Pill> : <Pill tone="ok">Active</Pill>}</td>
                  <td style={{ color: 'var(--ink3)' }}>{ago(u.last)}</td>
                  <td>{u.msgs}</td>
                  <td>{u.tasks}</td>
                  <td style={{ fontWeight: 500 }}>{inrSmart(u.cost)}</td>
                  <td style={{ color: 'var(--ink2)' }}>{u.paid ? inr(u.paid) : '—'}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 130 }}><Bar pct={pct} tone={pct >= 90 ? 'warn' : undefined} /><span style={{ fontSize: 13, color: 'var(--ink2)' }}>{Math.round(pct)}%</span></div></td>
                  <td><div style={{ display: 'flex', gap: 6 }}>
                    <Link className="btn sm" href={`/admin/users/${encodeURIComponent(u.telegram_id)}`}>View</Link>
                    {canAct ? (u.access_status === 'blocked'
                      ? <ActionButton action="user.unblock" body={{ telegramId: u.telegram_id }} label="Unblock" className="btn sm solid" />
                      : <ActionButton action="user.block" body={{ telegramId: u.telegram_id }} label="Block" confirm="Block this user?" />) : null}
                  </div></td>
                </tr>
              )
            })}
            {!list.length ? <tr><td colSpan={11} style={{ color: 'var(--ink3)' }}>No users match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.length > 300 ? <p className="note">Showing 300 of {list.length}. Search or filter to narrow it.</p> : null}
    </div>
  )
}
