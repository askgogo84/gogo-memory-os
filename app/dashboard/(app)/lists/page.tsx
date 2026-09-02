import { getSession } from '@/lib/dashboard/session'
import { getLists } from '@/lib/dashboard/queries'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { ListCollection } from '@/components/dashboard/list-collection'
import { ListCreate } from '@/components/dashboard/list-create'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

export default async function ListsPage() {
  const session = await getSession()
  const result = session ? await getLists(session.telegramId) : { ok: true as const, lists: [] }

  const lists = result.ok ? result.lists : []
  const openItems = lists.reduce((n, l) => n + l.items.filter((i) => !i.done).length, 0)
  const totalItems = lists.reduce((n, l) => n + l.items.length, 0)
  const completed = totalItems - openItems
  const hasLists = result.ok && lists.length > 0

  return (
    <div className="w-full">
      <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/75 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-16 -top-28 h-72 w-72 rounded-full bg-gogo-orange/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-plum">Your collections</p>
            <h1 className="mt-1 font-serif text-[36px] font-semibold tracking-[-0.8px] text-gogo-ink">Lists</h1>
            <p className="mt-2 text-[13px] text-gogo-ink-3">
              {hasLists ? `${lists.length} lists · ${openItems} open items · ${completed} completed` : 'Keep the small things out of your head.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WhatsAppChip message="Gogo, start a new list" label="Start in WhatsApp" />
            <ListCreate />
          </div>
        </div>

        {hasLists && (
          <div className="relative mt-5 grid max-w-[620px] grid-cols-3 gap-2">
            <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Lists</div><div className="mt-1 font-serif text-[23px] font-semibold text-gogo-ink">{lists.length}</div></div>
            <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Open</div><div className="mt-1 font-serif text-[23px] font-semibold text-gogo-orange">{openItems}</div></div>
            <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Done</div><div className="mt-1 font-serif text-[23px] font-semibold text-emerald-700">{completed}</div></div>
          </div>
        )}
      </header>

      <div className="mt-5">
        {!result.ok ? (
          <CardError message="Couldn’t load your lists right now." />
        ) : result.lists.length === 0 ? (
          <EmptyState
            message="No lists yet."
            detail="Add items in WhatsApp; they show up here."
            action={<WhatsAppChip message="Gogo, add milk to my groceries" />}
          />
        ) : (
          <ListCollection lists={result.lists} />
        )}
      </div>
    </div>
  )
}
