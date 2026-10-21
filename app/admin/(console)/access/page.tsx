import { Head, Pill } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/admin-client'
import { AddAdminForm, PasswordForm } from '@/components/admin/access-forms'
import { adminMembers, auditRows, userRows, when, ago } from '@/lib/admin/console-data'
import { requireAdminConsole, e164 } from '@/lib/admin/console-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const ROLES: [string, string, string, string][] = [
  ['See overview, tasks, health, architecture', 'Yes', 'Yes', 'Yes'], ['See costs and the Tools and APIs bills', 'Yes', 'Yes', 'Yes'],
  ['Approve or block the waitlist and users', 'No', 'Yes', 'Yes'], ['Change plans, cancel tasks, run jobs', 'No', 'Yes', 'Yes'],
  ['Add invoices, edit the rate card', 'No', 'No', 'Yes'], ['Add or remove admins, change the password', 'No', 'No', 'Yes'],
]
const TONE: Record<string, 'ok' | 'bad' | 'warn' | 'n'> = { Approved: 'ok', 'Signed in': 'n', Blocked: 'bad', 'Blocked user': 'bad', 'Wrong password': 'warn', 'Locked out': 'bad' }

export default async function AccessPage() {
  const gate = await requireAdminConsole('viewer')
  const isOwner = gate.ok && gate.admin.role === 'owner'
  const [members, log, users, attempts] = await Promise.all([adminMembers(), auditRows(200), userRows(), supabaseAdmin.from('admin_login_attempts').select('actor_phone, ok, created_at').eq('ok', true).order('created_at', { ascending: false }).limit(200)])
  const names = new Map(users.map(u => [e164(u.whatsapp_id), u.name]))
  const lastIn = new Map<string, string>(); for (const a of ((attempts as any).data || []) as any[]) if (!lastIn.has(a.actor_phone)) lastIn.set(a.actor_phone, a.created_at)
  const owners = (process.env.ADMIN_WHATSAPP_NUMBERS || process.env.ADMIN_WHATSAPP_NUMBER || '').split(',').map(e164).filter(Boolean)
  const envPassword = !!process.env.ADMIN_CONSOLE_PASSWORD_HASH
  return (
    <div className="adm-stack">
      <Head title="Access and audit" lede="Who can open this console and a record of everything done here. Getting in takes two steps: sign in to the dashboard with an admin number, then enter the admin password." />
      <section>
        <h2>Admins</h2>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">Name</th><th scope="col">Number</th><th scope="col">Role</th><th scope="col">Last in</th><th scope="col">Status</th>{isOwner ? <th scope="col"><span className="sr">Actions</span></th> : null}</tr></thead>
            <tbody>
              {owners.map(p => <tr key={p}><td style={{ fontWeight: 500 }}>{names.get(p) || 'Owner'}</td><td style={{ color: 'var(--ink2)' }}>{p}</td><td>Owner</td><td style={{ color: 'var(--ink3)' }}>{ago(lastIn.get(p))}</td><td><Pill tone="ok">Active</Pill></td>{isOwner ? <td style={{ color: 'var(--ink3)', fontSize: 13 }}>Set in Vercel</td> : null}</tr>)}
              {members.map((m: any) => <tr key={m.phone_e164}><td style={{ fontWeight: 500 }}>{m.name}</td><td style={{ color: 'var(--ink2)' }}>{m.phone_e164}</td><td style={{ textTransform: 'capitalize' }}>{m.role}</td><td style={{ color: 'var(--ink3)' }}>{ago(lastIn.get(m.phone_e164))}</td><td>{m.active ? <Pill tone="ok">Active</Pill> : <Pill>Removed</Pill>}</td>
                {isOwner ? <td>{m.active ? <ActionButton action="admin.remove" body={{ phone: m.phone_e164 }} label="Remove" confirm="Remove this admin?" /> : <ActionButton action="admin.restore" body={{ phone: m.phone_e164 }} label="Restore" />}</td> : null}</tr>)}
            </tbody>
          </table>
        </div>
        {isOwner ? <div style={{ marginTop: 16 }}><AddAdminForm /></div> : null}
      </section>
      <div className="adm-cols">
        <section>
          <h2>What each role can do</h2>
          <div className="adm-table"><table>
            <thead><tr><th scope="col">Can</th><th scope="col">Viewer</th><th scope="col">Operator</th><th scope="col">Owner</th></tr></thead>
            <tbody>{ROLES.map(r => <tr key={r[0]}><td className="wrap">{r[0]}</td><td style={{ color: 'var(--ink2)' }}>{r[1]}</td><td style={{ color: 'var(--ink2)' }}>{r[2]}</td><td style={{ color: 'var(--ink2)' }}>{r[3]}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section>
          <h2>Password and sessions</h2>
          <div className="adm-list">
            <div className="adm-row"><span className="grow">Step 1</span><span className="muted">Dashboard sign-in with an admin number</span></div>
            <div className="adm-row"><span className="grow">Step 2</span><span className="muted">Admin password, stored only as a hash</span></div>
            <div className="adm-row"><span className="grow">Stays unlocked</span><span className="muted">12 hours per device</span></div>
            <div className="adm-row"><span className="grow">Wrong password</span><span className="muted">15-minute lock after 5 tries</span></div>
          </div>
          {isOwner ? <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {envPassword ? <p className="note">The password is set in Vercel (ADMIN_CONSOLE_PASSWORD_HASH), so change it there.</p> : <PasswordForm />}
            <ActionButton action="sessions.revoke" label="Sign out every admin" className="btn lg danger" confirm="Every admin, including you, must sign in again." />
          </div> : null}
        </section>
      </div>
      <section>
        <h2>Audit log</h2>
        <div className="adm-table">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">On</th></tr></thead>
            <tbody>
              {log.map((l: any) => <tr key={l.id}><td style={{ color: 'var(--ink3)' }}>{when(l.created_at)}</td><td style={{ fontWeight: 500 }}>{l.actor_name || l.actor_phone || '—'}</td><td><Pill tone={TONE[l.action] || 'n'}>{l.action}</Pill></td><td className="wrap">{l.target || '—'}</td></tr>)}
              {!log.length ? <tr><td colSpan={4} style={{ color: 'var(--ink3)' }}>Nothing logged yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="note">The console can't edit or delete the log.</p>
      </section>
    </div>
  )
}
