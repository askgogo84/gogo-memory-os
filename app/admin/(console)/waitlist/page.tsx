import { Kpis, Head, BarList } from '@/components/admin/ui'
import { WaitlistTable } from '@/components/admin/waitlist-table'
import { waitlistRows, istDateKey } from '@/lib/admin/console-data'
import { INVITE_TEXT } from '@/lib/admin/actions'
import { ACCESS_GRANTED_TEMPLATE_BODY } from '@/lib/bot/handlers/welcome'
import { accessTemplateStatus } from '@/lib/whatsapp'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'
const DAY = 86_400_000

export default async function WaitlistPage() {
  const gate = await requireAdminConsole('viewer')
  const canAct = gate.ok && gate.admin.role !== 'viewer'
  const rows = await waitlistRows()
  const today = istDateKey(new Date())
  const weekAgo = Date.now() - 7 * DAY
  const optins = rows.filter(r => r.whatsapp_opt_in).length
  const srcCount = new Map<string, number>()
  for (const r of rows) { const s = r.source || 'unknown'; srcCount.set(s, (srcCount.get(s) || 0) + 1) }
  const template = await accessTemplateStatus(ACCESS_GRANTED_TEMPLATE_BODY)
  const templateReady = template.status === 'approved'
  return (
    <div className="adm-stack">
      <Head title="Waitlist" lede="New numbers wait here until you approve them. Approve opens the bot and the dashboard to that number and sends the invite. Block turns the number away politely. Signups come from the askgogo.in form and from people who message AskGogo on WhatsApp." />
      <Kpis items={[
        { label: 'Total', value: rows.length },
        { label: 'Today', value: rows.filter(r => istDateKey(r.created_at) === today).length },
        { label: 'Last 7 days', value: rows.filter(r => new Date(r.created_at).getTime() >= weekAgo).length },
        { label: 'WhatsApp opt-in', value: rows.length ? `${Math.round((optins / rows.length) * 100)}%` : '—' },
        { label: 'UAE', value: rows.filter(r => r.country === 'AE').length },
      ]} />
      <div className="adm-cols" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 620px' }}>
          <WaitlistTable canAct={canAct} rows={rows.map(r => ({ id: r.id, phone: r.phone_e164, email: r.email, country: r.country, source: r.source, optin: r.whatsapp_opt_in, created: r.created_at, status: r.status, invite: r.invite_status, name: r.profile_name }))} />
        </div>
        <aside style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <section>
            <h3>Message sent when you approve</h3>
            <div className="card" style={{ whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.6 }}>{INVITE_TEXT}</div>
            <p className="note">{templateReady ? 'WhatsApp template approved: everyone you approve gets a short "your access is active" message, and the full welcome above when they reply Hi.' : `WhatsApp template: ${template.status === 'error' ? 'could not be checked' : template.status === 'rejected' ? 'rejected by Meta' : 'waiting for Meta approval'}. Until it is approved this full welcome goes as text, which WhatsApp delivers only to numbers that messaged AskGogo in the last 24 hours. Approved numbers get in the moment they message, either way.`}</p>
          </section>
          <section>
            <h3>Where signups come from</h3>
            <BarList labelWidth={110} rows={[...srcCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => ({ label: s, value: n, display: n }))} />
          </section>
        </aside>
      </div>
    </div>
  )
}
