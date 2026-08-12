import { supabaseAdmin } from './supabase-admin'
import {
  mutateListItems as mutateItemsCore,
  ListWriteConflictError,
  normalizeListName,
  normItemText,
  applyAdd,
  applySetDone,
  findPendingExactMatches,
  DEDUPE_EXEMPT_BUCKETS,
  type ListItem,
} from './lists-core'

// The CAS core and ListItem now live in the zero-import lists-core.ts so they can be
// unit-tested with an injected fake db (the meter-core pattern). Re-export the type so
// existing consumers importing it from '@/lib/data/lists' keep working, and provide a
// thin wrapper that injects the real supabaseAdmin as the client.
export type { ListItem } from './lists-core'
export { ListWriteConflictError, normalizeListName } from './lists-core'

// Route every list write through the CAS core with the real client. Per the Phase 6
// sign-off this fixes the CLASS — checkItem, addToList, removeDone AND the dashboard
// tick all go through here — so the bot can't clobber a dashboard write either, not
// just the reverse.
function mutateListItems(
  listId: number | string,
  mutate: (items: ListItem[]) => ListItem[] | null,
): Promise<ListItem[]> {
  return mutateItemsCore(supabaseAdmin, listId, mutate)
}

export type AddToListResult = {
  items: ListItem[]
  added: string[]
  alreadyPending: string[]
  reactivated: string[]
}

// Dedupe-on-add (see applyAdd). Returns what happened per item so callers can say
// "already there" rather than silently stacking a duplicate. addToList() is the thin
// items-only wrapper kept for the machine-generated callers (reels, tickets, notes…)
// that only want the array back.
export async function addToListDetailed(
  telegramId: number,
  listName: string,
  items: string[],
): Promise<AddToListResult> {
  const name = normalizeListName(listName)
  // notes / meeting_notes / *_saves hold timestamped artifacts that legitimately repeat a
  // label across days — never dedupe those (see DEDUPE_EXEMPT_BUCKETS). Only user-facing
  // lists (grocery, weekend, todo…) get the "already there" / reactivate treatment.
  const dedupe = !DEDUPE_EXEMPT_BUCKETS.has(name)

  const { data: existing } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('list_name', name)
    .single()

  if (existing) {
    // Dedupe against a FRESH read inside the CAS core, so a concurrent add/tick can't be
    // clobbered by a stale copy. `out` is reassigned each attempt (the callback re-runs
    // on a CAS retry) so it reflects the winning application, never a stale/doubled one.
    let out = { added: [] as string[], alreadyPending: [] as string[], reactivated: [] as string[] }
    const finalItems = await mutateListItems(existing.id, cur => {
      const r = applyAdd(cur, items, new Date().toISOString(), dedupe)
      out = { added: r.added, alreadyPending: r.alreadyPending, reactivated: r.reactivated }
      return r.changed ? r.next : null // all dupes → no write
    })
    return { items: finalItems, ...out }
  } else {
    const r = applyAdd([], items, new Date().toISOString(), dedupe)
    const { data } = await supabaseAdmin
      .from('lists')
      .insert({ telegram_id: telegramId, list_name: name, items: r.next, updated_at: new Date().toISOString() })
      .select()
      .single()
    return { items: (data?.items as ListItem[]) || r.next, added: r.added, alreadyPending: r.alreadyPending, reactivated: r.reactivated }
  }
}

export async function addToList(telegramId: number, listName: string, items: string[]) {
  return (await addToListDetailed(telegramId, listName, items)).items
}

export async function getList(telegramId: number, listName: string) {
  // normalizeListName here is the single choke point that makes EVERY getList call site
  // — checkItem, removeDone, setListItemDone, both SHOW paths, the notes/media buckets —
  // resolve names the same way ADD writes them.
  const canonical = normalizeListName(listName)

  // Fast path: rows written by addToList/createList are already stored canonical (both
  // inserts lowercase-normalise), so an exact .eq hits directly.
  const { data } = await supabaseAdmin
    .from('lists')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('list_name', canonical)
    .single()
  if (data) return data

  // Fallback for LEGACY rows stored in a non-canonical literal form that predates name
  // normalisation ("groceries" plural, "grocery list", "Note", "to do"). The fast .eq
  // above compares a normalised query against a RAW column, so those rows would miss and
  // the list would silently vanish. Here we normalise BOTH sides in-app to reach them.
  // (Does not bridge underscore-vs-space — but no writer ever stored a space, so moot.)
  const all = await getAllLists(telegramId)
  return all.find((l: any) => normalizeListName(l.list_name) === canonical) ?? null
}

