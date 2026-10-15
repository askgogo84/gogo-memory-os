import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { SideRail } from '@/components/dashboard/side-rail'
import { MobileNavProvider, MobileTopBar } from '@/components/dashboard/mobile-nav'

export const dynamic = 'force-dynamic'

// Desktop: a collapsible side rail. Phone: no bottom tab bar; a menu button opens the same list in a drawer,
// so every page gets the whole screen.
export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const session=await getSession()
  if(!session)redirect('/dashboard')

  return (
    <MobileNavProvider>
      <div className="dashboard-shell flex min-h-screen w-full flex-1 overflow-hidden bg-[#0b0b0b] text-[#ecebe8]">
        <SideRail />
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(.5rem+env(safe-area-inset-top))] sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-8 lg:pb-10 lg:pt-7 xl:px-10">
          <MobileTopBar />
          {children}
        </main>
      </div>
    </MobileNavProvider>
  )
}
