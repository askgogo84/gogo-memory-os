import { getSession } from '@/lib/dashboard/session'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { MemoryCollection } from '@/components/dashboard/memory-collection'
import { CardError } from '@/components/dashboard/card-error'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'

export const dynamic = 'force-dynamic'

export default async function MemoryPage() {
  const session = await getSession()
  const memory = session ? await getDashboardMemory(session.telegramId) : ({ ok: false } as const)

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gogo-orange">Your second brain</p>
          <h1 className="mt-1 font-serif text-[30px] font-semibold tracking-[-0.7px] text-gogo-ink lg:text-[36px]">Memory</h1>
          <p className="mt-1 max-w-xl text-[13.5px] leading-6 text-gogo-ink-3">Everything AskGogo has safely saved for you — searchable, organised, and ready when you need it.</p>
        </div>
        <WhatsAppChip message="Gogo, save this for me" label="Save something" />
      </header>

      {!memory.ok ? (
        <CardError message="Couldn’t load your memory right now." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:max-w-[520px] sm:gap-3">
            <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-3 py-3.5">
              <div className="font-serif text-[24px] font-semibold text-gogo-ink">{memory.items.length}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-gogo-ink-3">Saved items</div>
            </div>
            <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-3 py-3.5">
              <div className="font-serif text-[24px] font-semibold text-gogo-plum">{memory.items.filter((x) => x.sensitive).length}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-gogo-ink-3">Private</div>
            </div>
            <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-3 py-3.5">
              <div className="font-serif text-[24px] font-semibold text-gogo-orange">{memory.items.filter((x) => x.openUrl).length}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-gogo-ink-3">Original files</div>
            </div>
          </div>

          <MemoryCollection items={memory.items} />
        </>
      )}
    </div>
  )
}
