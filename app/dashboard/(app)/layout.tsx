import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { TabBar } from '@/components/dashboard/tab-bar'
import { SideRail } from '@/components/dashboard/side-rail'

export const dynamic = 'force-dynamic'

export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const session=await getSession()
  if(!session)redirect('/dashboard')

  return (
    <div className="dashboard-shell flex min-h-screen w-full flex-1 overflow-hidden bg-[#0b0b0b] text-[#f2efea]">
      <SideRail />
      <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-24 pt-5 sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-8 lg:pb-10 lg:pt-7 xl:px-10">
        {children}
      </main>
      <TabBar />
    </div>
  )
}
