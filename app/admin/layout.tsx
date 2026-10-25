import { redirect } from 'next/navigation'
import { requireAdminSession } from '@/lib/admin/auth'
import { adminIdentity } from '@/lib/admin/console-auth'
import { ADMIN_CSS } from '@/components/admin/admin-css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AskGogo admin', robots: { index: false, follow: false } }

// Step 1 of 2: only a signed-in admin number (or an active admin member) gets past here.
// Step 2 (the admin password) is enforced by app/admin/(console)/layout.tsx and every console API.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const legacy = await requireAdminSession()
  if (!legacy.ok) {
    const member = legacy.status === 403 ? await adminIdentity() : null
    if (!member) redirect(legacy.status === 401 ? '/dashboard' : '/dashboard/home')
  }
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap" />
      <style>{ADMIN_CSS}</style>
      {children}
    </>
  )
}
