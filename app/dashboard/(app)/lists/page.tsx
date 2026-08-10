import { getSession } from '@/lib/dashboard/session'
import { getLists } from '@/lib/dashboard/queries'
import { EmptyState } from '@/components/dashboard/empty-state'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { ListCollection } from '@/components/dashboard/list-collection'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

// The Lists surface: every list the signed-in user owns, each expanding inline.
// Identity is resolved ONLY from the session's telegram_id, never a URL; all
// reads go through lib/dashboard/queries.ts. Server component — it reads and
// renders; the inline-expand interaction lives in <ListCollection>. Read-only:
// ticking items and creating lists arrive in a later phase.

export default async function ListsPage() {
  const session = await getSession()
  // The (app) layout guarantees a session; guard anyway so a missing one reads
  // as an empty account, never a crash.
  const result = session ? await getLists(session.telegramId) : { ok: true as const, lists: [] }

  // Header count line, derived from items already in hand (open = not done) — no
  // extra query. Only shown when there's something to summarise.
  const lists = result.ok ? result.lists : []
  const openItems = lists.reduce((n, l) => n + l.items.filter((i) => !i.done).length, 0)
  const hasLists = result.ok && lists.length > 0

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-serif text-[25px] font-semibold tracking-[-0.4px] text-gogo-ink">Lists</h1>
        {hasLists && (
          <p className="mt-1 text-[13px] font-medium text-gogo-ink-3">
            {lists.length} {lists.length === 1 ? 'list' : 'lists'} · {openItems} open{' '}
            {openItems === 1 ? 'item' : 'items'}
          </p>
        )}
      </header>

      {!result.ok ? (
        // A read failure is not an empty account — show a retry, never a blank.
        <CardError message="Couldn’t load your lists right now." />
      ) : result.lists.length === 0 ? (
        <EmptyState
          message="No lists yet."
          detail="Add items in WhatsApp; they show up here."
          action={<WhatsAppChip message="Gogo, add milk to my groceries" />}
        />
      ) : (
        // The add-affordance now lives contextually inside each expanded list
        // (mockup 1d), so there's no separate bottom chip here.
        <ListCollection lists={result.lists} />
      )}
    </div>
  )
}
