import { getSession } from '@/lib/dashboard/session'
import { getWorkspaceDetail, listMyWorkspaces, UUID_RE, WorkspaceError, type MyWorkspace, type WorkspaceDetail } from '@/lib/workspaces/access'
import { BusinessWorkspace, CreateWorkspaceForm } from './business-client'

export const dynamic = 'force-dynamic'

type Loaded =
  | { state: 'setup' }
  | { state: 'error' }
  | { state: 'ok'; workspaces: MyWorkspace[]; detail: WorkspaceDetail | null }

async function load(telegramId: string, wanted: string | undefined): Promise<Loaded> {
  try {
    const workspaces = await listMyWorkspaces(telegramId)
    const pick = workspaces.find(w => w.id === wanted) || workspaces[0]
    const detail = pick && UUID_RE.test(pick.id) ? await getWorkspaceDetail(telegramId, pick.id) : null
    return { state: 'ok', workspaces, detail }
  } catch (err) {
    if (err instanceof WorkspaceError && err.code === 'workspaces_not_enabled') return { state: 'setup' }
    console.error('BUSINESS_PAGE_FAILED:', String(err instanceof Error ? err.message : err).slice(0, 160))
    return { state: 'error' }
  }
}

// SecondBrain for Business — pilot workspace (approved 23 Oct mock). Read-only pilot: a workspace shows only
// what members explicitly shared into it. Nothing here reads anyone's personal data.
export default async function BusinessPage({ searchParams }: { searchParams?: Promise<{ ws?: string }> } = {}) {
  const session = await getSession()
  const wanted = (await searchParams)?.ws
  const loaded = await load(String(session?.telegramId || ''), wanted)
  return (
    <div className="mx-auto w-full max-w-[1000px] pb-10">
      {loaded.state === 'setup' && <Header />}
      {loaded.state === 'setup' && <section className="rounded-[16px] border border-[#222] bg-[#121212] p-5">
        <h2 className="text-[17px] font-semibold text-[#f2efea]">SecondBrain is being set up</h2>
        <p className="mt-2 text-[15px] leading-[1.5] text-[#a8a8a4]">Team workspaces are not switched on for this account yet. Your personal Gogo is unaffected.</p>
      </section>}
      {loaded.state === 'error' && <Header />}
      {loaded.state === 'error' && <p className="py-5 text-[15px] text-[#d9a441]">Couldn’t load your workspaces right now. Try again shortly.</p>}
      {loaded.state === 'ok' && !loaded.detail && <>
        <Header />
        <section className="rounded-[16px] border border-[#222] bg-[#121212] p-5">
          <h2 className="text-[17px] font-semibold text-[#f2efea]">Start a team workspace</h2>
          <p className="mt-2 text-[15px] leading-[1.5] text-[#a8a8a4]">A workspace holds only what members choose to share into it, like a report Gogo made. Nothing here reads anyone’s personal data.</p>
          <CreateWorkspaceForm />
        </section>
      </>}
      {loaded.state === 'ok' && loaded.detail && <BusinessWorkspace workspaces={loaded.workspaces} detail={loaded.detail} />}
    </div>
  )
}

function Header() {
  return <header className="pb-4 lg:pt-4">
    <div className="final-dark-eyebrow">For your team</div>
    <h1 className="final-dark-title mt-1.5 text-[28px] sm:text-[32px]">SecondBrain</h1>
  </header>
}