export async function getAllLists(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('lists')
    .select('*')
    .eq('telegram_id', telegramId)
    .order('updated_at', { ascending: false })
  return data || []
}

// SET the item's done state by spoken text (exact-first, substring fallback, one row).
// Returns the matched item's stored text + whether the write changed anything, so the
// caller can name what it touched. NO flip — "done milk" twice is a no-op on an
// already-done item. Routes through the CAS core, re-applying against the fresh array.
export async function setItemDoneByText(
  telegramId: number,
  listName: string,
  itemText: string,
  done: boolean,
): Promise<{ items: ListItem[]; matched: string; changed: boolean } | null> {
  const list = await getList(telegramId, listName)
  if (!list) return null
  const current = (list.items as ListItem[]) ?? []
  const probe = applySetDone(current, itemText, done)
  if (probe.matched === null) return null
  if (!probe.changed) return { items: current, matched: probe.matched, changed: false }

  const items = await mutateListItems(list.id, arr => {
    const r = applySetDone(arr, itemText, done)
    return r.changed ? r.next : null
  })
  return { items, matched: probe.matched, changed: true }
}

// Bot list-check kept as a SET-to-done wrapper (was a flip). No other callers, but the
// export stays so nothing that imported it breaks.
export async function checkItem(telegramId: number, listName: string, itemText: string) {
  const r = await setItemDoneByText(telegramId, listName, itemText, true)
  return r ? r.items : null
}

export type ResolveDoneResult =
  | { status: 'set'; listName: string; matched: string }
  | { status: 'noop'; listName: string; matched: string }
  | { status: 'ambiguous'; lists: string[]; itemText: string }
  | { status: 'none'; itemText: string }

// Cross-list resolver for the bare "check/uncheck/tick X" commands that name no list.
// Exact match across all lists first, substring only if nothing matches exactly; among
// hits, prefer the list where the item is actionable (not already in the desired state).
// More than one actionable list → ambiguous (ask, don't guess).
export async function resolveAndSetDoneAcrossLists(
  telegramId: number,
  itemText: string,
  done: boolean,
): Promise<ResolveDoneResult> {
  const lists = await getAllLists(telegramId)
  const q = normItemText(itemText)
  const withItems = lists.map((l: any) => ({ name: l.list_name as string, items: (l.items as ListItem[]) ?? [] }))

  const exact = withItems
    .map(l => ({ l, item: l.items.find(i => normItemText(i.text) === q) }))
    .filter(x => x.item)
  let cand = exact
  if (cand.length === 0) {
    cand = withItems
      .map(l => ({ l, item: l.items.find(i => normItemText(i.text).includes(q)) }))
      .filter(x => x.item)
  }
  if (cand.length === 0) return { status: 'none', itemText }

  const actionable = cand.filter(x => x.item!.done !== done)
  const chosen = actionable.length ? actionable : cand
  if (chosen.length > 1) return { status: 'ambiguous', lists: chosen.map(x => x.l.name), itemText }

  const { l, item } = chosen[0]
  if (item!.done === done) return { status: 'noop', listName: l.name, matched: item!.text }
  await setItemDoneByText(telegramId, l.name, item!.text, done)
  return { status: 'set', listName: l.name, matched: item!.text }
}

// For the "done <text>" divert in feature-intents: PENDING + exact only, so it fires
// ONLY when there is a real list item to mark, else the caller falls through to /api/todos.
export async function findPendingExactAcrossLists(telegramId: number, itemText: string) {
  const lists = await getAllLists(telegramId)
  return findPendingExactMatches(
    lists.map((l: any) => ({ list_name: l.list_name as string, items: (l.items as ListItem[]) ?? [] })),
    itemText,
  )
}

export async function clearList(telegramId: number, listName: string) {
  // Resolve via getList (fast .eq + legacy both-sides-normalised fallback) and delete by
  // id, so a legacy non-canonical row ("groceries", "Grocery") is cleared too rather than
  // silently surviving a name-keyed delete.
  const list = await getList(telegramId, listName)
  if (!list) return
  await supabaseAdmin
    .from('lists')
    .delete()
    .eq('id', list.id)
}

