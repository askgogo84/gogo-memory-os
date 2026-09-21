import { redirect } from 'next/navigation'
import { requireAdminSession } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminSession()
  if (!admin.ok) {
    redirect(admin.status === 401 ? '/dashboard' : '/dashboard/home')
  }

  return (
    <div style={{
      colorScheme: 'light',
      backgroundColor: '#f8fafc',
      color: '#0f172a',
      minHeight: '100vh',
    }}>
      <style>{`
        * { color-scheme: light !important; }
        input, select, textarea {
          color: #0f172a !important;
          background-color: #ffffff !important;
          -webkit-text-fill-color: #0f172a !important;
        }
        input::placeholder { color: #94a3b8 !important; -webkit-text-fill-color: #94a3b8 !important; }
        option { color: #0f172a !important; background-color: #ffffff !important; }
      `}</style>
      {children}
    </div>
  )
}
