// Zero-import core for the lists CAS logic (Phase 6). Split out of lib/data/lists.ts
// exactly the way meter-core.ts is split from meter.ts: NO imports, so Node's native
// TypeScript type-stripping can load it directly under `node --test`, and the Supabase
// client is INJECTED (as `db`) rather than imported. Tests pass a fake db; the real
// wrapper in lists.ts passes supabaseAdmin. See lists-core.test.mjs.

export interface ListItem {
  text: string
  done: boolean
  added_at: string
}

// Max optimistic-concurrency attempts: 1 initial + 2 retries, per the Phase 6 sign-off.
export const CAS_MAX_ATTEMPTS = 3

export class ListWriteConflictError extends Error {
  constructor(message = 'list_write_conflict') {
    super(message)
    this.name = 'ListWriteConflictError'
  }
}

// The shared compare-and-swap core. Items live as a JSONB array on the lists row —
// there is no per-item table — so every mutation is a read-modify-write of the whole
// array, which is NOT atomic in Postgres: two writers can both read the same array and
// the second write clobbers the first (a lost update). We re-read the row's items +
// updated_at, apply `mutate`, and write GATED on the exact updated_at just read. 0 rows
// affected ⇒ someone wrote in between ⇒ re-read and retry, up to CAS_MAX_ATTEMPTS, then
// throw ListWriteConflictError. `mutate` returns the next items array, or null to abort
// with NO write (a genuine no-op — e.g. the target item wasn't found).
//
// `db` is a Supabase-shaped client (real or fake). The two chains it must support:
//   read:  db.from('lists').select('items, updated_at').eq('id', id).single()
//   write: db.from('lists').update({...}).eq('id', id).eq|is('updated_at', tok).select('id')
export async function mutateListItems(
  db: any,
  listId: number | string,
  mutate: (items: ListItem[]) => ListItem[] | null,
): Promise<ListItem[]> {
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const { data: row, error: readErr } = await db
      .from('lists')
      .select('items, updated_at')
      .eq('id', listId)
      .single()
    if (readErr || !row) throw readErr ?? new Error('list_not_found')

    const current = (row.items as ListItem[]) ?? []
    const next = mutate(current)
    if (next === null) return current // nothing to write

    let q = db
      .from('lists')
      .update({ items: next, updated_at: new Date().toISOString() })
      .eq('id', listId)
    // CAS gate on the token we just read. Legacy rows can carry a null updated_at;
    // `.is` handles that — an `.eq(null)` would never match and would spin to a false
    // conflict.
    q = row.updated_at === null ? q.is('updated_at', null) : q.eq('updated_at', row.updated_at)

    const { data: updated, error: writeErr } = await q.select('id')
    if (writeErr) throw writeErr
    if (updated && updated.length > 0) return next // won the race
    // else 0 rows → lost the race → loop and retry from a fresh read
  }
  throw new ListWriteConflictError()
}
