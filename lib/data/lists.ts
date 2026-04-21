import { supabaseAdmin } from './supabase-admin'

export interface ListItem {
  text: string
  done: boolean
  added_at: string
}

export async function addToList(telegramId: number, listName: string, items: string[]) {
  const name = listName.toLowerCase().trim()

  const { data: existing } = await supabaseAdmin
    .from('lists')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('list_name', name)
    .single()

  const newItems: ListItem[] = items.map(t => ({
    text: t.trim(),
    done: false,
    added_at: new Date().toISOString(),
  }))

  if (existing) {
    const updated = [...(existing.items || []), ...newItems]
    await supabaseAdmin
      .from('lists')
      .update({ items: updated, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return updated
  } else {
    const { data } = await supabaseAdmin
      .from('lists')
      .insert({ telegram_id: telegramId, list_name: name, items: newItems })
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

  const items = list.items as ListItem[]
  const updated = items.map(item =>
    item.text.toLowerCase().includes(itemText.toLowerCase())
      ? { ...item, done: !item.done }
      : item
  )

  await supabaseAdmin
    .from('lists')
    .update({ items: updated, updated_at: new Date().toISOString() })
    .eq('id', list.id)
  return updated
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
  const items = list.items as ListItem[]
  const remaining = items.filter(i => !i.done)
  await supabaseAdmin
    .from('lists')
    .update({ items: remaining, updated_at: new Date().toISOString() })
    .eq('id', list.id)
  return remaining
}

export function formatList(name: string, items: ListItem[]): string {
  if (items.length === 0) return `📋 *${name}* is empty.`
  const lines = items.map((item, i) =>
    item.done ? `~${i + 1}. ~~${item.text}~~~` : `${i + 1}. ${item.text}`
  )
  const doneCount = items.filter(i => i.done).length
  return `📋 *${name}* (${items.length - doneCount} pending, ${doneCount} done)\n\n${lines.join('\n')}`
}