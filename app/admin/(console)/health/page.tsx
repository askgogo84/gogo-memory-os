import { Kpis, Head, Pill } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/admin-client'
import { cronJobs, cronHeartbeats, meterFailures, runCounts, ago, when } from '@/lib/admin/console-data'
import { requireAdminConsole } from '@/lib/admin/console-auth'
import { accessGateEnabled } from '@/lib/access/gate'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000
const DOES: Record<string, string> = {
  'reminders': 'Sends due reminders on WhatsApp', 'autonomous-runs': 'Moves background tasks forward and reports phone call results',
  'travel-research': 'Flight and train searches people asked for', 'price-comparisons': 'Runs queued price checks', 'booking-events': 'Follows up on bookings in progress',
  'life-events': 'Reminders before saved bookings, trips and events', 'booking-rehearsal': 'Checks booking sites still work', 'daily-briefings': 'Morning briefing for each person',
  'agent-watchers': 'Checks watched prices, rates and pages', 'agent-goals': 'Advances longer goals', 'autonomy-pulse': 'Looks for things to offer to do',
  'open-loops': 'Nudges about unfinished threads', 'agent-learning': 'Learns preferences from finished tasks', 'followups': 'Daily follow-up messages', 'lifecycle-emails': 'Welcome and re-engagement emails',
}
function every(schedule: string): [string, number] {
  if (schedule === '* * * * *') return ['Every minute', 3]
  const m = schedule.match(/^\*\/(\d+) /); if (m) return [`Every ${m[1]} min`, Number(m[1]) * 3]
  if (/^\d+,\d+ \* /.test(schedule)) return ['Twice an hour', 75]
  if (/^\d+ \* /.test(schedule)) return ['Hourly', 150]
  const d = schedule.match(/^(\d+) (\d+) \* \* \*$/)
  if (d) { const utc = Number(d[2]) * 60 + Number(d[1]) + 330; const h = Math.floor(utc / 60) % 24, mi = utc % 60; return [`Daily, ${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`, 1500] }
  return [schedule, 1500]
}
const ENV_SERVICES: [string, string, string[]][] = [
  ['Twilio WhatsApp', 'Messages in and out', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER']],
  ['Anthropic Claude', 'Main model', ['ANTHROPIC_API_KEY']], ['Inception Mercury', 'Planning model', ['INCEPTION_API_KEY']], ['OpenAI', 'Fallback, vision, voice', ['OPENAI_API_KEY']],
  ['Supabase', 'Database and files', ['SUPABASE_SERVICE_ROLE_KEY']], ['Browserbase', 'Secure browser', ['GOGO_BROWSER_RUNTIME']], ['Bolna + Plivo', 'Phone calls', ['BOLNA_API_KEY']],
  ['Tavily', 'Web search', ['TAVILY_API_KEY']], ['Serper', 'Google results', ['SERPER_API_KEY']], ['Google', 'Gmail and Calendar', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']],
  ['Razorpay', 'Payments', ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']], ['Resend', 'Email', ['RESEND_API_KEY']],
]

async function deploys(): Promise<{ title: string; state: string; at: number }[] | null> {
  const token = process.env.VERCEL_TOKEN, project = process.env.VERCEL_PROJECT_ID
  if (!token || !project) return null
  try {
    const team = process.env.VERCEL_TEAM_ID ? `&teamId=${process.env.VERCEL_TEAM_ID}` : ''
    const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${project}&target=production&limit=6${team}`, { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 120 } } as any)
    if (!res.ok) return null
    const body: any = await res.json()
    return (body.deployments || []).map((d: any) => ({ title: String(d.meta?.githubCommitMessage || d.name || '').split('\n')[0].slice(0, 110), state: d.state || d.readyState, at: d.created }))
  } catch { return null }
}

export default async function HealthPage() {
  const gate = await requireAdminConsole('viewer')
  const canAct = gate.ok && gate.admin.role !== 'viewer'
  const since = new Date(Date.now() - DAY)
  const [beats, failures, runs, deps] = await Promise.all([cronHeartbeats(), meterFailures(since), runCounts(since), deploys()])
  const jobs = cronJobs()
  const beatBy = new Map(beats.map((b: any) => [b.job, b]))
  const rowsJ = jobs.map(j => {
    const b: any = beatBy.get(j.job); const [label, graceMin] = every(j.schedule)
    const late = !b || Date.now() - new Date(b.last_started_at).getTime() > graceMin * 60_000
    return { ...j, label, b, state: !beats.length ? 'unknown' : late ? 'late' : 'ok' }
  })
  const healthy = rowsJ.filter(r => r.state === 'ok').length
  const failedRuns = runs.filter(r => r.status === 'failed').reduce((a, r) => a + r.runs, 0)
  const apiFails = failures.reduce((a, f) => a + f.failures, 0)
  const services = ENV_SERVICES.map(([name, does, keys]) => ({ name, does, ok: keys.every(k => !!process.env[k]) }))

  return (
    <div className="adm-stack">
      <Head title="System health" lede="Is everything running: background jobs, the access gate, metering, connected services and failed calls." />
      <Kpis items={[
        { label: 'Jobs on time', value: beats.length ? `${healthy} / ${rowsJ.length}` : '—', sub: beats.length ? 'by heartbeat' : 'heartbeats start after deploy' },
        { label: 'Access gate', value: accessGateEnabled() ? 'On' : 'Off', sub: accessGateEnabled() ? 'new numbers wait' : 'everyone gets in' },
        { label: 'Failed tasks', value: failedRuns, sub: 'last 24 h' },
        { label: 'Failed API calls', value: apiFails, sub: 'last 24 h, metered' },
        { label: 'Metering', value: process.env.ADMIN_METERING_ENABLED === 'false' ? 'Off' : 'On' },
      ]} />
      <section>
        <h2>Background jobs</h2>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Job</th><th scope="col">What it does</th><th scope="col">Runs</th><th scope="col">Last run</th><th scope="col">Runs today</th><th scope="col">Status</th>{canAct ? <th scope="col"><span className="sr">Run</span></th> : null}</tr></thead>
            <tbody>
              {rowsJ.map(r => (
                <tr key={r.path}>
                  <td style={{ fontWeight: 500 }}>{r.job}</td><td className="wrap" style={{ color: 'var(--ink2)' }}>{DOES[r.job] || '—'}</td><td style={{ color: 'var(--ink2)' }}>{r.label}</td>
                  <td style={{ color: 'var(--ink3)' }}>{r.b ? ago(r.b.last_started_at) : '—'}</td><td style={{ color: 'var(--ink2)' }}>{r.b?.runs_today ?? '—'}</td>
                  <td>{r.state === 'ok' ? <Pill tone="ok">On time</Pill> : r.state === 'late' ? <Pill tone="bad">Late</Pill> : <Pill>Waiting for first run</Pill>}</td>
                  {canAct ? <td><ActionButton action="job.run" body={{ path: r.path }} label="Run now" /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="adm-cols">
        <section>
          <h2>Connected services</h2>
          <div className="adm-list">
            {services.map(s => <div className="adm-row" key={s.name}><div className="grow"><div>{s.name}</div><div className="muted">{s.does}</div></div><Pill tone={s.ok ? 'ok' : 'warn'}>{s.ok ? 'Configured' : 'Key missing'}</Pill></div>)}
          </div>
          <p className="note">Checks that each key is set in Vercel. Values are never shown.</p>
        </section>
        <section>
          <h2>Failed API calls, last 24 hours</h2>
          <div className="adm-list">
            {failures.filter(f => f.failures > 0).map(f => <div className="adm-row" key={f.vendor + f.category}><div className="grow"><div>{f.vendor} · {f.category}</div><div className="muted">last {ago(f.last)}</div></div><span style={{ fontWeight: 500 }}>{f.failures} of {f.calls}</span></div>)}
            {!failures.some(f => f.failures > 0) ? <div className="adm-row muted">No failed metered calls.</div> : null}
          </div>
          <h2 style={{ marginTop: 28 }}>Recent deploys</h2>
          <div className="adm-list">
            {deps ? deps.map((d, i) => <div className="adm-row" key={i}><span className="grow">{d.title}</span><span className="muted">{when(new Date(d.at).toISOString())}</span><Pill tone={d.state === 'READY' ? 'ok' : d.state === 'ERROR' ? 'bad' : 'n'}>{d.state === 'READY' ? 'Live' : d.state}</Pill></div>)
              : <div className="adm-row muted">Add VERCEL_TOKEN and VERCEL_PROJECT_ID in Vercel to list deploys here.</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
