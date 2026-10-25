import Link from 'next/link'
import { Kpis, Head, Pill, Bar, BarList } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/admin-client'
import { runRows, runCounts, userRows, istDayStart, when } from '@/lib/admin/console-data'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000
const LIVE = ['queued', 'running', 'watching', 'paused']
const TONE: Record<string, ['ok' | 'bad' | 'warn' | 'n', string]> = {
  completed: ['ok', 'Finished'], failed: ['bad', 'Failed'], waiting_approval: ['warn', 'Waiting for yes'], running: ['n', 'Running'], queued: ['n', 'Queued'], watching: ['n', 'Watching'], paused: ['n', 'Paused'],
}
const FILTERS: [string, string][] = [['all', 'All'], ['live', 'Running'], ['waiting_approval', 'Waiting for yes'], ['completed', 'Finished'], ['failed', 'Failed']]
const dur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3600_000)} h`)
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const f = sp.f || 'all'
  const gate = await requireAdminConsole('viewer')
  const canAct = gate.ok && gate.admin.role !== 'viewer'
  const now = Date.now(), week = new Date(now - 7 * DAY), today = istDayStart()
  const [recent, week7, countsToday, users] = await Promise.all([runRows(new Date(now - 30 * DAY), undefined, 300), runRows(week, undefined, 1000), runCounts(today), userRows()])
  const names = new Map(users.map(u => [u.telegram_id, u.name]))
  const sum = (pred: (s: string) => boolean) => countsToday.filter(r => pred(r.status)).reduce((a, r) => a + r.runs, 0)
  const doneToday = sum(s => s === 'completed'), failedToday = sum(s => s === 'failed'), startedToday = sum(() => true)
  const liveNow = recent.filter(r => LIVE.includes(r.status)).length
  const waitingNow = recent.filter(r => r.status === 'waiting_approval').length
  const finished7 = week7.filter(r => r.status === 'completed' || r.status === 'failed')
  const ok7 = week7.filter(r => r.status === 'completed')
  const times = ok7.filter(r => r.completed_at && r.type !== 'watcher').map(r => new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime()).filter(ms => ms >= 0 && ms < 6 * 3600_000)
  const shown = recent.filter(r => f === 'all' ? true : f === 'live' ? LIVE.includes(r.status) : r.status === f)

  const types = new Map<string, { runs: number; done: number; failed: number; times: number[]; why: Map<string, number> }>()
  for (const r of week7) {
    const t = types.get(r.type) || { runs: 0, done: 0, failed: 0, times: [], why: new Map() }
    t.runs++
    if (r.status === 'completed') { t.done++; if (r.completed_at) t.times.push(new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) }
    if (r.status === 'failed') { t.failed++; const w = String(r.error || 'No reason recorded').slice(0, 70); t.why.set(w, (t.why.get(w) || 0) + 1) }
    types.set(r.type, t)
  }
  const reasons = new Map<string, number>()
  for (const r of week7.filter(r => r.status === 'failed')) { const w = String(r.error || 'No reason recorded').slice(0, 80); reasons.set(w, (reasons.get(w) || 0) + 1) }

  return (
    <div className="adm-stack">
      <Head title="Tasks" lede="Every job AskGogo does for people: bookings, phone calls, price checks, watchers, email drafts, reminders and plans." />
      <Kpis items={[
        { label: 'Running now', value: liveNow, sub: 'incl. watchers' },
        { label: 'Waiting for yes', value: waitingNow, sub: 'approval cards out' },
        { label: 'Started today', value: startedToday },
        { label: 'Finished today', value: doneToday },
        { label: 'Failed today', value: failedToday },
        { label: 'Success, 7 days', value: finished7.length ? `${Math.round((ok7.length / finished7.length) * 100)}%` : '—', sub: `${finished7.length} finished or failed` },
        { label: 'Typical time', value: median(times) == null ? '—' : dur(median(times)!), sub: 'median, 7 days' },
      ]} />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="chips"><h2 style={{ margin: '0 12px 0 0' }}>Live feed</h2>{FILTERS.map(([k, l]) => <Link key={k} className="chip" aria-current={f === k} href={`?f=${k}`}>{l}</Link>)}</div>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Started</th><th scope="col">Person</th><th scope="col">Task</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Where it is</th><th scope="col">Time</th>{canAct ? <th scope="col"><span className="sr">Actions</span></th> : null}</tr></thead>
            <tbody>
              {shown.slice(0, 100).map(r => { const [tone, label] = TONE[r.status] || ['n', r.status]; const end = r.completed_at ? new Date(r.completed_at).getTime() : Date.now(); return (
                <tr key={r.id}>
                  <td style={{ color: 'var(--ink3)' }}>{when(r.started_at)}</td>
                  <td style={{ fontWeight: 500 }}><Link href={`/admin/users/${encodeURIComponent(r.telegram_id)}`}>{names.get(r.telegram_id) || r.telegram_id}</Link></td>
                  <td className="wrap">{r.title}</td>
                  <td style={{ color: 'var(--ink2)' }}>{r.type.replace(/_/g, ' ')}</td>
                  <td><Pill tone={tone}>{label}</Pill></td>
                  <td className="wrap" style={{ color: 'var(--ink2)' }}>{(r.status === 'failed' ? r.error : r.summary) || '—'}</td>
                  <td style={{ color: 'var(--ink2)' }}>{dur(Math.max(0, end - new Date(r.started_at).getTime()))}</td>
                  {canAct ? <td>{[...LIVE, 'waiting_approval'].includes(r.status) ? <ActionButton action="task.cancel" body={{ id: r.id }} label="Cancel" confirm="Cancel this task?" /> : null}</td> : null}
                </tr>) })}
              {!shown.length ? <tr><td colSpan={8} style={{ color: 'var(--ink3)' }}>No tasks here.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="note">The console shows task titles and steps, never card numbers, sign-in codes or passwords.</p>
      </section>
      <section>
        <h2>How each kind of task is doing, last 7 days</h2>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Task type</th><th scope="col">Runs</th><th scope="col">Finished</th><th scope="col">Failed</th><th scope="col">Success</th><th scope="col">Typical time</th><th scope="col">Most common failure</th></tr></thead>
            <tbody>
              {[...types.entries()].sort((a, b) => b[1].runs - a[1].runs).map(([t, v]) => { const closed = v.done + v.failed; const rate = closed ? Math.round((v.done / closed) * 100) : null; const top = [...v.why.entries()].sort((a, b) => b[1] - a[1])[0]; const m = median(v.times); return (
                <tr key={t}><td style={{ fontWeight: 500 }}>{t.replace(/_/g, ' ')}</td><td>{v.runs}</td><td>{v.done}</td><td>{v.failed}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 130 }}>{rate == null ? '—' : <><Bar pct={rate} tone={rate < 60 ? 'warn' : undefined} /><span>{rate}%</span></>}</div></td>
                  <td style={{ color: 'var(--ink2)' }}>{m == null ? '—' : dur(m)}</td><td className="wrap" style={{ color: 'var(--ink2)' }}>{top ? top[0] : '—'}</td></tr>) })}
              {!types.size ? <tr><td colSpan={7} style={{ color: 'var(--ink3)' }}>No tasks in the last 7 days.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Why tasks failed, last 7 days</h2>
        <BarList labelWidth={260} empty="No failures in the last 7 days." rows={[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => ({ label: w, value: n, display: n }))} />
      </section>
    </div>
  )
}
