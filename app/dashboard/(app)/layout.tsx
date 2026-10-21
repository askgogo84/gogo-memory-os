import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { getShellData } from '@/lib/dashboard/shell-data'
import { SideRail } from '@/components/dashboard/side-rail'
import { MobileNavProvider, MobileTabBar, MobileTabSpacer, MobileTopBar } from '@/components/dashboard/mobile-nav'
import { GogoLiveProvider } from '@/components/dashboard/gogo-live'
import { GogoPanel } from '@/components/dashboard/gogo-panel'

export const dynamic = 'force-dynamic'

// Approved 21 Oct mock (Muse + Wajo). Desktop: a short side rail (Home · Tasks · Memory, Recent, Getting started,
// usage, Settings), the page, and a Muse-style right panel showing what Gogo is doing with its own character per
// action. Phone: slim top bar with a live Gogo pill, bottom tabs, and the same panel as a bottom sheet.
export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const session=await getSession()
  if(!session)redirect('/dashboard')
  const shell=await getShellData(session.telegramId).catch(()=>({name:'',plan:null,meters:[],setup:[]}))

  return (
    <GogoLiveProvider>
      <MobileNavProvider shell={shell}>
        <div className="dashboard-shell flex min-h-screen w-full flex-1 overflow-hidden bg-[#0b0b0b] text-[#ecebe8]">
          <SideRail shell={shell} />
          <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(.5rem+env(safe-area-inset-top))] sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-8 lg:pb-10 lg:pt-7 xl:px-10">
            <MobileTopBar />
            {children}
            <MobileTabSpacer />
          </main>
          <GogoPanel />
        </div>
        <MobileTabBar />
      </MobileNavProvider>
    </GogoLiveProvider>
  )
}
