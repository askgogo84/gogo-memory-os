import { supabaseAdmin } from './supabase-admin'
import { mutateListItems as mutateItemsCore, ListWriteConflictError, type ListItem } from './lists-core'

// The CAS core and ListItem now live in the zero-import lists-core.ts so they can be
// unit-tested with an injected fake db (the meter-core pattern). Re-export the type so
// existing consumers importing it from '@/lib/data/lists' keep working, and provide a
// thin wrapper that injects the real supabaseAdmin as the client.
export type { ListItem } from './lists-core'
export { ListWriteConflictError } from './lists-core'

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

export async function addToList(telegramId: number, listName: string, items: string[]) {
  const name = listName.toLowerCase().trim()

  const { data: existing } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('list_name', name)
    .single()

  const newItems: ListItem[] = items.map(t => ({
    text: t.trim(),
    done: false,
    added_at: new Date().toISOString(),
  }))

  if (existing) {
    // Append against a FRESH read inside the CAS core, so a concurrent add/tick
    // can't be clobbered by a stale copy of the array.
    return await mutateListItems(existing.id, cur => [...cur, ...newItems])
  } else {
    const { data } = await supabaseAdmin
      .from('lists')
      .insert({ telegram_id: telegramId, list_name: name, items: newItems, updated_at: new Date().toISOString() })
      .select()
      .single()
    return data?.items || []
  }
}

export async function getList(telegramId: number, listName: string) {
  const { data } = await supabaseAdmin
    .from('lists')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('list_name', listName.toLowerCase().trim())
    .single()
  return data
}

export async function getAllLists(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('lists')
    .select('*')
    .eq('telegram_id', telegramId)
    .order('updated_at', { ascending: false })
  return data || []
}

export async function checkItem(telegramId: number, listName: string, itemText: string) {
  const list = await getList(telegramId, listName)
  if (!list) return null

  // Bot path: substring match, toggle. Unchanged behaviour — an "add milk" then
  // "done milk" flow — but now routed through the CAS core. (The dashboard uses
  // setListItemDone instead: exact identity, set-not-flip.)
  return await mutateListItems(list.id, items =>
    items.map(item =>
      item.text.toLowerCase().includes(itemText.toLowerCase())
        ? { ...item, done: !item.done }
        : item,
    ),
  )
}

export async function clearList(telegramId: number, listName: string) {
  await supabaseAdmin
    .from('lists')
    .delete()
    .eq('telegram_id', telegramId)
    .eq('list_name', listName.toLowerCase().trim())
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
  const name = listName.toLowerCase().trim()
  if (!name) return { ok: false, reason: 'error' }

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
