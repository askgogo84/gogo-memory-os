import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { TabBar } from '@/components/dashboard/tab-bar'
import { SideRail } from '@/components/dashboard/side-rail'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'

export const dynamic = 'force-dynamic'

export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/dashboard')

  return (
    <div className="dashboard-shell flex min-h-full w-full flex-1 flex-col bg-gogo-cream font-sans text-gogo-ink lg:min-h-screen lg:flex-row">
      <SideRail />
      <div className="fixed right-4 top-4 z-30 lg:hidden">
        <ThemeToggle />
      </div>
      <main className="min-w-0 flex-1 px-5 pb-24 pt-6 lg:px-7 lg:pb-8 lg:pt-6 xl:px-9 2xl:px-10">{children}</main>
      <TabBar />
    </div>
  )
}
