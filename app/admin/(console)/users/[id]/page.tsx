import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Kpis, Head, Pill, BarList, VBars } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/admin-client'
import { PlanForm } from '@/components/admin/plan-form'
import { runRows, costByVendor, costByDay, messageCounts, payments, istMonthStart, istDateKey, inrSmart, inr, when, ago, PLAN_LABEL, PLAN_BUDGET_INR, VENDOR_LABEL, CATEGORY_GROUP } from '@/lib/admin/console-data'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000
const STATUS_TONE: Record<string, ['ok' | 'bad' | 'warn' | 'n', string]> = {
  completed: ['ok', 'Finished'], failed: ['bad', 'Failed'], waiting_approval: ['warn', 'Waiting for yes'], running: ['n', 'Running'], queued: ['n', 'Queued'], watching: ['n', 'Watching'], paused: ['n', 'Paused'],
}

async function countOf(table: string, telegramId: string): Promise<number | null> {
  try {
    const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true }).eq('telegram_id', telegramId)
    return error ? null : count ?? 0
  } catch { return null }
}

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tid = decodeURIComponent(id)
  const { data: user } = await supabaseAdmin.from('users').select('*').eq('telegram_id', Number(tid)).maybeSingle()
  if (!user) notFound()
  const u: any = user
  const gate = await requireAdminConsole('viewer')
  const canAct = gate.ok && gate.admin.role !== 'viewer'
  const since = new Date(Date.now() - 30 * DAY)
  const [runs, vendors, daily, msgs, pays, reminders, memories, documents, lifeEvents, watchers, expenses, calendars] = await Promise.all([
    runRows(since, tid, 1000), costByVendor(since, tid), costByDay(since, tid), messageCounts(since), payments(istMonthStart()),
    countOf('reminders', tid), countOf('memories', tid), countOf('documents', tid), countOf('life_events', tid), countOf('agent_watchers', tid), countOf('expenses', tid), countOf('google_calendar_accounts', tid),
  ])
  const total = vendors.reduce((a, v) => a + v.cost, 0)
  const paidMonth = pays.filter(p => p.telegram_id === tid).reduce((a, p) => a + p.amount, 0)
  const budget = PLAN_BUDGET_INR[u.tier] ?? 25
  const byType = new Map<string, { n: number; done: number }>()
  for (const r of runs) { const t = byType.get(r.type) || { n: 0, done: 0 }; t.n++; if (r.status === 'completed') t.done++; byType.set(r.type, t) }
  const doneAll = runs.filter(r => r.status === 'completed').length
  const groups = new Map<string, number>(); for (const v of vendors) groups.set(CATEGORY_GROUP(v.vendor), (groups.get(CATEGORY_GROUP(v.vendor)) || 0) + v.cost)
  const days = Array.from({ length: 30 }, (_, i) => istDateKey(new Date(Date.now() - (29 - i) * DAY)))
  const dayCost = new Map(daily.map(d => [d.day, d.cost]))
  const blocked = u.access_status === 'blocked'
  const phone = String(u.whatsapp_id || '').replace(/^whatsapp:/, '')

  return (
    <div className="adm-stack">
      <Link href="/admin/users" style={{ color: 'var(--ink2)', fontSize: 14, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>← All users</Link>
      <Head title={u.name || 'Friend'} lede={<>{phone || 'no WhatsApp number'} · {PLAN_LABEL[u.tier] || u.tier} plan · joined {u.created_at ? when(u.created_at) : '—'} · {blocked ? <Pill tone="bad">Blocked</Pill> : <Pill tone="ok">Active</Pill>}</>}>
        {canAct ? <PlanForm telegramId={tid} tier={u.tier || 'free'} /> : null}
        {canAct ? (blocked
          ? <ActionButton action="user.unblock" body={{ telegramId: tid }} label="Unblock" className="btn lg solid" />
          : <ActionButton action="user.block" body={{ telegramId: tid }} label="Block access" className="btn lg danger" confirm="Blocks WhatsApp and the dashboard for this person." />) : null}
      </Head>
      <Kpis items={[
        { label: 'Messages', value: msgs.get(tid)?.n || 0, sub: `last ${ago(msgs.get(tid)?.last)}` },
        { label: 'Tasks', value: runs.length, sub: '30 days' },
        { label: 'Finished', value: runs.length ? `${Math.round((doneAll / runs.length) * 100)}%` : '—' },
        { label: 'Cost, 30 days', value: inrSmart(total) },
        { label: 'Per task', value: runs.length ? inrSmart(total / runs.length) : '—' },
        { label: 'Budget used', value: `${Math.round((total / budget) * 100)}%`, sub: `of ${inr(budget)} a month` },
        { label: 'Paid, month', value: paidMonth ? inr(paidMonth) : '—' },
      ]} />
      <div className="adm-cols">
        <section>
          <h2>Tasks by type</h2>
          <BarList labelWidth={150} empty="No tasks in the last 30 days." rows={[...byType.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, v]) => ({ label: t.replace(/_/g, ' '), value: v.n, display: v.n, extra: `${v.done} done` }))} />
        </section>
        <section>
          <h2>Cost breakdown</h2>
          <BarList labelWidth={150} empty="No metered usage yet." rows={[...groups.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => ({ label: g, value: c, display: inrSmart(c) }))} />
          <div className="adm-row" style={{ fontWeight: 500 }}><span className="grow">Total, 30 days</span><span>{inrSmart(total)}</span></div>
          <p className="note">{vendors.map(v => `${VENDOR_LABEL[v.vendor] || v.vendor}: ${v.events} ${v.category === 'llm' ? `calls, ${(v.input + v.output).toLocaleString('en-IN')} tokens` : 'uses'}`).join(' · ') || ' '}</p>
        </section>
      </div>
      <section>
        <h2>Daily cost, 30 days</h2>
        <VBars values={days.map(d => dayCost.get(d) || 0)} fmt={n => inrSmart(n)} labels={['30 days ago', 'Today']} />
      </section>
      <div className="adm-cols">
        <section>
          <h2>Connected</h2>
          <div className="adm-list">
            <div className="adm-row"><span className="grow">WhatsApp</span><Pill tone={phone ? 'ok' : 'n'}>{phone ? 'Connected' : 'Not linked'}</Pill></div>
            <div className="adm-row"><span className="grow">Gmail</span><Pill tone={u.gmail_connected ? 'ok' : 'n'}>{u.gmail_connected ? 'Connected' : 'Not connected'}</Pill></div>
            <div className="adm-row"><span className="grow">Google Calendar</span><Pill tone={calendars ? 'ok' : 'n'}>{calendars ? `${calendars} connected` : 'Not connected'}</Pill></div>
          </div>
        </section>
        <section>
          <h2>What AskGogo holds</h2>
          <div className="adm-list">
            {([['Reminders', reminders], ['Saved memories', memories], ['Documents', documents], ['Bookings and events', lifeEvents], ['Watchers', watchers], ['Expenses', expenses]] as const).map(([l, n]) => (
              <div className="adm-row" key={l}><span className="grow">{l}</span><span style={{ fontWeight: 500 }}>{n ?? '—'}</span></div>
            ))}
          </div>
          <p className="note">Counts only. The console never shows a person's messages or saved documents.</p>
        </section>
      </div>
      <section>
        <h2>Recent tasks</h2>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Started</th><th scope="col">Task</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Took</th></tr></thead>
            <tbody>
              {runs.slice(0, 30).map(r => { const [tone, label] = STATUS_TONE[r.status] || ['n', r.status]; const took = r.completed_at ? Math.max(0, new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) : null; return (
                <tr key={r.id}><td style={{ color: 'var(--ink3)' }}>{when(r.started_at)}</td><td className="wrap">{r.title}</td><td style={{ color: 'var(--ink2)' }}>{r.type.replace(/_/g, ' ')}</td><td><Pill tone={tone}>{label}</Pill></td><td style={{ color: 'var(--ink2)' }}>{took == null ? '—' : took < 60_000 ? `${Math.round(took / 1000)} s` : `${Math.round(took / 60_000)} min`}</td></tr>
              ) })}
              {!runs.length ? <tr><td colSpan={5} style={{ color: 'var(--ink3)' }}>No tasks in the last 30 days.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
