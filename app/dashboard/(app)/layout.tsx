import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { getShellData } from '@/lib/dashboard/shell-data'
import { SideRail } from '@/components/dashboard/side-rail'
import { MobileNavProvider, MobileTopBar } from '@/components/dashboard/mobile-nav'
import { GogoLiveProvider } from '@/components/dashboard/gogo-live'
import { DesktopTopBar, GogoPanel } from '@/components/dashboard/gogo-panel'
import { BottomTabs } from '@/components/dashboard/bottom-tabs'
import { CompanionProvider } from '@/components/gogo/companion'
import { crewEnabledFor } from '@/lib/gogo/crew'
import { loadCompanionChoice } from '@/lib/dashboard/companion-choice'

export const dynamic = 'force-dynamic'

// Approved 22 Oct Duet-parity mock (Claude Duet + Wajo). Desktop: a short side rail (Chat · Tasks · Make, then
// Channels), the page, and the Gogo panel. Phone: Chat · Tasks · Make as bottom tabs; other places stay in the menu.
export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const session=await getSession()
  if(!session)redirect('/dashboard')
  const base=await getShellData(session.telegramId).catch(()=>({name:'',plan:null,meters:[],setup:[]}))
  const live=await import('@/lib/spaces/sources-live')
  const shell={...base,spaces:live.spacesEnabledFor(String(session.telegramId)),navV2:live.navV2EnabledFor(String(session.telegramId)),events:(await import('@/lib/events/core')).eventsEnabledFor(String(session.telegramId))}

  // 12 Nov: the Gogo crew (characters whose eyes follow the pointer), owner-only behind GOGO_CREW.
  const crew=crewEnabledFor(String(session.telegramId))
  const companion=crew?await loadCompanionChoice(session.telegramId).catch(()=>null):null

  return (
    <CompanionProvider choice={companion} crew={crew}>
    <GogoLiveProvider>
      <MobileNavProvider shell={shell}>
        <div className="dashboard-shell flex min-h-screen w-full flex-1 overflow-hidden bg-[#0b0b0b] text-[#ecebe8]">
          <SideRail shell={shell} />
          <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-[calc(76px+env(safe-area-inset-bottom))] pt-[calc(.5rem+env(safe-area-inset-top))] sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-8 lg:pb-10 lg:pt-4 xl:px-12">
            <MobileTopBar />
            <DesktopTopBar />
            {children}
          </main>
          <GogoPanel />
          <BottomTabs />
        </div>
      </MobileNavProvider>
    </GogoLiveProvider>
    </CompanionProvider>
  )
}
