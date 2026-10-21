import { redirect } from 'next/navigation'
import { requireAdminConsole } from '@/lib/admin/console-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AdminNav } from '@/components/admin/admin-nav'
import { LockButton } from '@/components/admin/admin-client'

export const dynamic = 'force-dynamic'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const gate = await requireAdminConsole('viewer')
  if (!gate.ok) redirect(gate.step === 'signin' ? '/dashboard' : gate.step === 'not_admin' ? '/dashboard/home' : '/admin/unlock')
  const { count } = await supabaseAdmin.from('waitlist').select('id', { count: 'exact', head: true }).eq('status', 'waiting')
  const roleLabel = gate.admin.role === 'owner' ? 'Owner' : gate.admin.role === 'operator' ? 'Operator' : 'Viewer'
  return (
    <div className="adm">
      <aside className="adm-rail">
        <div className="adm-brand">AskGogo<span>.</span> <small>admin</small></div>
        <AdminNav waiting={count || 0} />
        <div className="adm-who">{gate.admin.name} · {roleLabel}<br />Console locks after 12 hours<br /><div style={{ marginTop: 8 }}><LockButton /></div></div>
      </aside>
      <main className="adm-main">{children}</main>
    </div>
  )
}