export async function removeDone(telegramId: number, listName: string) {
  const list = await getList(telegramId, listName)
  if (!list) return null
  return await mutateListItems(list.id, items => items.filter(i => !i.done))
}

// ── Dashboard write surface (Phase 6) ─────────────────────────────────────────

export type CreateListResult =
  | { ok: true; list: { id: number | string; name: string; items: ListItem[] } }
  | { ok: false; reason: 'exists' | 'error' }

// Dashboard "New list". Deliberately NOT addToList: addToList appends to an existing
// list (right for the bot's "add milk to groceries"), but a Create button must REFUSE
// a name that already exists rather than silently merge into it — returning
// reason:'exists' so the UI can say so. Creates an empty list; items arrive later via
// the bot or the tick UI. (Residual TOCTOU: two simultaneous creates of the same new
// name could both pass the existence check — acceptable at single-user concurrency; a
// unique (telegram_id, list_name) index would harden it.)
export async function createList(telegramId: number, listName: string): Promise<CreateListResult> {
  const name = normalizeListName(listName)
  if (!name || name === 'list') return { ok: false, reason: 'error' }

  const { data: existing, error: readErr } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('list_name', name)
    .maybeSingle()
  if (readErr) return { ok: false, reason: 'error' }
  if (existing) return { ok: false, reason: 'exists' }

  const { data, error } = await supabaseAdmin
    .from('lists')
    .insert({ telegram_id: telegramId, list_name: name, items: [], updated_at: new Date().toISOString() })
    .select('id, list_name, items')
    .single()
  if (error || !data) return { ok: false, reason: 'error' }
  return { ok: true, list: { id: data.id, name: data.list_name, items: (data.items as ListItem[]) ?? [] } }
}

export type SetItemResult = { ok: true } | { ok: false; reason: 'not_found' | 'conflict' | 'error' }

// Dashboard tick/untick. Targets EXACTLY ONE item by the (text, added_at) composite —
// never by array index (positions shift as items are added/removed elsewhere) and
// never by substring (checkItem's includes() can flip several at once; the dashboard
// must move exactly the row the user tapped). SETS done to the requested value
// (idempotent) rather than blind-flipping, so a double-tap or a stale view can't invert
// the wrong way. Routes through the CAS core.
export async function setListItemDone(
  telegramId: number,
  listName: string,
  text: string,
  addedAt: string,
  done: boolean,
): Promise<SetItemResult> {
  const list = await getList(telegramId, listName)
  if (!list) return { ok: false, reason: 'not_found' }

  let everFound = false
  try {
    await mutateListItems(list.id, items => {
      // localFound resets each attempt so a CAS retry re-applies the change against
      // the fresh array (a shared flag would skip the write on retry and lose it).
      let localFound = false
      const next = items.map(item => {
        if (!localFound && item.text === text && item.added_at === addedAt) {
          localFound = true
          return { ...item, done }
        }
        return item
      })
      everFound = localFound
      return localFound ? next : null // no match → no write
    })
  } catch (e) {
    if (e instanceof ListWriteConflictError) return { ok: false, reason: 'conflict' }
    return { ok: false, reason: 'error' }
  }
  return everFound ? { ok: true } : { ok: false, reason: 'not_found' }
}

export function formatList(name: string, items: ListItem[]): string {
  if (items.length === 0) return `📋 *${name}* is empty.`
  const lines = items.map((item, i) =>
    item.done ? `~${i + 1}. ~~${item.text}~~~` : `${i + 1}. ${item.text}`
  )
  const doneCount = items.filter(i => i.done).length
  return `📋 *${name}* (${items.length - doneCount} pending, ${doneCount} done)\n\n${lines.join('\n')}`
}

// Renders an add result: leads with a dedupe note when an item was already present
// (pending) or was moved back to pending, then the list. No note → just the list, so
// the normal "added" path reads exactly as before.
export function formatAddResult(listName: string, res: AddToListResult): string {
  const notes: string[] = []
  if (res.alreadyPending.length) {
    const q = res.alreadyPending.map(t => `"${t}"`).join(', ')
    notes.push(`${q} ${res.alreadyPending.length > 1 ? 'are' : 'is'} already on your ${listName} list.`)
  }
  if (res.reactivated.length) {
    const q = res.reactivated.map(t => `"${t}"`).join(', ')
    notes.push(`Moved ${q} back to pending.`)
  }
  const body = formatList(listName, res.items)
  return notes.length ? `${notes.join(' ')}\n\n${body}` : body
}
