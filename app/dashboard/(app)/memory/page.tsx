import { getSession } from '@/lib/dashboard/session'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { MemoryCollection } from '@/components/dashboard/memory-collection'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic='force-dynamic'

export default async function MemoryPage(){
  const session=await getSession()
  const memory=session?await getDashboardMemory(session.telegramId):({ok:false} as const)

  return <div className="mx-auto w-full max-w-[1100px] pb-10">
    <header className="border-b border-[#1f1f1f] pb-5">
      <div className="final-dark-eyebrow">What Gogo knows</div>
      <h1 className="final-dark-title mt-2 text-[34px]">Memory</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#9a9a9a]">What Gogo remembers about you. Edit or forget anything.</p>
    </header>

    {!memory.ok?<div className="mt-5"><CardError message="Couldn’t load your memory right now."/></div>:<>
      <section className="mt-5 grid gap-2 sm:grid-cols-3">
        <div className="final-dark-card p-4"><div className="text-[23px] font-semibold text-[#f2efea]">{memory.items.length}</div><div className="mt-1 text-[10px] uppercase tracking-[.08em] text-[#6a6a6a]">Memories</div></div>
        <div className="final-dark-card p-4"><div className="text-[23px] font-semibold text-[#d9a441]">{memory.items.filter(x=>x.sensitive).length}</div><div className="mt-1 text-[10px] uppercase tracking-[.08em] text-[#6a6a6a]">Private</div></div>
        <div className="final-dark-card p-4"><div className="text-[23px] font-semibold text-[#2fb8a6]">{memory.items.filter(x=>x.openUrl).length}</div><div className="mt-1 text-[10px] uppercase tracking-[.08em] text-[#6a6a6a]">Linked files</div></div>
      </section>
      <section className="mt-5 final-dark-panel p-3 sm:p-4"><MemoryCollection items={memory.items}/></section>
    </>}
  </div>
}
