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
    <div className="w-full">
      <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gogo-plum/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your second brain</p>
            <h1 className="mt-1 font-serif text-[38px] font-semibold tracking-[-0.9px] text-gogo-ink">Memory</h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-gogo-ink-3">Everything AskGogo has safely saved for you — searchable, organised and ready when you need it.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <WhatsAppChip message="Gogo, what did I save recently?" label="Ask about memory" />
            <WhatsAppChip message="Gogo, save this for me" label="Save something" />
          </div>
        </div>
      </header>

      {!memory.ok ? (
        <div className="mt-5"><CardError message="Couldn’t load your memory right now." /></div>
      ) : (
        <>
          <section className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/75 px-5 py-4 shadow-[0_12px_34px_rgba(62,35,18,0.035)] backdrop-blur-xl">
              <div className="font-serif text-[30px] font-semibold text-gogo-ink">{memory.items.length}</div>
              <div className="mt-1 text-[11.5px] font-medium text-gogo-ink-3">Saved items</div>
            </div>
            <div className="rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/75 px-5 py-4 shadow-[0_12px_34px_rgba(62,35,18,0.035)] backdrop-blur-xl">
              <div className="font-serif text-[30px] font-semibold text-gogo-plum">{memory.items.filter((x) => x.sensitive).length}</div>
              <div className="mt-1 text-[11.5px] font-medium text-gogo-ink-3">Private items</div>
            </div>
            <div className="rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/75 px-5 py-4 shadow-[0_12px_34px_rgba(62,35,18,0.035)] backdrop-blur-xl">
              <div className="font-serif text-[30px] font-semibold text-gogo-orange">{memory.items.filter((x) => x.openUrl).length}</div>
              <div className="mt-1 text-[11.5px] font-medium text-gogo-ink-3">Original files</div>
            </div>
          </section>

          <section className="mt-4 rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/48 p-4 shadow-[0_18px_50px_rgba(62,35,18,0.035)] backdrop-blur-xl lg:p-5">
            <MemoryCollection items={memory.items} />
          </section>
        </>
      )}
    </div>
  )
}
