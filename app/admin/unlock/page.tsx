import { redirect } from 'next/navigation'
import { adminIdentity, requireAdminConsole, storedPasswordHash } from '@/lib/admin/console-auth'
import { UnlockForm } from '@/components/admin/unlock-form'

export const dynamic = 'force-dynamic'

function mask(p: string) { return p.length > 8 ? p.slice(0, p.startsWith('+971') ? 7 : 9) + ' •• ' + p.slice(-3) : p }

export default async function UnlockPage() {
  const gate = await requireAdminConsole('viewer')
  if (gate.ok) redirect('/admin')
  const admin = await adminIdentity()
  if (!admin) redirect('/dashboard')
  const hasPassword = !!(await storedPasswordHash())
  return (
    <div className="adm" style={{ alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="adm-brand" style={{ padding: 0 }}>AskGogo<span>.</span> <small>admin</small></div>
        <UnlockForm mode={hasPassword ? 'unlock' : admin.role === 'owner' ? 'setup' : 'wait'} who={mask(admin.phone)} />
        <p className="note" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>Every sign-in, wrong password and lock is written to the audit log.</p>
      </div>
    </div>
  )
}
