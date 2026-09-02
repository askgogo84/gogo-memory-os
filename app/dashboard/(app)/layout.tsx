import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { TabBar } from '@/components/dashboard/tab-bar'
import { SideRail } from '@/components/dashboard/side-rail'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'
import { BreathingSpace } from '@/components/dashboard/breathing-space'

export const dynamic = 'force-dynamic'

export default async function DashboardShell({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/dashboard')

  return (
    <div className="dashboard-shell relative mx-auto flex min-h-screen w-full max-w-[480px] flex-1 flex-col overflow-hidden bg-gogo-cream font-sans text-gogo-ink lg:max-w-none lg:flex-row">
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="absolute -left-32 top-[-10rem] h-[34rem] w-[34rem] rounded-full bg-gogo-orange/8 blur-[100px]" />
        <div className="absolute right-[-10rem] top-[10%] h-[30rem] w-[30rem] rounded-full bg-gogo-plum/9 blur-[110px]" />
        <div className="absolute bottom-[-13rem] left-[36%] h-[28rem] w-[28rem] rounded-full bg-emerald-400/6 blur-[110px]" />
      </div>
      <SideRail />
      <BreathingSpace />
      <div className="fixed right-20 top-4 z-30 lg:hidden">
        <ThemeToggle />
      </div>
      <main className="relative z-10 min-w-0 flex-1 px-5 pb-24 pt-6 lg:px-9 lg:pb-12 lg:pt-8 xl:px-12 2xl:px-16">{children}</main>
      <TabBar />
    </div>
  )
}
